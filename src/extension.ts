import * as vscode from 'vscode';
import { RFTestRunnerViewProvider } from './webviewProvider';
import { ResultsServiceManager } from './resultsService';
import { TestRunner } from './testRunner';

let resultsServiceManager: ResultsServiceManager;
let testRunner: TestRunner;

export function activate(context: vscode.ExtensionContext) {
    console.log('RF Test Runner extension is now active');

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

    resultsServiceManager = new ResultsServiceManager(workspaceRoot);
    testRunner = new TestRunner(workspaceRoot);

    const provider = new RFTestRunnerViewProvider(
        context.extensionUri,
        workspaceRoot,
        resultsServiceManager,
        testRunner
    );

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'rfTestRunner.configView',
            provider
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('rfTestRunner.startResultsService', () => {
            provider.startResultsService();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('rfTestRunner.stopResultsService', () => {
            provider.stopResultsService();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('rfTestRunner.runTests', () => {
            provider.runTests('docker');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('rfTestRunner.runTestsLocal', () => {
            provider.runTests('local');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('rfTestRunner.refreshTests', () => {
            provider.refreshTestList();
        })
    );
}

export function deactivate() {
    if (resultsServiceManager) {
        resultsServiceManager.stop();
    }
}
