import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

export class ResultsServiceManager {
    private process: cp.ChildProcess | null = null;
    private outputChannel: vscode.OutputChannel;
    private workspaceRoot: string;
    private _isRunning: boolean = false;
    private _port: number = 8080;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.outputChannel = vscode.window.createOutputChannel('RF Results Service');
    }

    get isRunning(): boolean {
        return this._isRunning;
    }

    get port(): number {
        return this._port;
    }

    set port(value: number) {
        this._port = value;
    }

    async start(port?: number): Promise<boolean> {
        if (this._isRunning) {
            vscode.window.showWarningMessage('Results service is already running');
            return false;
        }

        const actualPort = port || this._port;
        this._port = actualPort;

        const scriptPath = path.join(this.workspaceRoot, 'serve_results.sh');

        try {
            this.outputChannel.show();
            this.outputChannel.appendLine(`Starting results service on port ${actualPort}...`);

            this.process = cp.spawn('bash', [scriptPath, actualPort.toString()], {
                cwd: this.workspaceRoot,
                shell: true
            });

            this._isRunning = true;

            this.process.stdout?.on('data', (data) => {
                this.outputChannel.appendLine(data.toString());
            });

            this.process.stderr?.on('data', (data) => {
                this.outputChannel.appendLine(`[ERROR] ${data.toString()}`);
            });

            this.process.on('close', (code) => {
                this._isRunning = false;
                this.outputChannel.appendLine(`Results service stopped with code ${code}`);
            });

            this.process.on('error', (err) => {
                this._isRunning = false;
                this.outputChannel.appendLine(`Error: ${err.message}`);
                vscode.window.showErrorMessage(`Failed to start results service: ${err.message}`);
            });

            // Wait a bit and open browser
            setTimeout(() => {
                if (this._isRunning) {
                    vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${actualPort}`));
                    vscode.window.showInformationMessage(`Results service started on port ${actualPort}`);
                }
            }, 1500);

            return true;
        } catch (error) {
            this._isRunning = false;
            const message = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to start results service: ${message}`);
            return false;
        }
    }

    stop(): boolean {
        if (!this._isRunning || !this.process) {
            vscode.window.showWarningMessage('Results service is not running');
            return false;
        }

        try {
            // Kill the process and any children
            if (this.process.pid) {
                process.kill(-this.process.pid);
            } else {
                this.process.kill('SIGTERM');
            }

            this._isRunning = false;
            this.outputChannel.appendLine('Results service stopped');
            vscode.window.showInformationMessage('Results service stopped');
            return true;
        } catch (error) {
            // Try alternative kill method
            try {
                cp.execSync(`pkill -f "python.*SimpleHTTPServer\\|python.*http.server"`);
                this._isRunning = false;
                this.outputChannel.appendLine('Results service stopped');
                vscode.window.showInformationMessage('Results service stopped');
                return true;
            } catch {
                const message = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Failed to stop results service: ${message}`);
                return false;
            }
        }
    }

    dispose() {
        this.stop();
        this.outputChannel.dispose();
    }
}
