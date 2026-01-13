import * as vscode from 'vscode';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'llmentor.chatView';
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        // Configure webview options
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        // Set the HTML content
        webviewView.webview.html = this._getHtmlContent();

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage((message) => {
            switch (message.command) {
                case 'sendMessage':
                    this._handleUserMessage(message.text);
                    break;
            }
        });
    }

    private _handleUserMessage(text: string) {
        // For now, just echo back the message
        vscode.window.showInformationMessage(`You said: ${text}`);
        
        // Send a response back to the webview
        if (this._view) {
            this._view.webview.postMessage({
                command: 'receiveMessage',
                text: `You said: "${text}" - I'll be smarter soon!`
            });
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
                    }
                    .header h2 {
                        font-size: 14px;
                        font-weight: 600;
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
                    }
                    #sendButton:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    .welcome {
                        text-align: center;
                        padding: 20px;
                        color: var(--vscode-descriptionForeground);
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h2>🎓 LLMentor</h2>
                </div>
                
                <div class="chat-container" id="chatContainer">
                    <div class="welcome">
                        <p>👋 Hi! I'm your AI programming tutor.</p>
                        <p style="margin-top: 8px;">Ask me anything!</p>
                    </div>
                </div>
                
                <div class="input-container">
                    <input 
                        type="text" 
                        id="messageInput" 
                        placeholder="Type a message..."
                    />
                    <button id="sendButton">Send</button>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    const chatContainer = document.getElementById('chatContainer');
                    const messageInput = document.getElementById('messageInput');
                    const sendButton = document.getElementById('sendButton');

                    // Send message when button clicked
                    sendButton.addEventListener('click', sendMessage);
                    
                    // Send message when Enter pressed
                    messageInput.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') {
                            sendMessage();
                        }
                    });

                    function sendMessage() {
                        const text = messageInput.value.trim();
                        if (!text) return;

                        // Add user message to chat
                        addMessage(text, 'user');
                        
                        // Clear input
                        messageInput.value = '';

                        // Send to extension
                        vscode.postMessage({
                            command: 'sendMessage',
                            text: text
                        });
                    }

                    function addMessage(text, type) {
                        // Remove welcome message if present
                        const welcome = chatContainer.querySelector('.welcome');
                        if (welcome) {
                            welcome.remove();
                        }

                        const messageDiv = document.createElement('div');
                        messageDiv.className = 'message ' + type;
                        messageDiv.textContent = text;
                        chatContainer.appendChild(messageDiv);
                        
                        // Scroll to bottom
                        chatContainer.scrollTop = chatContainer.scrollHeight;
                    }

                    // Handle messages from extension
                    window.addEventListener('message', (event) => {
                        const message = event.data;
                        if (message.command === 'receiveMessage') {
                            addMessage(message.text, 'assistant');
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }
}