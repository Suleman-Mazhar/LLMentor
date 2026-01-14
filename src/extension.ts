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

    // Command to open settings directly
    const openSettings = vscode.commands.registerCommand('llmentor.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', '@ext:undefined_publisher.llmentor');
    });

    // Command to quickly select provider
    const selectProvider = vscode.commands.registerCommand('llmentor.selectProvider', async () => {
        const choice = await vscode.window.showQuickPick(
            [
                { label: '$(server) Ollama (Local)', value: 'ollama', description: 'Free, runs locally' },
                { label: '$(cloud) Anthropic (Claude)', value: 'anthropic', description: 'Requires API key' },
                { label: '$(cloud) OpenAI', value: 'openai', description: 'Requires API key' }
            ],
            { placeHolder: 'Select AI Provider' }
        );

        if (choice) {
            const config = vscode.workspace.getConfiguration('llmentor');
            await config.update('provider', choice.value, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`LLMentor: Switched to ${choice.label}`);
        }
    });

    // Status bar button
    const statusBarButton = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarButton.text = '$(mortar-board) LLMentor';
    statusBarButton.tooltip = 'Select AI Provider';
    statusBarButton.command = 'llmentor.selectProvider';
    statusBarButton.show();

    context.subscriptions.push(openSettings);
    context.subscriptions.push(selectProvider);
    context.subscriptions.push(statusBarButton);
}

export function deactivate() {}