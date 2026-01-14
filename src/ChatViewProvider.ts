import * as vscode from 'vscode';
import { LLMService, LLMConfig, ChatMessage } from './LLMService';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'llmentor.chatView';
    private _view?: vscode.WebviewView;
    private _llmService: LLMService | null = null;
    private _chatHistory: ChatMessage[] = [];

    private readonly _systemPrompt = `You are LLMentor, a friendly and helpful AI programming tutor. 
Your goal is to help students learn programming concepts clearly and effectively.
- Explain concepts in simple terms
- Use examples when helpful
- Encourage the student and be patient
- If you see code, offer to help debug or explain it
- Keep responses concise but thorough`;

    constructor(private readonly _extensionUri: vscode.Uri) {
        this._initializeLLMService();

        // Listen for config changes
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

        // Add provider-specific config
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

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'sendMessage':
                    await this._handleUserMessage(message.text);
                    break;
                case 'clearChat':
                    this._chatHistory = [];
                    break;
                case 'openSettings':
                    vscode.commands.executeCommand('llmentor.openSettings');
                    break;
            }
        });
    }

    private async _handleUserMessage(text: string) {
        if (!this._llmService) {
            this._sendToWebview('receiveMessage', {
                text: '⚠️ LLM not configured. Please check your settings (click ⚙️ above).',
                isError: true
            });
            return;
        }

        // Add user message to history
        this._chatHistory.push({ role: 'user', content: text });

        // Show loading state
        this._sendToWebview('setLoading', { isLoading: true });

        try {
            // Use streaming for better UX
            let fullResponse = '';
            
            // Create a placeholder for the streaming response
            this._sendToWebview('startStream', {});

            for await (const chunk of this._llmService.chatStream(this._chatHistory, this._systemPrompt)) {
                fullResponse += chunk;
                this._sendToWebview('streamChunk', { text: chunk });
            }

            this._sendToWebview('endStream', {});

            // Add assistant response to history
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

    private _getHtmlContent(): string {
        return /*html*/ `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>LLMentor</title>
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
                        white-space: pre-wrap;
                        word-wrap: break-word;
                    }
                    .message.user {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        margin-left: auto;
                    }
                    .message.assistant {
                        background-color: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-panel-border);
                    }
                    .message.error {
                        background-color: var(--vscode-inputValidation-errorBackground);
                        border: 1px solid var(--vscode-inputValidation-errorBorder);
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
                    .provider-badge {
                        font-size: 10px;
                        padding: 2px 6px;
                        border-radius: 4px;
                        background-color: var(--vscode-badge-background);
                        color: var(--vscode-badge-foreground);
                        margin-left: 8px;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h2>🎓 LLMentor</h2>
                    <div class="header-buttons">
                        <button class="icon-btn" id="settingsBtn" title="Settings">⚙️</button>
                        <button class="icon-btn" id="clearBtn" title="Clear Chat">🗑️</button>
                    </div>
                </div>
                
                <div class="chat-container" id="chatContainer">
                    <div class="welcome">
                        <p>👋 Hi! I'm your AI programming tutor.</p>
                        <p style="margin-top: 8px;">Ask me anything about code!</p>
                        <p style="margin-top: 16px; font-size: 12px;">
                            Click ⚙️ to configure your AI provider
                        </p>
                    </div>
                </div>
                
                <div class="input-container">
                    <textarea 
                        id="messageInput" 
                        placeholder="Type a message..."
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

                    let isLoading = false;
                    let currentStreamingMessage = null;

                    sendButton.addEventListener('click', sendMessage);
                    clearBtn.addEventListener('click', clearChat);
                    settingsBtn.addEventListener('click', openSettings);
                    
                    messageInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendMessage();
                        }
                    });

                    // Auto-resize textarea
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
                                    Click ⚙️ to configure your AI provider
                                </p>
                            </div>
                        \`;
                        vscode.postMessage({ command: 'clearChat' });
                    }

                    function openSettings() {
                        vscode.postMessage({ command: 'openSettings' });
                    }

                    function addMessage(text, type, isError = false) {
                        removeWelcome();

                        const messageDiv = document.createElement('div');
                        messageDiv.className = 'message ' + type + (isError ? ' error' : '');
                        messageDiv.textContent = text;
                        chatContainer.appendChild(messageDiv);
                        scrollToBottom();
                        return messageDiv;
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

                    // Handle messages from extension
                    window.addEventListener('message', (event) => {
                        const message = event.data;
                        
                        switch (message.command) {
                            case 'receiveMessage':
                                addMessage(message.text, 'assistant', message.isError);
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
                                currentStreamingMessage = addMessage('', 'assistant');
                                break;
                            
                            case 'streamChunk':
                                if (currentStreamingMessage) {
                                    currentStreamingMessage.textContent += message.text;
                                    scrollToBottom();
                                }
                                break;
                            
                            case 'endStream':
                                currentStreamingMessage = null;
                                break;
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }
}