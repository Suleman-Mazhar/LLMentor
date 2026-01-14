import * as vscode from 'vscode';

export interface DebugState {
    file: string;
    line: number;
    function: string;
    variables: Variable[];
    callStack: StackFrame[];
    sourceCode?: string;
}

export interface Variable {
    name: string;
    value: string;
    type: string;
}

export interface StackFrame {
    name: string;
    file: string;
    line: number;
}

export interface ToolResult {
    success: boolean;
    data?: any;
    error?: string;
    state?: DebugState;
}

export class DebuggerTool {
    private currentThreadId: number = 1;
    private isDebugging: boolean = false;
    private stoppedPromiseResolve: ((value: void) => void) | null = null;
    
    // For step back functionality
    private stateHistory: DebugState[] = [];
    private breakpointLines: number[] = [];
    private currentFile: string = '';

    constructor() {
        vscode.debug.onDidChangeActiveStackItem(() => {
            if (this.stoppedPromiseResolve) {
                this.stoppedPromiseResolve();
                this.stoppedPromiseResolve = null;
            }
        });

        vscode.debug.onDidTerminateDebugSession(() => {
            this.isDebugging = false;
            this.stateHistory = [];
            this.breakpointLines = [];
        });
    }

    public getIsDebugging(): boolean {
        return this.isDebugging;
    }

    public canStepBack(): boolean {
        return this.stateHistory.length > 1;
    }

    public getStateHistoryLength(): number {
        return this.stateHistory.length;
    }

    public async execute(action: string, params?: any): Promise<ToolResult> {
        try {
            switch (action) {
                case 'start':
                    return await this.startDebugging(params?.file);
                case 'set_breakpoints':
                    return await this.setBreakpoints(params?.file, params?.lines);
                case 'step_over':
                    return await this.stepOver();
                case 'step_back':
                    return await this.stepBack();
                case 'step_into':
                    return await this.stepInto();
                case 'step_out':
                    return await this.stepOut();
                case 'continue':
                    return await this.continueExecution();
                case 'get_variables':
                    return await this.getVariables();
                case 'get_call_stack':
                    return await this.getCallStack();
                case 'get_current_location':
                    return await this.getCurrentLocation();
                case 'get_state':
                    return await this.getFullState();
                case 'evaluate':
                    return await this.evaluate(params?.expression);
                case 'stop':
                    return await this.stopDebugging();
                default:
                    return { success: false, error: `Unknown action: ${action}` };
            }
        } catch (error) {
            return { success: false, error: String(error) };
        }
    }

    private async startDebugging(filePath?: string): Promise<ToolResult> {
        const editor = vscode.window.activeTextEditor;
        const file = filePath || editor?.document.uri.fsPath;

        if (!file) {
            return { success: false, error: 'No file to debug' };
        }

        this.currentFile = file;
        this.stateHistory = [];
        this.breakpointLines = [];

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const config = this.getDebugConfig(file);

        const started = await vscode.debug.startDebugging(workspaceFolder, config);

        if (started) {
            this.isDebugging = true;
            await this.waitForStop(2000);
            
            // Save initial state
            const stateResult = await this.getFullState();
            if (stateResult.state) {
                this.stateHistory.push(stateResult.state);
            }
            
            return { success: true, data: { message: 'Debug session started' }, state: stateResult.state };
        }

        return { success: false, error: 'Failed to start debug session' };
    }

    private getDebugConfig(filePath: string): vscode.DebugConfiguration {
        const ext = filePath.split('.').pop()?.toLowerCase();

        switch (ext) {
            case 'py':
                return {
                    type: 'debugpy',
                    request: 'launch',
                    name: 'LLMentor Debug',
                    program: filePath,
                    console: 'integratedTerminal',
                    stopOnEntry: true,
                    justMyCode: true
                };
            case 'js':
                return {
                    type: 'node',
                    request: 'launch',
                    name: 'LLMentor Debug',
                    program: filePath,
                    stopOnEntry: true
                };
            case 'ts':
                return {
                    type: 'node',
                    request: 'launch',
                    name: 'LLMentor Debug',
                    program: filePath,
                    stopOnEntry: true,
                    runtimeArgs: ['--loader', 'ts-node/esm']
                };
            default:
                return {
                    type: 'node',
                    request: 'launch',
                    name: 'LLMentor Debug',
                    program: filePath,
                    stopOnEntry: true
                };
        }
    }

    private async setBreakpoints(file: string, lines: number[]): Promise<ToolResult> {
        if (!file || !lines || lines.length === 0) {
            return { success: false, error: 'File and lines are required' };
        }

        try {
            const uri = vscode.Uri.file(file);
            const breakpoints = lines.map(line => {
                const location = new vscode.Location(uri, new vscode.Position(line - 1, 0));
                return new vscode.SourceBreakpoint(location);
            });

            const existingBps = vscode.debug.breakpoints.filter(bp => {
                if (bp instanceof vscode.SourceBreakpoint) {
                    return bp.location.uri.fsPath === file;
                }
                return false;
            });
            vscode.debug.removeBreakpoints(existingBps);

            vscode.debug.addBreakpoints(breakpoints);
            this.breakpointLines = lines;

            return {
                success: true,
                data: { message: `Set ${lines.length} breakpoints at lines: ${lines.join(', ')}` }
            };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    }

    private async stepOver(): Promise<ToolResult> {
        const session = vscode.debug.activeDebugSession;
        if (!session) {
            return { success: false, error: 'No active debug session' };
        }

        await session.customRequest('next', { threadId: this.currentThreadId });
        await this.waitForStop();
        
        const result = await this.getFullState();
        
        // Save state to history
        if (result.state) {
            this.stateHistory.push(result.state);
        }
        
        return result;
    }

    private async stepBack(): Promise<ToolResult> {
        if (this.stateHistory.length <= 1) {
            return { success: false, error: 'Cannot step back - at the beginning' };
        }

        // Remove current state
        this.stateHistory.pop();
        
        // Get the target state (the previous one)
        const targetState = this.stateHistory[this.stateHistory.length - 1];
        const targetLine = targetState.line;

        // Stop current session
        await this.stopDebugging();
        await this.delay(300);

        // Restart debugging
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const config = this.getDebugConfig(this.currentFile);
        
        const started = await vscode.debug.startDebugging(workspaceFolder, config);
        
        if (!started) {
            return { success: false, error: 'Failed to restart debugger for step back' };
        }

        this.isDebugging = true;
        await this.waitForStop(2000);

        // Step forward until we reach the target line
        const session = vscode.debug.activeDebugSession;
        if (!session) {
            return { success: false, error: 'No active debug session after restart' };
        }

        let currentLine = 0;
        let maxSteps = 1000; // Safety limit
        let steps = 0;

        while (steps < maxSteps) {
            const locationResult = await this.getCurrentLocation();
            currentLine = locationResult.data?.line || 0;

            if (currentLine >= targetLine) {
                break;
            }

            await session.customRequest('next', { threadId: this.currentThreadId });
            await this.waitForStop(500);
            steps++;

            // Check if debugging ended
            if (!this.isDebugging || !vscode.debug.activeDebugSession) {
                return { success: false, error: 'Program ended before reaching target line' };
            }
        }

        return await this.getFullState();
    }

    private async stepInto(): Promise<ToolResult> {
        const session = vscode.debug.activeDebugSession;
        if (!session) {
            return { success: false, error: 'No active debug session' };
        }

        await session.customRequest('stepIn', { threadId: this.currentThreadId });
        await this.waitForStop();
        
        const result = await this.getFullState();
        
        if (result.state) {
            this.stateHistory.push(result.state);
        }
        
        return result;
    }

    private async stepOut(): Promise<ToolResult> {
        const session = vscode.debug.activeDebugSession;
        if (!session) {
            return { success: false, error: 'No active debug session' };
        }

        await session.customRequest('stepOut', { threadId: this.currentThreadId });
        await this.waitForStop();
        
        const result = await this.getFullState();
        
        if (result.state) {
            this.stateHistory.push(result.state);
        }
        
        return result;
    }

    private async continueExecution(): Promise<ToolResult> {
        const session = vscode.debug.activeDebugSession;
        if (!session) {
            return { success: false, error: 'No active debug session' };
        }

        await session.customRequest('continue', { threadId: this.currentThreadId });
        await this.waitForStop();
        
        const result = await this.getFullState();
        
        if (result.state) {
            this.stateHistory.push(result.state);
        }
        
        return result;
    }

    private async getVariables(): Promise<ToolResult> {
        const session = vscode.debug.activeDebugSession;
        if (!session) {
            return { success: false, error: 'No active debug session' };
        }

        try {
            const stackResponse = await session.customRequest('stackTrace', {
                threadId: this.currentThreadId
            });

            if (!stackResponse.stackFrames?.length) {
                return { success: true, data: { variables: [] } };
            }

            const frameId = stackResponse.stackFrames[0].id;
            const scopesResponse = await session.customRequest('scopes', { frameId });

            const allVariables: Variable[] = [];

            for (const scope of scopesResponse.scopes) {
                if (scope.name === 'Global' || scope.name === 'Globals') continue;

                const varsResponse = await session.customRequest('variables', {
                    variablesReference: scope.variablesReference
                });

                for (const v of varsResponse.variables) {
                    if (v.name.startsWith('__')) continue;

                    allVariables.push({
                        name: v.name,
                        value: v.value,
                        type: v.type || 'unknown'
                    });
                }
            }

            return { success: true, data: { variables: allVariables } };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    }

    private async getCallStack(): Promise<ToolResult> {
        const session = vscode.debug.activeDebugSession;
        if (!session) {
            return { success: false, error: 'No active debug session' };
        }

        try {
            const response = await session.customRequest('stackTrace', {
                threadId: this.currentThreadId
            });

            const callStack: StackFrame[] = response.stackFrames.map((frame: any) => ({
                name: frame.name,
                file: frame.source?.path || 'unknown',
                line: frame.line
            }));

            return { success: true, data: { callStack } };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    }

    private async getCurrentLocation(): Promise<ToolResult> {
        const session = vscode.debug.activeDebugSession;
        if (!session) {
            return { success: false, error: 'No active debug session' };
        }

        try {
            const response = await session.customRequest('stackTrace', {
                threadId: this.currentThreadId
            });

            const topFrame = response.stackFrames?.[0];
            if (topFrame) {
                return {
                    success: true,
                    data: {
                        file: topFrame.source?.path,
                        line: topFrame.line,
                        function: topFrame.name
                    }
                };
            }
            return { success: false, error: 'No stack frame available' };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    }

    private async getFullState(): Promise<ToolResult> {
        const session = vscode.debug.activeDebugSession;
        if (!session) {
            return { success: false, error: 'No active debug session' };
        }

        try {
            const [location, variables, callStack] = await Promise.all([
                this.getCurrentLocation(),
                this.getVariables(),
                this.getCallStack()
            ]);

            let sourceCode = '';
            if (location.success && location.data?.file) {
                try {
                    const doc = await vscode.workspace.openTextDocument(location.data.file);
                    const currentLine = location.data.line - 1;
                    const startLine = Math.max(0, currentLine - 2);
                    const endLine = Math.min(doc.lineCount - 1, currentLine + 2);

                    const lines: string[] = [];
                    for (let i = startLine; i <= endLine; i++) {
                        const prefix = i === currentLine ? '>>> ' : '    ';
                        lines.push(`${prefix}${i + 1}: ${doc.lineAt(i).text}`);
                    }
                    sourceCode = lines.join('\n');
                } catch (e) {
                    // Ignore source code errors
                }
            }

            const state: DebugState = {
                file: location.data?.file || '',
                line: location.data?.line || 0,
                function: location.data?.function || '',
                variables: variables.data?.variables || [],
                callStack: callStack.data?.callStack || [],
                sourceCode
            };

            return { success: true, state };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    }

    private async evaluate(expression: string): Promise<ToolResult> {
        const session = vscode.debug.activeDebugSession;
        if (!session) {
            return { success: false, error: 'No active debug session' };
        }

        if (!expression) {
            return { success: false, error: 'Expression is required' };
        }

        try {
            const stackResponse = await session.customRequest('stackTrace', {
                threadId: this.currentThreadId
            });
            const frameId = stackResponse.stackFrames?.[0]?.id;

            const result = await session.customRequest('evaluate', {
                expression,
                frameId,
                context: 'repl'
            });

            return {
                success: true,
                data: {
                    expression,
                    result: result.result,
                    type: result.type
                }
            };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    }

    private async stopDebugging(): Promise<ToolResult> {
        const session = vscode.debug.activeDebugSession;
        if (session) {
            await vscode.debug.stopDebugging(session);
        }
        this.isDebugging = false;
        return { success: true, data: { message: 'Debug session stopped' } };
    }

    private waitForStop(timeout: number = 5000): Promise<void> {
        return new Promise((resolve) => {
            this.stoppedPromiseResolve = resolve;
            setTimeout(() => {
                if (this.stoppedPromiseResolve) {
                    this.stoppedPromiseResolve = null;
                    resolve();
                }
            }, timeout);
        });
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}