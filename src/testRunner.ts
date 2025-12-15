import * as vscode from 'vscode';
import * as cp from 'child_process';

export interface TestSelection {
    type: 'test' | 'suite' | 'module';
    name: string;        // Display name
    path: string;        // File/folder path (for suite/module)
    testName?: string;   // Test case name (for individual tests)
}

export interface TestConfig {
    // Test selection
    selections: TestSelection[];
    customTestPath: string;
    testCaseNames: string[];  // Individual test case names to run with --test

    // Common options
    captchaSolver: boolean;
    windowFull: boolean;
    windowMaximized: boolean;
    headless: boolean;
    runOffline: boolean;
    devTools: boolean;
    chromeSecuritySandbox: boolean;
    playwrightTracing: boolean;
    developmentEnvironment: string;
    executionEnv: string;
    omitContent: boolean;
    recordVideo: boolean;
    enableHar: boolean;
    windowHeight: number;
    windowWidth: number;
    contextType: string;
    logLevel: string;
    reportTitle: string;
    customVariables: string;

    // Docker-only options
    maximizeBrowser: boolean;
    autoCloseBrowser: boolean;
    keepVncOpen: boolean;
    fullWidthViewport: boolean;
    imageName: string;

    // Local-only options
    installDependencies: boolean;
    checkDeps: boolean;
}

export const defaultConfig: TestConfig = {
    selections: [],
    customTestPath: '',
    testCaseNames: [],
    captchaSolver: true,
    windowFull: false,
    windowMaximized: false,
    headless: false,
    runOffline: false,
    devTools: false,
    chromeSecuritySandbox: false,
    playwrightTracing: false,
    developmentEnvironment: 'uat',
    executionEnv: 'local',
    omitContent: false,
    recordVideo: false,
    enableHar: false,
    windowHeight: 1080,
    windowWidth: 1920,
    contextType: 'NORMAL',
    logLevel: 'TRACE',
    reportTitle: 'Unified Automation Regression Testing Report',
    customVariables: '',
    maximizeBrowser: false,
    autoCloseBrowser: true,
    keepVncOpen: false,
    fullWidthViewport: false,
    imageName: 'robot-framework-custom:latest',
    installDependencies: false,
    checkDeps: false
};

export class TestRunner {
    private outputChannel: vscode.OutputChannel;
    private workspaceRoot: string;
    private currentProcess: cp.ChildProcess | null = null;
    private _isRunning: boolean = false;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.outputChannel = vscode.window.createOutputChannel('RF Test Runner');
    }

    get isRunning(): boolean {
        return this._isRunning;
    }

    /**
     * Determines the test path based on selections
     */
    private getTestPath(config: TestConfig): string {
        // If custom path is provided, use it directly
        if (config.customTestPath.trim()) {
            return config.customTestPath.trim();
        }

        // If no selections, run all tests
        if (config.selections.length === 0) {
            return 'Tests';
        }

        // Collect unique paths from selections
        const paths: string[] = [];
        for (const sel of config.selections) {
            if (sel.type === 'suite' || sel.type === 'module') {
                if (!paths.includes(sel.path)) {
                    paths.push(sel.path);
                }
            } else if (sel.type === 'test') {
                // For individual tests, we need the suite path
                if (!paths.includes(sel.path)) {
                    paths.push(sel.path);
                }
            }
        }

        return paths.length > 0 ? paths.join(' ') : 'Tests';
    }

    /**
     * Build the complete shell command as a single string
     */
    buildCommand(mode: 'docker' | 'local', config: TestConfig): string {
        const parts: string[] = [];
        const scriptName = mode === 'docker' ? './run_tests.sh' : './run_tests_local.sh';

        // Script-level flags (no values)
        if (config.headless) {
            parts.push('--headless');
        }

        if (mode === 'docker') {
            if (config.maximizeBrowser) { parts.push('--maximize-browser'); }
            if (config.fullWidthViewport) { parts.push('--full-width-viewport'); }
            if (config.keepVncOpen) { parts.push('--keep-vnc-open'); }
        }

        if (mode === 'local') {
            if (config.installDependencies) { parts.push('--install-dependencies'); }
            if (config.checkDeps) { parts.push('--check-deps'); }
        }

        // Options with values
        parts.push(`--captcha-solver ${config.captchaSolver}`);
        parts.push(`--window-full ${config.windowFull}`);
        parts.push(`--window-maximized ${config.windowMaximized}`);
        parts.push(`--run-offline ${config.runOffline}`);
        parts.push(`--dev-tools ${config.devTools}`);
        parts.push(`--chrome-security-sandbox ${config.chromeSecuritySandbox}`);
        parts.push(`--playwright-tracing ${config.playwrightTracing}`);
        parts.push(`--environment ${config.developmentEnvironment}`);
        parts.push(`--execution-env ${config.executionEnv}`);
        parts.push(`--omit-content ${config.omitContent}`);
        parts.push(`--record-video ${config.recordVideo}`);
        parts.push(`--enable-har ${config.enableHar}`);
        parts.push(`--window-height ${config.windowHeight}`);
        parts.push(`--window-width ${config.windowWidth}`);
        parts.push(`--context-type ${config.contextType}`);
        parts.push(`--log-level ${config.logLevel}`);
        parts.push(`--report-title "${config.reportTitle}"`);

        if (mode === 'docker') {
            parts.push(`--auto-close-browser ${config.autoCloseBrowser}`);
        }

        // Custom variables (passed to script which passes to robot)
        if (config.customVariables.trim()) {
            const vars = config.customVariables.split('\n').filter(v => v.trim());
            for (const v of vars) {
                parts.push(`-v "${v.trim()}"`);
            }
        }

        // Individual test case names - use --test option to filter specific tests
        if (config.testCaseNames.length > 0) {
            for (const testName of config.testCaseNames) {
                parts.push(`--test "${testName}"`);
            }
        }

        // Add test path at the end
        const testPath = this.getTestPath(config);
        parts.push(testPath);

        return `${scriptName} ${parts.join(' ')}`;
    }

    async run(mode: 'docker' | 'local', config: TestConfig): Promise<void> {
        if (this._isRunning) {
            vscode.window.showWarningMessage('A test is already running');
            return;
        }

        const command = this.buildCommand(mode, config);

        this.outputChannel.show();
        this.outputChannel.clear();
        this.outputChannel.appendLine(`Starting ${mode} test execution...`);
        this.outputChannel.appendLine(`Working directory: ${this.workspaceRoot}`);
        this.outputChannel.appendLine(`Command: ${command}`);
        this.outputChannel.appendLine('');
        this.outputChannel.appendLine('='.repeat(70));
        this.outputChannel.appendLine('');

        try {
            this._isRunning = true;

            // Use shell execution directly for proper argument handling
            this.currentProcess = cp.spawn(command, [], {
                cwd: this.workspaceRoot,
                shell: '/bin/bash',
                env: { ...process.env, FORCE_COLOR: '1' }
            });

            this.currentProcess.stdout?.on('data', (data) => {
                this.outputChannel.append(data.toString());
            });

            this.currentProcess.stderr?.on('data', (data) => {
                this.outputChannel.append(data.toString());
            });

            this.currentProcess.on('close', (code) => {
                this._isRunning = false;
                this.outputChannel.appendLine('');
                this.outputChannel.appendLine('='.repeat(70));
                this.outputChannel.appendLine(`Test execution finished with exit code: ${code}`);

                if (code === 0) {
                    vscode.window.showInformationMessage('Tests completed successfully!');
                } else {
                    vscode.window.showWarningMessage(`Tests finished with exit code ${code}`);
                }
            });

            this.currentProcess.on('error', (err) => {
                this._isRunning = false;
                this.outputChannel.appendLine(`Error: ${err.message}`);
                vscode.window.showErrorMessage(`Test execution failed: ${err.message}`);
            });

        } catch (error) {
            this._isRunning = false;
            const message = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to start tests: ${message}`);
        }
    }

    stop(): void {
        if (this.currentProcess && this._isRunning) {
            try {
                // Kill the process tree
                if (this.currentProcess.pid) {
                    cp.exec(`pkill -P ${this.currentProcess.pid}`);
                }
                this.currentProcess.kill('SIGTERM');
                this._isRunning = false;
                this.outputChannel.appendLine('\n--- Test execution stopped by user ---');
                vscode.window.showInformationMessage('Test execution stopped');
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Failed to stop tests: ${message}`);
            }
        }
    }

    dispose() {
        this.stop();
        this.outputChannel.dispose();
    }
}
