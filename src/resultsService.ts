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

    /**
     * Check if a port is in use and kill the process if necessary
     */
    private async killProcessOnPort(port: number): Promise<void> {
        try {
            // Check if the port is in use with lsof command (macOS/Linux)
            const result = cp.execSync(`lsof -i :${port} -t`, { encoding: 'utf-8', stdio: 'pipe' });
            const pids = result.trim().split('\n').filter(pid => pid.length > 0);

            if (pids.length > 0) {
                this.outputChannel.appendLine(`Found process(es) using port ${port}: ${pids.join(', ')}`);

                // Kill the processes using the port
                for (const pid of pids) {
                    try {
                        process.kill(parseInt(pid), 'SIGTERM');
                        this.outputChannel.appendLine(`Sent SIGTERM to process ${pid}`);
                    } catch (killError: any) {
                        if (killError.code === 'ESRCH') {
                            // Process already gone, continue
                            this.outputChannel.appendLine(`Process ${pid} was already terminated`);
                        } else {
                            // Try with SIGKILL if SIGTERM failed
                            try {
                                cp.execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
                                this.outputChannel.appendLine(`Sent SIGKILL to process ${pid}`);
                            } catch (killError2) {
                                this.outputChannel.appendLine(`Could not kill process ${pid}: ${killError2}`);
                            }
                        }
                    }
                }

                // Wait a bit for processes to terminate
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error: any) {
            // lsof command failed, which means the port is likely not in use
            // This is expected when no process is using the port
            if (error.status !== 1 || !error.stdout.includes('No matching')) {
                // Just log it as info, not as error since it's expected behavior when port is not used
                this.outputChannel.appendLine(`Port ${port} is not currently in use or lsof command not available`);
            }
        }
    }

    async start(port?: number): Promise<boolean> {
        if (this._isRunning) {
            vscode.window.showWarningMessage('Results service is already running');
            return false;
        }

        const actualPort = port || this._port;
        this._port = actualPort;

        // Check if the port is already in use and try to kill the process
        await this.killProcessOnPort(actualPort);

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
            // Check if the process might have already terminated
            if (this.process && this.process.exitCode !== null) {
                // Process has already exited, just update our state
                this._isRunning = false;
                this.outputChannel.appendLine('Results service was already stopped');
                return true;
            }
            vscode.window.showWarningMessage('Results service is not running');
            return false;
        }

        try {
            // Kill the process and any children (only if process is still alive)
            if (this.process.pid) {
                try {
                    process.kill(-this.process.pid);
                } catch (killError: any) {
                    if (killError.code === 'ESRCH') {
                        // Process group doesn't exist, it may have already terminated
                        this.outputChannel.appendLine('Results service was already stopped');
                    } else {
                        throw killError; // Re-throw if it's a different error
                    }
                }
            } else {
                try {
                    this.process.kill('SIGTERM');
                } catch (killError: any) {
                    if (killError.code === 'ESRCH') {
                        // Process doesn't exist, it may have already terminated
                        this.outputChannel.appendLine('Results service was already stopped');
                    } else {
                        throw killError; // Re-throw if it's a different error
                    }
                }
            }

            this._isRunning = false;
            this.outputChannel.appendLine('Results service stopped');
            vscode.window.showInformationMessage('Results service stopped');
            return true;
        } catch (error) {
            // If the primary kill method fails, try alternative methods
            try {
                // Try finding and killing by port instead
                cp.execSync(`lsof -i :${this._port} -t | xargs kill -9 2>/dev/null || true`, {
                    stdio: 'ignore',
                    timeout: 2000
                });
                this._isRunning = false;
                this.outputChannel.appendLine('Results service stopped');
                vscode.window.showInformationMessage('Results service stopped');
                return true;
            } catch {
                const message = error instanceof Error ? error.message : 'Unknown error';
                if (error instanceof Error && (error as any).code === 'ESRCH') {
                    // Process already gone, but that's OK
                    this._isRunning = false;
                    this.outputChannel.appendLine('Results service was already stopped');
                    return true;
                } else {
                    vscode.window.showErrorMessage(`Failed to stop results service: ${message}`);
                    return false;
                }
            }
        }
    }

    dispose() {
        this.stop();
        this.outputChannel.dispose();
    }
}
