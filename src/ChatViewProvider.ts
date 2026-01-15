import * as vscode from 'vscode';
import { LLMService, LLMConfig, ChatMessage, TargetedSection } from './LLMService';
import { DebuggerTool, DebugState } from './DebuggerTool';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'llmentor.chatView';
    private _view?: vscode.WebviewView;
    private _llmService: LLMService | null = null;
    private _chatHistory: ChatMessage[] = [];
    private _debuggerTool: DebuggerTool;
    private _isWalkthroughActive: boolean = false;
    private _sourceCode: string = '';
    private _fileName: string = '';
    private _targetedSection: TargetedSection | null = null;

    private readonly _systemPrompt = `You are LLMentor, a friendly and helpful AI programming tutor. 
Your goal is to help students learn programming concepts clearly and effectively.
- Explain concepts in simple terms
- Use examples when helpful
- Encourage the student and be patient
- If you see code, offer to help debug or explain it
- Keep responses concise but thorough`;

    constructor(private readonly _extensionUri: vscode.Uri) {
        this._debuggerTool = new DebuggerTool();
        this._initializeLLMService();

        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('llmentor')) {
                this._initializeLLMService();
            }
        });
    }

    private _initializeLLMService() {
        const config = vscode.workspace.getConfiguration('llmentor');
        const provider = config.get<string>('provider', 'ollama');
        const model = config.get<string>('model', 'llama3.2');

        const llmConfig: LLMConfig = {
            provider: provider as 'ollama' | 'anthropic' | 'openai',
            model: model,
        };

        switch (provider) {
            case 'ollama':
                llmConfig.baseUrl = config.get<string>('ollamaBaseUrl', 'http://localhost:11434');
                break;
            case 'anthropic':
                llmConfig.apiKey = config.get<string>('anthropicApiKey', '');
                break;
            case 'openai':
                llmConfig.apiKey = config.get<string>('openaiApiKey', '');
                break;
        }

        try {
            this._llmService = new LLMService(llmConfig);
            console.log(`LLMentor: Initialized with ${provider}/${model}`);
        } catch (error) {
            console.error('Failed to initialize LLM:', error);
            this._llmService = null;
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlContent();

        if (context.state) {
            this._isWalkthroughActive = (context.state as any).isWalkthroughActive || false;
        }

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'sendMessage':
                    await this._handleUserInput(message.text);
                    break;
                case 'clearChat':
                    this._chatHistory = [];
                    this._isWalkthroughActive = false;
                    this._targetedSection = null;
                    break;
                case 'openSettings':
                    vscode.commands.executeCommand('llmentor.openSettings');
                    break;
                case 'startDebugWalkthrough':
                    await this._startDebugWalkthrough();
                    break;
                case 'stopDebugWalkthrough':
                    await this._stopDebugWalkthrough();
                    break;
                case 'nextStep':
                    await this._nextStep();
                    break;
                case 'stepBack':
                    await this._stepBack();
                    break;
                case 'exitTargetedMode':
                    await this._exitTargetedMode();
                    break;
                case 'ready':
                    this._syncWalkthroughState();
                    break;
            }
        });
    }

    private _syncWalkthroughState() {
        if (this._isWalkthroughActive) {
            this._sendToWebview('walkthroughStarted', {});
            this._updateStepBackButton();
            
            if (this._targetedSection) {
                this._sendToWebview('targetedModeStarted', {
                    concept: this._targetedSection.concept,
                    startLine: this._targetedSection.startLine,
                    endLine: this._targetedSection.endLine
                });
            }
        }
    }

    private _updateStepBackButton() {
        const canStepBack = this._debuggerTool.canStepBack();
        this._sendToWebview('updateStepBackState', { canStepBack });
    }

    private async _handleUserInput(text: string) {
    if (!this._isWalkthroughActive) {
        await this._handleUserMessage(text);
        return;
    }

    // Check if user wants to continue stepping through the program
    if (this._checkForContinueRequest(text)) {
        await this._continueFullWalkthrough();
        return;
    }

    // Check if user wants to stop the debug session
    if (this._checkForStopRequest(text)) {
        await this._stopDebugWalkthrough();
        return;
    }

    // Check if the user is asking about a specific part of the code
    if (this._llmService && this._sourceCode) {
        const targetedSection = await this._checkForTargetedQuestion(text);
        
        if (targetedSection && targetedSection.understood) {
            await this._startTargetedDebugging(targetedSection, text);
            return;
        }
    }

    // Otherwise, handle as a regular walkthrough question
    await this._handleWalkthroughQuestion(text);
}

private _checkForContinueRequest(text: string): boolean {
    const lowerText = text.toLowerCase();
    const continueKeywords = [
        'continue stepping',
        'continue debugging',
        'continue through',
        'step through the whole',
        'step through the rest',
        'keep stepping',
        'keep going',
        'continue the walkthrough',
        'resume stepping',
        'resume debugging',
        'go through the rest',
        'walk through the rest',
        'continue from here',
        'continue the debug',
        'yes continue',
        'yes, continue',
        'continue please',
        'let\'s continue'
    ];
    
    return continueKeywords.some(kw => lowerText.includes(kw));
}

private _checkForStopRequest(text: string): boolean {
    const lowerText = text.toLowerCase();
    const stopKeywords = [
        'stop the debug',
        'stop debugging',
        'end the session',
        'end session',
        'stop the session',
        'quit debugging',
        'exit debug',
        'close debug',
        'i\'m done',
        'that\'s enough',
        'stop walkthrough'
    ];
    
    return stopKeywords.some(kw => lowerText.includes(kw));
}

private async _continueFullWalkthrough() {
    this._sendToWebview('receiveMessage', {
        text: '▶️ Continuing to step through the program...',
        isDebug: true
    });

    // Check if debugger is still running
    if (!this._debuggerTool.getIsDebugging()) {
        // Restart the debugger from the beginning
        this._sendToWebview('receiveMessage', {
            text: '🔄 Restarting debugger...',
            isDebug: true
        });

        this._sendToWebview('setLoading', { isLoading: true });

        try {
            const startResult = await this._debuggerTool.execute('start', { file: this._fileName });

            if (!startResult.success) {
                throw new Error(startResult.error || 'Failed to restart debugger');
            }

            await this._delay(500);
            await vscode.commands.executeCommand('workbench.view.explorer');

        } catch (error) {
            this._sendToWebview('receiveMessage', {
                text: `❌ Error: ${error instanceof Error ? error.message : 'Failed to restart debugger'}`,
                isError: true
            });
            this._sendToWebview('setLoading', { isLoading: false });
            return;
        }

        this._sendToWebview('setLoading', { isLoading: false });
    }

        // Clear any targeted mode
        this._targetedSection = null;
        this._debuggerTool.clearTargetedMode();
        this._sendToWebview('targetedModeEnded', {});

        // Continue explaining from current state
        await this._explainCurrentState();
    }

    private async _checkForTargetedQuestion(question: string): Promise<TargetedSection | null> {
        if (!this._llmService) return null;

        // Keywords that suggest the user is asking about a specific part
        const targetedKeywords = [
            'understand', 'confused', 'explain', 'what does', 'how does',
            'don\'t get', 'help with', 'what is', 'why does', 'can you show',
            'walk through', 'step through', 'debug the', 'focus on'
        ];

        const lowerQuestion = question.toLowerCase();
        const isTargetedQuestion = targetedKeywords.some(kw => lowerQuestion.includes(kw));

        if (!isTargetedQuestion) return null;

        this._sendToWebview('receiveMessage', {
            text: '🔍 Analyzing your question...',
            isDebug: true
        });

        return await this._llmService.identifyTargetedSection(
            this._sourceCode,
            question,
            this._fileName
        );
    }

    private async _startTargetedDebugging(section: TargetedSection, originalQuestion: string) {
        if (!this._llmService) return;

        this._targetedSection = section;

        this._sendToWebview('targetedModeStarted', {
            concept: section.concept,
            startLine: section.startLine,
            endLine: section.endLine
        });

        this._sendToWebview('receiveMessage', {
            text: `🎯 I see you want to understand the **${section.concept}** (lines ${section.startLine}-${section.endLine}).\n\n${section.explanation}\n\nLet me set up the debugger to focus on that section!`,
            isDebug: true
        });

        this._sendToWebview('setLoading', { isLoading: true });

        try {
            // Stop any existing debug session
            if (this._debuggerTool.getIsDebugging()) {
                await this._debuggerTool.execute('stop', {});
                await this._delay(300);
            }

            // Start targeted debugging
            const result = await this._debuggerTool.execute('start_targeted', {
                file: this._fileName,
                startLine: section.startLine,
                endLine: section.endLine
            });

            if (!result.success) {
                throw new Error(result.error || 'Failed to start targeted debugging');
            }

            await this._delay(500);
            await vscode.commands.executeCommand('workbench.view.explorer');

            // Explain the current state with focus on the targeted concept
            await this._explainTargetedState();

        } catch (error) {
            console.error('Targeted debugging error:', error);
            this._sendToWebview('receiveMessage', {
                text: `❌ Error: ${error instanceof Error ? error.message : 'Failed to start targeted debugging'}`,
                isError: true
            });
            this._targetedSection = null;
            this._sendToWebview('targetedModeEnded', {});
        } finally {
            this._sendToWebview('setLoading', { isLoading: false });
        }
    }

    private async _explainTargetedState() {
        if (!this._llmService || !this._isWalkthroughActive) return;

        this._sendToWebview('setLoading', { isLoading: true });

        try {
            const stateResult = await this._debuggerTool.execute('get_state', {});

            if (!stateResult.success || !stateResult.state) {
                this._sendToWebview('receiveMessage', {
                    text: '✅ Finished stepping through the targeted section!',
                    isDebug: true
                });
                await this._finishTargetedDebugging();
                return;
            }

            const state = stateResult.state;

            // Check if we've gone past the target section
            if (this._targetedSection && state.line > this._targetedSection.endLine) {
                await this._finishTargetedDebugging();
                return;
            }

            this._sendToWebview('debugState', { state });

            // Create a focused explanation prompt
            const explainPrompt = this._targetedSection
                ? `You are helping a student understand specifically the "${this._targetedSection.concept}" in their code.

The student said they don't understand this part, so focus your explanation on helping them grasp this concept.

Current debug state:
File: ${state.file}
Current line: ${state.line} (target section: lines ${this._targetedSection.startLine}-${this._targetedSection.endLine})
Function: ${state.function}

Code context:
${state.sourceCode}

Variables in scope:
${state.variables.map(v => `- ${v.name} = ${v.value} (${v.type})`).join('\n') || 'No variables yet'}

Full source code:
\`\`\`
${this._sourceCode}
\`\`\`

Please explain in 2-4 sentences:
1. What's happening on line ${state.line} in the context of the ${this._targetedSection.concept}
2. How the current variable values relate to this concept
3. What will happen next in this section

Be encouraging and focus specifically on helping them understand the ${this._targetedSection.concept}!`
                : this._createStandardExplanationPrompt(state);

            const explanation = await this._llmService.chat(
                [{ role: 'user', content: explainPrompt }],
                this._systemPrompt
            );

            this._sendToWebview('receiveMessage', {
                text: explanation,
                isDebug: true
            });

            this._sendToWebview('showStepControls', {});
            this._updateStepBackButton();

        } catch (error) {
            console.error('Explain state error:', error);
            this._sendToWebview('receiveMessage', {
                text: `❌ Error getting state: ${error instanceof Error ? error.message : 'Unknown error'}`,
                isError: true
            });
        } finally {
            this._sendToWebview('setLoading', { isLoading: false });
        }
    }

    private _createStandardExplanationPrompt(state: DebugState): string {
        return `The debugger is now stopped. Here's the current state:

File: ${state.file}
Current line: ${state.line}
Function: ${state.function}

Code context:
${state.sourceCode}

Variables in scope:
${state.variables.map(v => `- ${v.name} = ${v.value} (${v.type})`).join('\n') || 'No variables yet'}

Full source code for reference:
\`\`\`
${this._sourceCode}
\`\`\`

Please explain in 2-4 sentences:
1. What line ${state.line} does
2. What the current variable values mean
3. What will happen when we execute this line

Keep it educational and encouraging!`;
    }

    private async _finishTargetedDebugging() {
    if (!this._llmService || !this._targetedSection) return;

    this._sendToWebview('setLoading', { isLoading: true });

    try {
        const summaryPrompt = `The student was learning about the "${this._targetedSection.concept}" in this code:

\`\`\`
${this._sourceCode}
\`\`\`

We just finished stepping through lines ${this._targetedSection.startLine}-${this._targetedSection.endLine}.

Please provide:
1. A brief summary of what the ${this._targetedSection.concept} does (2 sentences)
2. One key takeaway the student should remember
3. An encouraging message

Keep it concise!`;

        const summary = await this._llmService.chat(
            [{ role: 'user', content: summaryPrompt }],
            this._systemPrompt
        );

        this._sendToWebview('receiveMessage', {
            text: `✅ Finished exploring the **${this._targetedSection.concept}**!\n\n${summary}`,
            isDebug: true
        });

    } catch (error) {
        this._sendToWebview('receiveMessage', {
            text: `✅ Finished exploring the ${this._targetedSection?.concept || 'targeted section'}!`,
            isDebug: true
        });
    } finally {
        // Clear targeted mode but DON'T stop the debugger
        const previousConcept = this._targetedSection?.concept;
        this._targetedSection = null;
        this._debuggerTool.clearTargetedMode();
        this._sendToWebview('targetedModeEnded', {});
        this._sendToWebview('setLoading', { isLoading: false });
        
        // Show options with clickable actions
        this._sendToWebview('receiveMessage', {
            text: `💡 **What would you like to do next?**\n\n• Ask about another part of the code\n• Say "**continue stepping**" to walk through the rest of the program\n• Say "**stop debugging**" to end the session`,
            isDebug: true
        });
        
        // Keep step controls visible so user can manually step if they want
        this._sendToWebview('showStepControls', {});
        this._updateStepBackButton();
    }
}

    private async _exitTargetedMode() {
        this._targetedSection = null;
        this._debuggerTool.clearTargetedMode();
        this._sendToWebview('targetedModeEnded', {});
        this._sendToWebview('receiveMessage', {
            text: '📤 Exited focused mode. You can continue stepping through the code or ask about another section.',
            isDebug: true
        });
    }

    private async _startDebugWalkthrough() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            this._sendToWebview('receiveMessage', {
                text: '⚠️ Please open a file to debug first.',
                isError: true
            });
            return;
        }

        if (!this._llmService) {
            this._sendToWebview('receiveMessage', {
                text: '⚠️ LLM not configured. Please check your settings (click ⚙️ above).',
                isError: true
            });
            return;
        }

        this._sourceCode = editor.document.getText();
        this._fileName = editor.document.fileName;
        const language = editor.document.languageId;

        this._isWalkthroughActive = true;
        this._chatHistory = [];
        this._targetedSection = null;

        this._sendToWebview('walkthroughStarted', {});
        this._sendToWebview('receiveMessage', {
            text: '🔍 Starting AI Debug Walkthrough...',
            isDebug: true
        });

        this._sendToWebview('setLoading', { isLoading: true });

        try {
            const analysisPrompt = `You are helping a student understand their code by walking through it with a debugger.

Here's the code:
File: ${this._fileName}
Language: ${language}

\`\`\`${language}
${this._sourceCode}
\`\`\`

Please provide:
1. A brief overview of what this code does (2-3 sentences)
2. Then say: "Let's start the debugger! You can either step through line by line, or if there's a specific part you'd like to focus on (like a loop or function), just let me know!"`;

            const analysis = await this._llmService.chat(
                [{ role: 'user', content: analysisPrompt }],
                this._systemPrompt
            );

            this._sendToWebview('receiveMessage', {
                text: analysis,
                isDebug: true
            });

            this._sendToWebview('receiveMessage', {
                text: '▶️ Starting debugger...',
                isDebug: true
            });

            const startResult = await this._debuggerTool.execute('start', { file: this._fileName });

            if (!startResult.success) {
                throw new Error(startResult.error || 'Failed to start debugger');
            }

            await this._delay(500);
            await vscode.commands.executeCommand('workbench.view.explorer');
            await this._explainCurrentState();

        } catch (error) {
            console.error('Walkthrough start error:', error);
            this._sendToWebview('receiveMessage', {
                text: `❌ Error: ${error instanceof Error ? error.message : 'Failed to start walkthrough'}`,
                isError: true
            });
            this._isWalkthroughActive = false;
            this._sendToWebview('walkthroughEnded', {});
        } finally {
            this._sendToWebview('setLoading', { isLoading: false });
        }
    }

    private async _explainCurrentState() {
        if (!this._llmService || !this._isWalkthroughActive) return;

        // If in targeted mode, use targeted explanation
        if (this._targetedSection) {
            await this._explainTargetedState();
            return;
        }

        this._sendToWebview('setLoading', { isLoading: true });

        try {
            const stateResult = await this._debuggerTool.execute('get_state', {});

            if (!stateResult.success || !stateResult.state) {
                this._sendToWebview('receiveMessage', {
                    text: '✅ Program execution complete!',
                    isDebug: true
                });
                await this._endWalkthrough();
                return;
            }

            const state = stateResult.state;

            this._sendToWebview('debugState', { state });

            const explainPrompt = this._createStandardExplanationPrompt(state);

            const explanation = await this._llmService.chat(
                [{ role: 'user', content: explainPrompt }],
                this._systemPrompt
            );

            this._sendToWebview('receiveMessage', {
                text: explanation,
                isDebug: true
            });

            this._sendToWebview('showStepControls', {});
            this._updateStepBackButton();

        } catch (error) {
            console.error('Explain state error:', error);
            this._sendToWebview('receiveMessage', {
                text: `❌ Error getting state: ${error instanceof Error ? error.message : 'Unknown error'}`,
                isError: true
            });
        } finally {
            this._sendToWebview('setLoading', { isLoading: false });
        }
    }

    private async _nextStep() {
        if (!this._isWalkthroughActive) return;

        this._sendToWebview('hideStepControls', {});
        this._sendToWebview('receiveMessage', {
            text: '⏭️ Stepping forward...',
            isDebug: true
        });

        const result = await this._debuggerTool.execute('step_over', {});

        await vscode.commands.executeCommand('workbench.view.explorer');

        if (!result.success) {
            if (!this._debuggerTool.getIsDebugging()) {
                await this._programEnded();
            } else {
                this._sendToWebview('receiveMessage', {
                    text: `❌ Step failed: ${result.error}`,
                    isError: true
                });
                this._sendToWebview('showStepControls', {});
            }
            return;
        }

        // Check if we completed the target section
        if (result.data?.targetComplete) {
            await this._finishTargetedDebugging();
            return;
        }

        await this._delay(300);
        await this._explainCurrentState();
    }

    private async _stepBack() {
        if (!this._isWalkthroughActive) return;

        if (!this._debuggerTool.canStepBack()) {
            this._sendToWebview('receiveMessage', {
                text: '⚠️ Cannot step back - already at the beginning.',
                isError: true
            });
            return;
        }

        this._sendToWebview('hideStepControls', {});
        this._sendToWebview('receiveMessage', {
            text: '⏮️ Stepping back...',
            isDebug: true
        });

        this._sendToWebview('setLoading', { isLoading: true });

        try {
            const result = await this._debuggerTool.execute('step_back', {});

            await vscode.commands.executeCommand('workbench.view.explorer');

            if (!result.success) {
                this._sendToWebview('receiveMessage', {
                    text: `❌ Step back failed: ${result.error}`,
                    isError: true
                });
                this._sendToWebview('showStepControls', {});
                return;
            }

            await this._delay(300);
            await this._explainCurrentState();

        } catch (error) {
            this._sendToWebview('receiveMessage', {
                text: `❌ Step back failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                isError: true
            });
            this._sendToWebview('showStepControls', {});
        } finally {
            this._sendToWebview('setLoading', { isLoading: false });
        }
    }

    private async _programEnded() {
        if (!this._llmService) return;

        this._sendToWebview('setLoading', { isLoading: true });

        try {
            const summaryPrompt = `The program has finished executing. 

Here was the code:
\`\`\`
${this._sourceCode}
\`\`\`

Please provide a brief summary (3-4 sentences) of:
1. What the program did overall
2. Key concepts the student should remember from this walkthrough
3. An encouraging closing message

Keep it concise and educational!`;

            const summary = await this._llmService.chat(
                [{ role: 'user', content: summaryPrompt }],
                this._systemPrompt
            );

            this._sendToWebview('receiveMessage', {
                text: '✅ Program execution complete!\n\n' + summary,
                isDebug: true
            });

        } catch (error) {
            this._sendToWebview('receiveMessage', {
                text: '✅ Program execution complete!',
                isDebug: true
            });
        } finally {
            this._sendToWebview('setLoading', { isLoading: false });
            await this._endWalkthrough();
        }
    }

    private async _endWalkthrough() {
        this._isWalkthroughActive = false;
        this._targetedSection = null;
        await this._debuggerTool.execute('stop', {});
        this._sendToWebview('walkthroughEnded', {});
        this._sendToWebview('targetedModeEnded', {});
        this._sendToWebview('hideStepControls', {});
    }

    private async _handleWalkthroughQuestion(text: string) {
        if (!this._llmService) return;

        this._sendToWebview('setLoading', { isLoading: true });

        try {
            const stateResult = await this._debuggerTool.execute('get_state', {});
            const state = stateResult.state;

            let contextInfo = '';
            if (state) {
                contextInfo = `
Current debug state:
- Line: ${state.line}
- Function: ${state.function}
- Variables: ${state.variables.map(v => `${v.name}=${v.value}`).join(', ') || 'none'}
`;
            }

            const questionPrompt = `The student is debugging this code:
\`\`\`
${this._sourceCode}
\`\`\`
${contextInfo}
Student's question: ${text}

Please answer their question helpfully and concisely. If they're asking about a specific part of the code, offer to set a breakpoint there and step through it with them.`;

            const response = await this._llmService.chat(
                [{ role: 'user', content: questionPrompt }],
                this._systemPrompt
            );

            this._sendToWebview('receiveMessage', {
                text: response,
                isDebug: true
            });

        } catch (error) {
            this._sendToWebview('receiveMessage', {
                text: `❌ Error: ${error instanceof Error ? error.message : 'Failed to answer'}`,
                isError: true
            });
        } finally {
            this._sendToWebview('setLoading', { isLoading: false });
        }
    }

    private async _stopDebugWalkthrough() {
        this._sendToWebview('receiveMessage', {
            text: '🛑 Debug walkthrough stopped.',
            isDebug: true
        });
        await this._endWalkthrough();
    }

    private async _handleUserMessage(text: string) {
        if (!this._llmService) {
            this._sendToWebview('receiveMessage', {
                text: '⚠️ LLM not configured. Please check your settings (click ⚙️ above).',
                isError: true
            });
            return;
        }

        this._chatHistory.push({ role: 'user', content: text });
        this._sendToWebview('setLoading', { isLoading: true });

        try {
            let fullResponse = '';
            this._sendToWebview('startStream', {});

            for await (const chunk of this._llmService.chatStream(this._chatHistory, this._systemPrompt)) {
                fullResponse += chunk;
                this._sendToWebview('streamChunk', { text: chunk });
            }

            this._sendToWebview('endStream', {});
            this._chatHistory.push({ role: 'assistant', content: fullResponse });

        } catch (error) {
            console.error('Chat error:', error);
            this._sendToWebview('receiveMessage', {
                text: `❌ Error: ${error instanceof Error ? error.message : 'Failed to get response'}`,
                isError: true
            });
        } finally {
            this._sendToWebview('setLoading', { isLoading: false });
        }
    }

    private _sendToWebview(command: string, data: any) {
        if (this._view) {
            this._view.webview.postMessage({ command, ...data });
        }
    }

    private _delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private _getHtmlContent(): string {
    return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>LLMentor</title>
            <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
            <style>
                * {
                    box-sizing: border-box;
                    margin: 0;
                    padding: 0;
                }
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-sideBar-background);
                    height: 100vh;
                    display: flex;
                    flex-direction: column;
                }
                .header {
                    padding: 12px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .header h2 {
                    font-size: 14px;
                    font-weight: 600;
                }
                .header-buttons {
                    display: flex;
                    gap: 8px;
                }
                .icon-btn {
                    background: none;
                    border: none;
                    cursor: pointer;
                    font-size: 14px;
                    opacity: 0.7;
                    padding: 4px;
                }
                .icon-btn:hover {
                    opacity: 1;
                }
                .debug-btn {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 4px;
                    padding: 4px 8px;
                    cursor: pointer;
                    font-size: 12px;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                .debug-btn:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .debug-btn.stop {
                    background-color: #c42b1c;
                    color: white;
                }
                .debug-btn.stop:hover {
                    background-color: #a61b0f;
                }
                .debug-btn.hidden {
                    display: none;
                }
                .targeted-banner {
                    background-color: rgba(78, 201, 176, 0.2);
                    border: 1px solid #4ec9b0;
                    border-radius: 4px;
                    padding: 8px 12px;
                    margin: 8px 12px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    font-size: 12px;
                }
                .targeted-banner.hidden {
                    display: none;
                }
                .targeted-banner-text {
                    color: #4ec9b0;
                }
                .targeted-banner-btn {
                    background: none;
                    border: 1px solid #4ec9b0;
                    color: #4ec9b0;
                    border-radius: 4px;
                    padding: 2px 8px;
                    cursor: pointer;
                    font-size: 11px;
                }
                .targeted-banner-btn:hover {
                    background-color: rgba(78, 201, 176, 0.3);
                }
                .chat-container {
                    flex: 1;
                    overflow-y: auto;
                    padding: 12px;
                }
                .message {
                    margin-bottom: 12px;
                    padding: 8px 12px;
                    border-radius: 8px;
                    max-width: 90%;
                    word-wrap: break-word;
                    color: var(--vscode-foreground);
                }
                .message.user {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    margin-left: auto;
                }
                .message.assistant {
                    background-color: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                    color: var(--vscode-editor-foreground);
                }
                .message.debug {
                    background-color: var(--vscode-editor-background);
                    border-left: 3px solid #4ec9b0;
                    color: var(--vscode-editor-foreground);
                }
                .message.error {
                    background-color: rgba(244, 67, 54, 0.1);
                    border: 1px solid #f44336;
                    color: var(--vscode-foreground);
                }
                /* Markdown styles */
                .message p {
                    margin-bottom: 8px;
                }
                .message p:last-child {
                    margin-bottom: 0;
                }
                .message strong {
                    font-weight: 600;
                    color: #4ec9b0;
                }
                .message em {
                    font-style: italic;
                }
                .message code {
                    background-color: var(--vscode-textCodeBlock-background);
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-family: var(--vscode-editor-font-family), monospace;
                    font-size: 0.9em;
                }
                .message pre {
                    background-color: var(--vscode-textCodeBlock-background);
                    padding: 10px;
                    border-radius: 4px;
                    overflow-x: auto;
                    margin: 8px 0;
                }
                .message pre code {
                    background: none;
                    padding: 0;
                }
                .message ul, .message ol {
                    margin: 8px 0;
                    padding-left: 20px;
                }
                .message li {
                    margin-bottom: 4px;
                }
                .message h1, .message h2, .message h3, .message h4 {
                    margin: 12px 0 8px 0;
                    font-weight: 600;
                }
                .message h1 { font-size: 1.3em; }
                .message h2 { font-size: 1.2em; }
                .message h3 { font-size: 1.1em; }
                .message h4 { font-size: 1em; }
                .message blockquote {
                    border-left: 3px solid var(--vscode-panel-border);
                    padding-left: 10px;
                    margin: 8px 0;
                    opacity: 0.8;
                }
                .message a {
                    color: #4ec9b0;
                    text-decoration: none;
                }
                .message a:hover {
                    text-decoration: underline;
                }
                .debug-state {
                    background-color: var(--vscode-editor-background);
                    border: 1px solid #4ec9b0;
                    border-radius: 8px;
                    padding: 12px;
                    margin-bottom: 12px;
                    font-family: var(--vscode-editor-font-family), monospace;
                    font-size: 12px;
                    color: var(--vscode-editor-foreground);
                }
                .debug-state-header {
                    font-weight: bold;
                    margin-bottom: 8px;
                    color: #4ec9b0;
                }
                .debug-state-section {
                    margin-bottom: 8px;
                }
                .debug-state-section h4 {
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 4px;
                }
                .debug-state-code {
                    background-color: var(--vscode-textCodeBlock-background);
                    padding: 8px;
                    border-radius: 4px;
                    overflow-x: auto;
                    color: var(--vscode-editor-foreground);
                }
                .debug-state-code pre {
                    margin: 0;
                    font-family: var(--vscode-editor-font-family), monospace;
                }
                .debug-state-vars {
                    display: grid;
                    grid-template-columns: auto 1fr;
                    gap: 4px 12px;
                }
                .var-name {
                    color: #9cdcfe;
                }
                .var-value {
                    color: #ce9178;
                }
                .var-value small {
                    color: var(--vscode-descriptionForeground);
                }
                .step-controls {
                    display: flex;
                    gap: 8px;
                    padding: 12px;
                    border-top: 1px solid var(--vscode-panel-border);
                    background-color: var(--vscode-sideBar-background);
                    justify-content: center;
                }
                .step-controls.hidden {
                    display: none;
                }
                .step-btn {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: none;
                    border-radius: 4px;
                    padding: 8px 16px;
                    cursor: pointer;
                    font-size: 13px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    flex: 1;
                    justify-content: center;
                }
                .step-btn:hover:not(:disabled) {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
                .step-btn:disabled {
                    opacity: 0.4;
                    cursor: not-allowed;
                }
                .step-btn.primary {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                }
                .step-btn.primary:hover:not(:disabled) {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .input-container {
                    padding: 12px;
                    border-top: 1px solid var(--vscode-panel-border);
                    display: flex;
                    gap: 8px;
                }
                #messageInput {
                    flex: 1;
                    padding: 8px;
                    border: 1px solid var(--vscode-input-border);
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border-radius: 4px;
                    outline: none;
                    resize: none;
                    min-height: 36px;
                    max-height: 120px;
                }
                #messageInput:focus {
                    border-color: var(--vscode-focusBorder);
                }
                #sendButton {
                    padding: 8px 16px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    align-self: flex-end;
                }
                #sendButton:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                #sendButton:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                .welcome {
                    text-align: center;
                    padding: 20px;
                    color: var(--vscode-descriptionForeground);
                }
                .loading {
                    display: flex;
                    gap: 4px;
                    padding: 12px;
                }
                .loading span {
                    width: 8px;
                    height: 8px;
                    background-color: var(--vscode-foreground);
                    border-radius: 50%;
                    animation: bounce 1.4s infinite ease-in-out both;
                }
                .loading span:nth-child(1) { animation-delay: -0.32s; }
                .loading span:nth-child(2) { animation-delay: -0.16s; }
                @keyframes bounce {
                    0%, 80%, 100% { transform: scale(0); }
                    40% { transform: scale(1); }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h2>🎓 LLMentor</h2>
                <div class="header-buttons">
                    <button class="debug-btn" id="startDebugBtn" title="Start AI Debug Walkthrough">
                        🔍 Debug with AI
                    </button>
                    <button class="debug-btn stop hidden" id="stopDebugBtn" title="Stop Debug Walkthrough">
                        🛑 Stop
                    </button>
                    <button class="icon-btn" id="settingsBtn" title="Settings">⚙️</button>
                    <button class="icon-btn" id="clearBtn" title="Clear Chat">🗑️</button>
                </div>
            </div>

            <div class="targeted-banner hidden" id="targetedBanner">
                <span class="targeted-banner-text">🎯 Focusing on: <strong id="targetedConcept"></strong> (lines <span id="targetedLines"></span>)</span>
                <button class="targeted-banner-btn" id="exitTargetedBtn">Exit Focus</button>
            </div>
            
            <div class="chat-container" id="chatContainer">
                <div class="welcome">
                    <p>👋 Hi! I'm your AI programming tutor.</p>
                    <p style="margin-top: 8px;">Ask me anything about code!</p>
                    <p style="margin-top: 16px; font-size: 12px;">
                        Click <strong>🔍 Debug with AI</strong> to walk through your code step by step
                    </p>
                    <p style="margin-top: 8px; font-size: 12px;">
                        Click ⚙️ to configure your AI provider
                    </p>
                </div>
            </div>

            <div class="step-controls hidden" id="stepControls">
                <button class="step-btn" id="stepBackBtn" disabled title="Go back to previous step">
                    ⏮️ Step Back
                </button>
                <button class="step-btn primary" id="nextStepBtn" title="Execute current line and move to next">
                    ⏭️ Step Over
                </button>
            </div>
            
            <div class="input-container">
                <textarea 
                    id="messageInput" 
                    placeholder="Type a message or ask about specific code..."
                    rows="1"
                ></textarea>
                <button id="sendButton">Send</button>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                const chatContainer = document.getElementById('chatContainer');
                const messageInput = document.getElementById('messageInput');
                const sendButton = document.getElementById('sendButton');
                const clearBtn = document.getElementById('clearBtn');
                const settingsBtn = document.getElementById('settingsBtn');
                const startDebugBtn = document.getElementById('startDebugBtn');
                const stopDebugBtn = document.getElementById('stopDebugBtn');
                const stepControls = document.getElementById('stepControls');
                const nextStepBtn = document.getElementById('nextStepBtn');
                const stepBackBtn = document.getElementById('stepBackBtn');
                const targetedBanner = document.getElementById('targetedBanner');
                const targetedConcept = document.getElementById('targetedConcept');
                const targetedLines = document.getElementById('targetedLines');
                const exitTargetedBtn = document.getElementById('exitTargetedBtn');

                // Configure marked options
                marked.setOptions({
                    breaks: true,
                    gfm: true
                });

                let isLoading = false;
                let currentStreamingMessage = null;
                let isWalkthroughActive = false;
                let isTargetedMode = false;

                let state = vscode.getState() || { 
                    messages: [], 
                    isWalkthroughActive: false,
                    showStepControls: false,
                    canStepBack: false,
                    targetedMode: null
                };

                function renderMarkdown(text) {
                    try {
                        return marked.parse(text);
                    } catch (e) {
                        // Fallback to plain text if markdown parsing fails
                        return escapeHtml(text);
                    }
                }

                function restoreState() {
                    if (state.messages && state.messages.length > 0) {
                        chatContainer.innerHTML = '';
                        
                        for (const msg of state.messages) {
                            if (msg.type === 'debugState') {
                                addDebugStateFromData(msg.data);
                            } else {
                                addMessageWithoutSaving(msg.text, msg.msgType, msg.isError, msg.isDebug);
                            }
                        }
                    }
                    
                    if (state.isWalkthroughActive) {
                        isWalkthroughActive = true;
                        startDebugBtn.classList.add('hidden');
                        stopDebugBtn.classList.remove('hidden');
                    }
                    
                    if (state.showStepControls) {
                        stepControls.classList.remove('hidden');
                    }

                    stepBackBtn.disabled = !state.canStepBack;

                    if (state.targetedMode) {
                        isTargetedMode = true;
                        targetedConcept.textContent = state.targetedMode.concept;
                        targetedLines.textContent = state.targetedMode.startLine + '-' + state.targetedMode.endLine;
                        targetedBanner.classList.remove('hidden');
                    }
                }

                function saveState() {
                    vscode.setState(state);
                }

                function addMessageToState(text, msgType, isError = false, isDebug = false) {
                    state.messages.push({ text, msgType, isError, isDebug, type: 'message' });
                    saveState();
                }

                function addDebugStateToState(data) {
                    state.messages.push({ type: 'debugState', data });
                    saveState();
                }

                restoreState();
                vscode.postMessage({ command: 'ready' });

                sendButton.addEventListener('click', sendMessage);
                clearBtn.addEventListener('click', clearChat);
                settingsBtn.addEventListener('click', openSettings);
                startDebugBtn.addEventListener('click', startDebugWalkthrough);
                stopDebugBtn.addEventListener('click', stopDebugWalkthrough);
                nextStepBtn.addEventListener('click', () => vscode.postMessage({ command: 'nextStep' }));
                stepBackBtn.addEventListener('click', () => vscode.postMessage({ command: 'stepBack' }));
                exitTargetedBtn.addEventListener('click', () => vscode.postMessage({ command: 'exitTargetedMode' }));
                
                messageInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                    }
                });

                messageInput.addEventListener('input', () => {
                    messageInput.style.height = 'auto';
                    messageInput.style.height = messageInput.scrollHeight + 'px';
                });

                function sendMessage() {
                    if (isLoading) return;
                    
                    const text = messageInput.value.trim();
                    if (!text) return;

                    addMessage(text, 'user');
                    messageInput.value = '';
                    messageInput.style.height = 'auto';

                    vscode.postMessage({
                        command: 'sendMessage',
                        text: text
                    });
                }

                function clearChat() {
                    chatContainer.innerHTML = \`
                        <div class="welcome">
                            <p>👋 Hi! I'm your AI programming tutor.</p>
                            <p style="margin-top: 8px;">Ask me anything about code!</p>
                            <p style="margin-top: 16px; font-size: 12px;">
                                Click <strong>🔍 Debug with AI</strong> to walk through your code step by step
                            </p>
                            <p style="margin-top: 8px; font-size: 12px;">
                                Click ⚙️ to configure your AI provider
                            </p>
                        </div>
                    \`;
                    stepControls.classList.add('hidden');
                    targetedBanner.classList.add('hidden');
                    
                    state = { messages: [], isWalkthroughActive: false, showStepControls: false, canStepBack: false, targetedMode: null };
                    saveState();
                    
                    vscode.postMessage({ command: 'clearChat' });
                }

                function openSettings() {
                    vscode.postMessage({ command: 'openSettings' });
                }

                function startDebugWalkthrough() {
                    vscode.postMessage({ command: 'startDebugWalkthrough' });
                }

                function stopDebugWalkthrough() {
                    vscode.postMessage({ command: 'stopDebugWalkthrough' });
                }

                function addMessageWithoutSaving(text, type, isError = false, isDebug = false) {
                    removeWelcome();

                    const messageDiv = document.createElement('div');
                    let className = 'message ' + type;
                    if (isError) className += ' error';
                    if (isDebug && type === 'assistant') className += ' debug';
                    messageDiv.className = className;
                    
                    // Render markdown for assistant messages, plain text for user
                    if (type === 'assistant') {
                        messageDiv.innerHTML = renderMarkdown(text);
                    } else {
                        messageDiv.textContent = text;
                    }
                    
                    chatContainer.appendChild(messageDiv);
                    scrollToBottom();
                    return messageDiv;
                }

                function addMessage(text, type, isError = false, isDebug = false) {
                    const messageDiv = addMessageWithoutSaving(text, type, isError, isDebug);
                    addMessageToState(text, type, isError, isDebug);
                    return messageDiv;
                }

                function addDebugStateFromData(stateData) {
                    removeWelcome();

                    const stateDiv = document.createElement('div');
                    stateDiv.className = 'debug-state';

                    let html = '<div class="debug-state-header">📍 Stopped at Line ' + stateData.line + '</div>';

                    if (stateData.sourceCode) {
                        html += '<div class="debug-state-section">';
                        html += '<h4>Code</h4>';
                        html += '<div class="debug-state-code"><pre>' + escapeHtml(stateData.sourceCode) + '</pre></div>';
                        html += '</div>';
                    }

                    if (stateData.variables && stateData.variables.length > 0) {
                        html += '<div class="debug-state-section">';
                        html += '<h4>Variables</h4>';
                        html += '<div class="debug-state-vars">';
                        for (const v of stateData.variables) {
                            html += '<span class="var-name">' + escapeHtml(v.name) + '</span>';
                            html += '<span class="var-value">' + escapeHtml(v.value) + ' <small>(' + escapeHtml(v.type) + ')</small></span>';
                        }
                        html += '</div>';
                        html += '</div>';
                    }

                    stateDiv.innerHTML = html;
                    chatContainer.appendChild(stateDiv);
                    scrollToBottom();
                }

                function addDebugState(stateData) {
                    addDebugStateFromData(stateData);
                    addDebugStateToState(stateData);
                }

                function escapeHtml(text) {
                    const div = document.createElement('div');
                    div.textContent = text;
                    return div.innerHTML;
                }

                function removeWelcome() {
                    const welcome = chatContainer.querySelector('.welcome');
                    if (welcome) welcome.remove();
                }

                function showLoading() {
                    removeWelcome();
                    const loadingDiv = document.createElement('div');
                    loadingDiv.className = 'loading';
                    loadingDiv.id = 'loadingIndicator';
                    loadingDiv.innerHTML = '<span></span><span></span><span></span>';
                    chatContainer.appendChild(loadingDiv);
                    scrollToBottom();
                }

                function hideLoading() {
                    const loading = document.getElementById('loadingIndicator');
                    if (loading) loading.remove();
                }

                function scrollToBottom() {
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }

                window.addEventListener('message', (event) => {
                    const message = event.data;
                    
                    switch (message.command) {
                        case 'receiveMessage':
                            addMessage(message.text, 'assistant', message.isError, message.isDebug);
                            break;
                        
                        case 'setLoading':
                            isLoading = message.isLoading;
                            sendButton.disabled = isLoading;
                            if (isLoading) {
                                showLoading();
                            } else {
                                hideLoading();
                            }
                            break;
                        
                        case 'startStream':
                            hideLoading();
                            currentStreamingMessage = addMessageWithoutSaving('', 'assistant');
                            break;
                        
                        case 'streamChunk':
                            if (currentStreamingMessage) {
                                // For streaming, we accumulate text and re-render markdown
                                const currentText = currentStreamingMessage.getAttribute('data-raw-text') || '';
                                const newText = currentText + message.text;
                                currentStreamingMessage.setAttribute('data-raw-text', newText);
                                currentStreamingMessage.innerHTML = renderMarkdown(newText);
                                scrollToBottom();
                            }
                            break;
                        
                        case 'endStream':
                            if (currentStreamingMessage) {
                                const rawText = currentStreamingMessage.getAttribute('data-raw-text') || '';
                                addMessageToState(rawText, 'assistant', false, false);
                                currentStreamingMessage.removeAttribute('data-raw-text');
                            }
                            currentStreamingMessage = null;
                            break;

                        case 'walkthroughStarted':
                            isWalkthroughActive = true;
                            startDebugBtn.classList.add('hidden');
                            stopDebugBtn.classList.remove('hidden');
                            state.isWalkthroughActive = true;
                            saveState();
                            break;

                        case 'walkthroughEnded':
                            isWalkthroughActive = false;
                            startDebugBtn.classList.remove('hidden');
                            stopDebugBtn.classList.add('hidden');
                            stepControls.classList.add('hidden');
                            targetedBanner.classList.add('hidden');
                            state.isWalkthroughActive = false;
                            state.showStepControls = false;
                            state.canStepBack = false;
                            state.targetedMode = null;
                            saveState();
                            break;

                        case 'debugState':
                            if (message.state) {
                                addDebugState(message.state);
                            }
                            break;

                        case 'showStepControls':
                            stepControls.classList.remove('hidden');
                            state.showStepControls = true;
                            saveState();
                            scrollToBottom();
                            break;

                        case 'hideStepControls':
                            stepControls.classList.add('hidden');
                            state.showStepControls = false;
                            saveState();
                            break;

                        case 'updateStepBackState':
                            stepBackBtn.disabled = !message.canStepBack;
                            state.canStepBack = message.canStepBack;
                            saveState();
                            break;

                        case 'targetedModeStarted':
                            isTargetedMode = true;
                            targetedConcept.textContent = message.concept;
                            targetedLines.textContent = message.startLine + '-' + message.endLine;
                            targetedBanner.classList.remove('hidden');
                            state.targetedMode = {
                                concept: message.concept,
                                startLine: message.startLine,
                                endLine: message.endLine
                            };
                            saveState();
                            break;

                        case 'targetedModeEnded':
                            isTargetedMode = false;
                            targetedBanner.classList.add('hidden');
                            state.targetedMode = null;
                            saveState();
                            break;
                    }
                });
            </script>
        </body>
        </html>
    `;
}
}