import * as vscode from 'vscode';
import { ChatViewProvider } from './ChatViewProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('LLMentor extension is now active!');

    // Register the sidebar webview provider
    const chatViewProvider = new ChatViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ChatViewProvider.viewType,
            chatViewProvider
        )
    );

    // Keep the hello command
    const helloCommand = vscode.commands.registerCommand('llmentor.sayHello', () => {
        vscode.window.showInformationMessage('Hello from LLMentor! 🎉');
    });

    // Status bar button
    const statusBarButton = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarButton.text = '$(mortar-board) LLMentor';
    statusBarButton.tooltip = 'Click me!';
    statusBarButton.command = 'llmentor.sayHello';
    statusBarButton.show();

    context.subscriptions.push(helloCommand);
    context.subscriptions.push(statusBarButton);
}

export function deactivate() {}