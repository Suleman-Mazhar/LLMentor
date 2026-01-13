import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('LLMentor extension is now active!');

    // 1. Register a command that runs when button is clicked
    const helloCommand = vscode.commands.registerCommand('llmentor.sayHello', () => {
        // This shows a popup message
        vscode.window.showInformationMessage('Hello from LLMentor! 🎉');
        
        // This logs to the Debug Console
        console.log('Button was clicked!');
    });

    // 2. Create a status bar button (appears at bottom of VS Code)
    const statusBarButton = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarButton.text = '$(lightbulb) LLMentor';  // $(lightbulb) is a built-in icon
    statusBarButton.tooltip = 'Click me!';
    statusBarButton.command = 'llmentor.sayHello';   // Links to our command
    statusBarButton.show();

    // 3. Add to subscriptions so they're cleaned up on deactivate
    context.subscriptions.push(helloCommand);
    context.subscriptions.push(statusBarButton);
}

export function deactivate() {
    console.log('LLMentor extension deactivated');
}