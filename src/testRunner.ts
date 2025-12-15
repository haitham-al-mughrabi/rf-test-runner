import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

export interface TestConfig {
    // Common options
    testPaths: string;
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
    testPaths: 'Tests',
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

    buildDockerCommand(config: TestConfig): string[] {
        const args: string[] = [];

        if (config.headless) {args.push('--headless');}
        if (config.maximizeBrowser) {args.push('--maximize-browser');}
        if (config.fullWidthViewport) {args.push('--full-width-viewport');}
        if (config.keepVncOpen) {args.push('--keep-vnc-open');}

        args.push('--captcha-solver', config.captchaSolver.toString());
        args.push('--window-full', config.windowFull.toString());
        args.push('--window-maximized', config.windowMaximized.toString());
        args.push('--run-offline', config.runOffline.toString());
        args.push('--dev-tools', config.devTools.toString());
        args.push('--chrome-security-sandbox', config.chromeSecuritySandbox.toString());
        args.push('--playwright-tracing', config.playwrightTracing.toString());
        args.push('--environment', config.developmentEnvironment);
        args.push('--execution-env', config.executionEnv);
        args.push('--omit-content', config.omitContent.toString());
        args.push('--record-video', config.recordVideo.toString());
        args.push('--enable-har', config.enableHar.toString());
        args.push('--window-height', config.windowHeight.toString());
        args.push('--window-width', config.windowWidth.toString());
        args.push('--context-type', config.contextType);
        args.push('--log-level', config.logLevel);
        args.push('--report-title', `"${config.reportTitle}"`);
        args.push('--auto-close-browser', config.autoCloseBrowser.toString());

        if (config.customVariables.trim()) {
            const vars = config.customVariables.split('\n').filter(v => v.trim());
            for (const v of vars) {
                args.push('-v', v.trim());
            }
        }

        args.push(config.testPaths);

        return args;
    }

    buildLocalCommand(config: TestConfig): string[] {
        const args: string[] = [];

        if (config.headless) {args.push('--headless');}
        if (config.installDependencies) {args.push('--install-dependencies');}
        if (config.checkDeps) {args.push('--check-deps');}

        args.push('--captcha-solver', config.captchaSolver.toString());
        args.push('--window-full', config.windowFull.toString());
        args.push('--window-maximized', config.windowMaximized.toString());
        args.push('--run-offline', config.runOffline.toString());
        args.push('--dev-tools', config.devTools.toString());
        args.push('--chrome-security-sandbox', config.chromeSecuritySandbox.toString());
        args.push('--playwright-tracing', config.playwrightTracing.toString());
        args.push('--environment', config.developmentEnvironment);
        args.push('--execution-env', config.executionEnv);
        args.push('--omit-content', config.omitContent.toString());
        args.push('--record-video', config.recordVideo.toString());
        args.push('--enable-har', config.enableHar.toString());
        args.push('--window-height', config.windowHeight.toString());
        args.push('--window-width', config.windowWidth.toString());
        args.push('--context-type', config.contextType);
        args.push('--log-level', config.logLevel);
        args.push('--report-title', `"${config.reportTitle}"`);

        if (config.customVariables.trim()) {
            const vars = config.customVariables.split('\n').filter(v => v.trim());
            for (const v of vars) {
                args.push('-v', v.trim());
            }
        }

        args.push(config.testPaths);

        return args;
    }

    async run(mode: 'docker' | 'local', config: TestConfig): Promise<void> {
        if (this._isRunning) {
            vscode.window.showWarningMessage('A test is already running');
            return;
        }

        const scriptName = mode === 'docker' ? 'run_tests.sh' : 'run_tests_local.sh';
        const scriptPath = path.join(this.workspaceRoot, scriptName);
        const args = mode === 'docker'
            ? this.buildDockerCommand(config)
            : this.buildLocalCommand(config);

        this.outputChannel.show();
        this.outputChannel.clear();
        this.outputChannel.appendLine(`Starting ${mode} test execution...`);
        this.outputChannel.appendLine(`Command: bash ${scriptPath} ${args.join(' ')}`);
        this.outputChannel.appendLine('---');

        try {
            this._isRunning = true;

            this.currentProcess = cp.spawn('bash', [scriptPath, ...args], {
                cwd: this.workspaceRoot,
                shell: true,
                detached: true
            });

            this.currentProcess.stdout?.on('data', (data) => {
                this.outputChannel.append(data.toString());
            });

            this.currentProcess.stderr?.on('data', (data) => {
                this.outputChannel.append(data.toString());
            });

            this.currentProcess.on('close', (code) => {
                this._isRunning = false;
                this.outputChannel.appendLine('---');
                this.outputChannel.appendLine(`Test execution finished with code ${code}`);

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
                if (this.currentProcess.pid) {
                    process.kill(-this.currentProcess.pid, 'SIGTERM');
                } else {
                    this.currentProcess.kill('SIGTERM');
                }
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
