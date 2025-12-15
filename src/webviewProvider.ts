import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ResultsServiceManager } from './resultsService';
import { TestRunner, TestConfig, TestSelection, defaultConfig } from './testRunner';

interface TestItem {
    name: string;
    path: string;
    type: 'test' | 'suite' | 'module';
    testName?: string;  // For individual test cases
    children?: TestItem[];
}

export class RFTestRunnerViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'rfTestRunner.configView';
    private _view?: vscode.WebviewView;
    private config: TestConfig = { ...defaultConfig };
    private testItems: TestItem[] = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly workspaceRoot: string,
        private readonly resultsService: ResultsServiceManager,
        private readonly testRunner: TestRunner
    ) {
        this.scanForTests();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'startResultsService':
                    await this.resultsService.start(data.port);
                    this.updateServiceStatus();
                    break;
                case 'stopResultsService':
                    this.resultsService.stop();
                    this.updateServiceStatus();
                    break;
                case 'runTests':
                    this.config = { ...this.config, ...data.config };
                    await this.testRunner.run(data.mode, this.config);
                    this.updateRunnerStatus();
                    break;
                case 'stopTests':
                    this.testRunner.stop();
                    this.updateRunnerStatus();
                    break;
                case 'updateConfig':
                    this.config = { ...this.config, ...data.config };
                    break;
                case 'refreshTests':
                    this.scanForTests();
                    this.sendTestList();
                    break;
                case 'getInitialState':
                    this.sendInitialState();
                    break;
            }
        });
    }

    private sendInitialState() {
        this._view?.webview.postMessage({
            type: 'initialState',
            config: this.config,
            tests: this.testItems,
            resultsServiceRunning: this.resultsService.isRunning,
            resultsServicePort: this.resultsService.port,
            testRunning: this.testRunner.isRunning
        });
    }

    private updateServiceStatus() {
        this._view?.webview.postMessage({
            type: 'serviceStatus',
            running: this.resultsService.isRunning,
            port: this.resultsService.port
        });
    }

    private updateRunnerStatus() {
        this._view?.webview.postMessage({
            type: 'runnerStatus',
            running: this.testRunner.isRunning
        });
    }

    private sendTestList() {
        this._view?.webview.postMessage({
            type: 'testList',
            tests: this.testItems
        });
    }

    public startResultsService() {
        this.resultsService.start();
        this.updateServiceStatus();
    }

    public stopResultsService() {
        this.resultsService.stop();
        this.updateServiceStatus();
    }

    public runTests(mode: 'docker' | 'local') {
        this.testRunner.run(mode, this.config);
        this.updateRunnerStatus();
    }

    public refreshTestList() {
        this.scanForTests();
        this.sendTestList();
    }

    private scanForTests() {
        this.testItems = [];
        const testsDir = path.join(this.workspaceRoot, 'Tests');

        if (!fs.existsSync(testsDir)) {
            return;
        }

        this.testItems = this.scanDirectory(testsDir, 'Tests');
    }

    private scanDirectory(dirPath: string, relativePath: string): TestItem[] {
        const items: TestItem[] = [];

        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                const itemRelativePath = path.join(relativePath, entry.name);

                if (entry.isDirectory()) {
                    const children = this.scanDirectory(fullPath, itemRelativePath);
                    if (children.length > 0) {
                        items.push({
                            name: entry.name,
                            path: itemRelativePath,
                            type: 'module',
                            children
                        });
                    }
                } else if (entry.name.endsWith('.robot') && !entry.name.startsWith('__init__')) {
                    // Skip __init__.robot files (suite setup files)
                    // Parse robot file to extract test cases
                    const testCases = this.parseRobotFile(fullPath);
                    const suiteItem: TestItem = {
                        name: entry.name.replace('.robot', ''),
                        path: itemRelativePath,
                        type: 'suite',
                        children: testCases.length > 0 ? testCases.map(tc => ({
                            name: tc,
                            path: itemRelativePath,
                            type: 'test' as const,
                            testName: tc
                        })) : undefined
                    };
                    items.push(suiteItem);
                }
            }
        } catch (error) {
            console.error('Error scanning directory:', error);
        }

        return items;
    }

    /**
     * Parse a robot file to extract test case names
     */
    private parseRobotFile(filePath: string): string[] {
        const testCases: string[] = [];

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');

            let inTestCasesSection = false;

            for (const line of lines) {
                const trimmedLine = line.trim();

                // Check for section headers
                if (trimmedLine.startsWith('***')) {
                    const sectionMatch = trimmedLine.match(/\*{3}\s*(.*?)\s*\*{3}/i);
                    if (sectionMatch) {
                        const sectionName = sectionMatch[1].toLowerCase();
                        inTestCasesSection = sectionName.includes('test case') || sectionName.includes('task');
                    }
                    continue;
                }

                // If we're in test cases section and line doesn't start with space/tab, it's a test name
                if (inTestCasesSection && trimmedLine && !line.startsWith(' ') && !line.startsWith('\t')) {
                    // Skip comments and empty lines
                    if (!trimmedLine.startsWith('#') && !trimmedLine.startsWith('[')) {
                        testCases.push(trimmedLine);
                    }
                }
            }
        } catch (error) {
            console.error('Error parsing robot file:', error);
        }

        return testCases;
    }

    private _getHtmlForWebview(_webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RF Test Runner</title>
    <style>
        :root {
            --vscode-font-family: var(--vscode-editor-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
        }
        * { box-sizing: border-box; }
        body {
            font-family: var(--vscode-font-family);
            font-size: 13px;
            padding: 0;
            margin: 0;
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
        }
        .container { padding: 10px; }
        .section {
            margin-bottom: 16px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            overflow: hidden;
        }
        .section-header {
            background: var(--vscode-sideBarSectionHeader-background);
            padding: 8px 12px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            user-select: none;
        }
        .section-header:hover { background: var(--vscode-list-hoverBackground); }
        .section-header .toggle { font-size: 10px; }
        .section-content { padding: 12px; display: block; }
        .section-content.collapsed { display: none; }
        .form-group { margin-bottom: 12px; }
        .form-group:last-child { margin-bottom: 0; }
        label {
            display: block;
            margin-bottom: 4px;
            font-weight: 500;
            color: var(--vscode-descriptionForeground);
        }
        input[type="text"], input[type="number"], select, textarea {
            width: 100%;
            padding: 6px 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 3px;
            font-size: 12px;
        }
        input:focus, select:focus, textarea:focus {
            outline: 1px solid var(--vscode-focusBorder);
            border-color: var(--vscode-focusBorder);
        }
        textarea {
            min-height: 60px;
            resize: vertical;
            font-family: var(--vscode-editor-font-family);
        }
        select { cursor: pointer; }
        .btn {
            padding: 8px 14px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: opacity 0.2s;
        }
        .btn:hover { opacity: 0.9; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-danger { background: #d32f2f; color: white; }
        .btn-success { background: #388e3c; color: white; }
        .btn-group { display: flex; gap: 8px; margin-top: 10px; }
        .btn-group .btn { flex: 1; }
        .status-indicator {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 8px;
            border-radius: 3px;
            font-size: 11px;
            margin-bottom: 10px;
        }
        .status-indicator.running { background: rgba(56, 142, 60, 0.2); color: #81c784; }
        .status-indicator.stopped { background: rgba(211, 47, 47, 0.2); color: #e57373; }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; }
        .status-dot.running { background: #81c784; animation: pulse 1.5s infinite; }
        .status-dot.stopped { background: #e57373; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .test-tree {
            max-height: 300px;
            overflow-y: auto;
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            padding: 8px;
            background: var(--vscode-input-background);
        }
        .test-item {
            padding: 3px 0;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .test-item input[type="checkbox"] { margin: 0; cursor: pointer; }
        .test-item label {
            margin: 0;
            cursor: pointer;
            display: inline;
            font-weight: normal;
            color: var(--vscode-foreground);
            flex: 1;
        }
        .test-item.module > label { font-weight: 600; color: var(--vscode-textLink-foreground); }
        .test-item.suite > label { color: var(--vscode-symbolIcon-fileForeground); font-weight: 500; }
        .test-item.test > label { color: var(--vscode-foreground); font-size: 12px; }
        .test-children {
            margin-left: 18px;
            border-left: 1px solid var(--vscode-panel-border);
            padding-left: 8px;
        }
        .test-children.collapsed { display: none; }
        .expander {
            cursor: pointer;
            font-size: 10px;
            width: 14px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            user-select: none;
        }
        .expander:hover { color: var(--vscode-foreground); }
        .expander-spacer { width: 14px; }
        .inline-group { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .tabs { display: flex; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 12px; }
        .tab {
            padding: 8px 16px;
            cursor: pointer;
            border: none;
            background: transparent;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            font-weight: 500;
            border-bottom: 2px solid transparent;
        }
        .tab:hover { color: var(--vscode-foreground); }
        .tab.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); }
        .divider { height: 1px; background: var(--vscode-panel-border); margin: 16px 0; }
        .info-text { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px; }
        .selection-summary {
            background: var(--vscode-editor-background);
            padding: 8px;
            border-radius: 3px;
            margin-top: 8px;
            font-size: 11px;
        }
        .selection-summary strong { color: var(--vscode-textLink-foreground); }
    </style>
</head>
<body>
    <div class="container">
        <!-- Results Service Section -->
        <div class="section">
            <div class="section-header" onclick="toggleSection(this)">
                <span>Results Service</span>
                <span class="toggle">▼</span>
            </div>
            <div class="section-content">
                <div class="status-indicator" id="serviceStatus">
                    <span class="status-dot stopped"></span>
                    <span>Stopped</span>
                </div>
                <div class="form-group">
                    <label for="servicePort">Port</label>
                    <input type="number" id="servicePort" value="8080" min="1024" max="65535">
                </div>
                <div class="btn-group">
                    <button class="btn btn-success" id="startServiceBtn" onclick="startService()">Start</button>
                    <button class="btn btn-danger" id="stopServiceBtn" onclick="stopService()" disabled>Stop</button>
                </div>
            </div>
        </div>

        <!-- Test Selection Section -->
        <div class="section">
            <div class="section-header" onclick="toggleSection(this)">
                <span>Test Selection</span>
                <span class="toggle">▼</span>
            </div>
            <div class="section-content">
                <div class="form-group">
                    <label>Select Tests, Suites, or Modules</label>
                    <div class="test-tree" id="testTree">
                        <div style="color: var(--vscode-descriptionForeground); font-style: italic;">
                            No tests found. Place .robot files in the Tests folder.
                        </div>
                    </div>
                    <button class="btn btn-secondary" onclick="refreshTests()" style="margin-top: 8px; width: 100%;">
                        Refresh Test List
                    </button>
                </div>
                <div id="selectionSummary" class="selection-summary" style="display: none;">
                    <strong>Selected:</strong> <span id="selectionText">None</span>
                </div>
                <div class="form-group" style="margin-top: 12px;">
                    <label for="customTestPath">Or Enter Custom Path</label>
                    <input type="text" id="customTestPath" placeholder="Tests/MyModule/MyTest.robot">
                    <div class="info-text">Overrides checkbox selection above</div>
                </div>
                <div class="form-group">
                    <label for="testCaseFilter">Run Specific Test Cases (--test)</label>
                    <input type="text" id="testCaseFilter" placeholder="Test Case Name (comma separated for multiple)">
                    <div class="info-text">Filter by test case name. Supports wildcards like "Login*"</div>
                </div>
            </div>
        </div>

        <!-- Run Configuration Section -->
        <div class="section">
            <div class="section-header" onclick="toggleSection(this)">
                <span>Run Configuration</span>
                <span class="toggle">▼</span>
            </div>
            <div class="section-content">
                <div class="tabs">
                    <button class="tab active" onclick="switchTab('docker')">Docker</button>
                    <button class="tab" onclick="switchTab('local')">Local</button>
                </div>

                <div class="form-group">
                    <label for="environment">Environment</label>
                    <select id="environment">
                        <option value="uat">UAT</option>
                        <option value="stage">Stage</option>
                        <option value="prod">Production</option>
                        <option value="dev">Development</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="executionEnv">Execution Environment</label>
                    <select id="executionEnv">
                        <option value="local">Local</option>
                        <option value="ci">CI</option>
                        <option value="cloud">Cloud</option>
                    </select>
                </div>

                <div class="inline-group">
                    <div class="form-group">
                        <label for="windowWidth">Window Width</label>
                        <input type="number" id="windowWidth" value="1920">
                    </div>
                    <div class="form-group">
                        <label for="windowHeight">Window Height</label>
                        <input type="number" id="windowHeight" value="1080">
                    </div>
                </div>

                <div class="form-group">
                    <label for="contextType">Context Type</label>
                    <select id="contextType">
                        <option value="NORMAL">Normal</option>
                        <option value="INCOGNITO">Incognito</option>
                        <option value="PERSISTENT">Persistent</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="logLevel">Log Level</label>
                    <select id="logLevel">
                        <option value="TRACE">TRACE</option>
                        <option value="DEBUG">DEBUG</option>
                        <option value="INFO">INFO</option>
                        <option value="WARN">WARN</option>
                        <option value="ERROR">ERROR</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="reportTitle">Report Title</label>
                    <input type="text" id="reportTitle" value="Unified Automation Regression Testing Report">
                </div>

                <div class="divider"></div>

                <div class="inline-group">
                    <div class="form-group">
                        <label for="headless">Headless</label>
                        <select id="headless">
                            <option value="false">False</option>
                            <option value="true">True</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="captchaSolver">Captcha Solver</label>
                        <select id="captchaSolver">
                            <option value="true">True</option>
                            <option value="false">False</option>
                        </select>
                    </div>
                </div>

                <div class="inline-group">
                    <div class="form-group">
                        <label for="windowFull">Window Full</label>
                        <select id="windowFull">
                            <option value="false">False</option>
                            <option value="true">True</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="windowMaximized">Window Maximized</label>
                        <select id="windowMaximized">
                            <option value="false">False</option>
                            <option value="true">True</option>
                        </select>
                    </div>
                </div>

                <div class="inline-group">
                    <div class="form-group">
                        <label for="recordVideo">Record Video</label>
                        <select id="recordVideo">
                            <option value="false">False</option>
                            <option value="true">True</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="enableHar">Enable HAR</label>
                        <select id="enableHar">
                            <option value="false">False</option>
                            <option value="true">True</option>
                        </select>
                    </div>
                </div>

                <div class="inline-group">
                    <div class="form-group">
                        <label for="playwrightTracing">Playwright Tracing</label>
                        <select id="playwrightTracing">
                            <option value="false">False</option>
                            <option value="true">True</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="devTools">Dev Tools</label>
                        <select id="devTools">
                            <option value="false">False</option>
                            <option value="true">True</option>
                        </select>
                    </div>
                </div>

                <div class="inline-group">
                    <div class="form-group">
                        <label for="runOffline">Run Offline</label>
                        <select id="runOffline">
                            <option value="false">False</option>
                            <option value="true">True</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="omitContent">Omit Content</label>
                        <select id="omitContent">
                            <option value="false">False</option>
                            <option value="true">True</option>
                        </select>
                    </div>
                </div>

                <div class="form-group">
                    <label for="chromeSecuritySandbox">Chrome Security Sandbox</label>
                    <select id="chromeSecuritySandbox">
                        <option value="false">False</option>
                        <option value="true">True</option>
                    </select>
                </div>

                <!-- Docker-only Options -->
                <div id="dockerOptions">
                    <div class="divider"></div>
                    <label style="font-weight: 600; margin-bottom: 10px; display: block; color: var(--vscode-textLink-foreground);">Docker Options</label>

                    <div class="inline-group">
                        <div class="form-group">
                            <label for="maximizeBrowser">Maximize Browser</label>
                            <select id="maximizeBrowser">
                                <option value="false">False</option>
                                <option value="true">True</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="autoCloseBrowser">Auto Close Browser</label>
                            <select id="autoCloseBrowser">
                                <option value="true">True</option>
                                <option value="false">False</option>
                            </select>
                        </div>
                    </div>

                    <div class="inline-group">
                        <div class="form-group">
                            <label for="keepVncOpen">Keep VNC Open</label>
                            <select id="keepVncOpen">
                                <option value="false">False</option>
                                <option value="true">True</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="fullWidthViewport">Full Width Viewport</label>
                            <select id="fullWidthViewport">
                                <option value="false">False</option>
                                <option value="true">True</option>
                            </select>
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="imageName">Docker Image</label>
                        <input type="text" id="imageName" value="robot-framework-custom:latest">
                    </div>
                </div>

                <!-- Local-only Options -->
                <div id="localOptions" style="display: none;">
                    <div class="divider"></div>
                    <label style="font-weight: 600; margin-bottom: 10px; display: block; color: var(--vscode-textLink-foreground);">Local Options</label>

                    <div class="inline-group">
                        <div class="form-group">
                            <label for="installDependencies">Install Dependencies</label>
                            <select id="installDependencies">
                                <option value="false">False</option>
                                <option value="true">True</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="checkDeps">Check Dependencies</label>
                            <select id="checkDeps">
                                <option value="false">False</option>
                                <option value="true">True</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div class="divider"></div>

                <div class="form-group">
                    <label for="customVariables">Custom Variables (one per line: VAR:VALUE)</label>
                    <textarea id="customVariables" placeholder="BROWSER:chromium&#10;TIMEOUT:30s"></textarea>
                </div>
            </div>
        </div>

        <!-- Run Tests Section -->
        <div class="section">
            <div class="section-header" onclick="toggleSection(this)">
                <span>Run Tests</span>
                <span class="toggle">▼</span>
            </div>
            <div class="section-content">
                <div class="status-indicator" id="runnerStatus">
                    <span class="status-dot stopped"></span>
                    <span>Ready</span>
                </div>
                <div class="btn-group">
                    <button class="btn btn-primary" id="runDockerBtn" onclick="runTests('docker')">Run (Docker)</button>
                    <button class="btn btn-primary" id="runLocalBtn" onclick="runTests('local')">Run (Local)</button>
                </div>
                <button class="btn btn-danger" id="stopTestsBtn" onclick="stopTests()" style="width: 100%; margin-top: 8px;" disabled>
                    Stop Tests
                </button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentTab = 'docker';
        let selectedItems = [];  // Array of {type, name, path, testName?}

        window.addEventListener('load', () => {
            vscode.postMessage({ type: 'getInitialState' });
        });

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'initialState':
                    applyConfig(message.config);
                    renderTestTree(message.tests);
                    updateServiceUI(message.resultsServiceRunning, message.resultsServicePort);
                    updateRunnerUI(message.testRunning);
                    break;
                case 'serviceStatus':
                    updateServiceUI(message.running, message.port);
                    break;
                case 'runnerStatus':
                    updateRunnerUI(message.running);
                    break;
                case 'testList':
                    renderTestTree(message.tests);
                    break;
            }
        });

        function toggleSection(header) {
            const content = header.nextElementSibling;
            const toggle = header.querySelector('.toggle');
            content.classList.toggle('collapsed');
            toggle.textContent = content.classList.contains('collapsed') ? '▶' : '▼';
        }

        function switchTab(tab) {
            currentTab = tab;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelector('.tab:' + (tab === 'docker' ? 'first-child' : 'last-child')).classList.add('active');
            document.getElementById('dockerOptions').style.display = tab === 'docker' ? 'block' : 'none';
            document.getElementById('localOptions').style.display = tab === 'local' ? 'block' : 'none';
            if (tab === 'docker') {
                document.getElementById('environment').value = 'uat';
            } else {
                document.getElementById('environment').value = 'stage';
            }
        }

        function startService() {
            const port = parseInt(document.getElementById('servicePort').value) || 8080;
            vscode.postMessage({ type: 'startResultsService', port });
        }

        function stopService() {
            vscode.postMessage({ type: 'stopResultsService' });
        }

        function updateServiceUI(running, port) {
            const status = document.getElementById('serviceStatus');
            const startBtn = document.getElementById('startServiceBtn');
            const stopBtn = document.getElementById('stopServiceBtn');
            if (running) {
                status.className = 'status-indicator running';
                status.innerHTML = '<span class="status-dot running"></span><span>Running on port ' + port + '</span>';
                startBtn.disabled = true;
                stopBtn.disabled = false;
            } else {
                status.className = 'status-indicator stopped';
                status.innerHTML = '<span class="status-dot stopped"></span><span>Stopped</span>';
                startBtn.disabled = false;
                stopBtn.disabled = true;
            }
        }

        function updateRunnerUI(running) {
            const status = document.getElementById('runnerStatus');
            const runDockerBtn = document.getElementById('runDockerBtn');
            const runLocalBtn = document.getElementById('runLocalBtn');
            const stopBtn = document.getElementById('stopTestsBtn');
            if (running) {
                status.className = 'status-indicator running';
                status.innerHTML = '<span class="status-dot running"></span><span>Tests Running...</span>';
                runDockerBtn.disabled = true;
                runLocalBtn.disabled = true;
                stopBtn.disabled = false;
            } else {
                status.className = 'status-indicator stopped';
                status.innerHTML = '<span class="status-dot stopped"></span><span>Ready</span>';
                runDockerBtn.disabled = false;
                runLocalBtn.disabled = false;
                stopBtn.disabled = true;
            }
        }

        function updateSelectionSummary() {
            const summary = document.getElementById('selectionSummary');
            const text = document.getElementById('selectionText');
            if (selectedItems.length === 0) {
                summary.style.display = 'none';
            } else {
                summary.style.display = 'block';
                const modules = selectedItems.filter(i => i.type === 'module').length;
                const suites = selectedItems.filter(i => i.type === 'suite').length;
                const tests = selectedItems.filter(i => i.type === 'test').length;
                const parts = [];
                if (modules > 0) parts.push(modules + ' module(s)');
                if (suites > 0) parts.push(suites + ' suite(s)');
                if (tests > 0) parts.push(tests + ' test(s)');
                text.textContent = parts.join(', ');
            }
        }

        function getConfig() {
            const customPath = document.getElementById('customTestPath').value.trim();
            const testCaseFilter = document.getElementById('testCaseFilter').value.trim();

            // Parse test case names from filter input
            const testCaseNames = testCaseFilter
                ? testCaseFilter.split(',').map(t => t.trim()).filter(t => t)
                : selectedItems.filter(i => i.type === 'test').map(i => i.testName);

            return {
                selections: selectedItems,
                customTestPath: customPath,
                testCaseNames: testCaseNames,
                captchaSolver: document.getElementById('captchaSolver').value === 'true',
                windowFull: document.getElementById('windowFull').value === 'true',
                windowMaximized: document.getElementById('windowMaximized').value === 'true',
                headless: document.getElementById('headless').value === 'true',
                runOffline: document.getElementById('runOffline').value === 'true',
                devTools: document.getElementById('devTools').value === 'true',
                chromeSecuritySandbox: document.getElementById('chromeSecuritySandbox').value === 'true',
                playwrightTracing: document.getElementById('playwrightTracing').value === 'true',
                developmentEnvironment: document.getElementById('environment').value,
                executionEnv: document.getElementById('executionEnv').value,
                omitContent: document.getElementById('omitContent').value === 'true',
                recordVideo: document.getElementById('recordVideo').value === 'true',
                enableHar: document.getElementById('enableHar').value === 'true',
                windowHeight: parseInt(document.getElementById('windowHeight').value) || 1080,
                windowWidth: parseInt(document.getElementById('windowWidth').value) || 1920,
                contextType: document.getElementById('contextType').value,
                logLevel: document.getElementById('logLevel').value,
                reportTitle: document.getElementById('reportTitle').value,
                customVariables: document.getElementById('customVariables').value,
                maximizeBrowser: document.getElementById('maximizeBrowser').value === 'true',
                autoCloseBrowser: document.getElementById('autoCloseBrowser').value === 'true',
                keepVncOpen: document.getElementById('keepVncOpen').value === 'true',
                fullWidthViewport: document.getElementById('fullWidthViewport').value === 'true',
                imageName: document.getElementById('imageName').value,
                installDependencies: document.getElementById('installDependencies').value === 'true',
                checkDeps: document.getElementById('checkDeps').value === 'true'
            };
        }

        function applyConfig(config) {
            if (!config) return;
            document.getElementById('environment').value = config.developmentEnvironment || 'uat';
            document.getElementById('executionEnv').value = config.executionEnv || 'local';
            document.getElementById('windowWidth').value = config.windowWidth || 1920;
            document.getElementById('windowHeight').value = config.windowHeight || 1080;
            document.getElementById('contextType').value = config.contextType || 'NORMAL';
            document.getElementById('logLevel').value = config.logLevel || 'TRACE';
            document.getElementById('reportTitle').value = config.reportTitle || '';
            document.getElementById('headless').value = config.headless ? 'true' : 'false';
            document.getElementById('captchaSolver').value = config.captchaSolver ? 'true' : 'false';
            document.getElementById('windowFull').value = config.windowFull ? 'true' : 'false';
            document.getElementById('windowMaximized').value = config.windowMaximized ? 'true' : 'false';
            document.getElementById('recordVideo').value = config.recordVideo ? 'true' : 'false';
            document.getElementById('enableHar').value = config.enableHar ? 'true' : 'false';
            document.getElementById('playwrightTracing').value = config.playwrightTracing ? 'true' : 'false';
            document.getElementById('devTools').value = config.devTools ? 'true' : 'false';
            document.getElementById('runOffline').value = config.runOffline ? 'true' : 'false';
            document.getElementById('omitContent').value = config.omitContent ? 'true' : 'false';
            document.getElementById('chromeSecuritySandbox').value = config.chromeSecuritySandbox ? 'true' : 'false';
            document.getElementById('maximizeBrowser').value = config.maximizeBrowser ? 'true' : 'false';
            document.getElementById('autoCloseBrowser').value = config.autoCloseBrowser ? 'true' : 'false';
            document.getElementById('keepVncOpen').value = config.keepVncOpen ? 'true' : 'false';
            document.getElementById('fullWidthViewport').value = config.fullWidthViewport ? 'true' : 'false';
            document.getElementById('imageName').value = config.imageName || 'robot-framework-custom:latest';
            document.getElementById('installDependencies').value = config.installDependencies ? 'true' : 'false';
            document.getElementById('checkDeps').value = config.checkDeps ? 'true' : 'false';
            document.getElementById('customVariables').value = config.customVariables || '';
        }

        function runTests(mode) {
            const config = getConfig();
            vscode.postMessage({ type: 'runTests', mode, config });
        }

        function stopTests() {
            vscode.postMessage({ type: 'stopTests' });
        }

        function refreshTests() {
            vscode.postMessage({ type: 'refreshTests' });
        }

        function renderTestTree(tests) {
            const tree = document.getElementById('testTree');
            if (!tests || tests.length === 0) {
                tree.innerHTML = '<div style="color: var(--vscode-descriptionForeground); font-style: italic;">No tests found. Place .robot files in the Tests folder.</div>';
                return;
            }
            tree.innerHTML = renderTestItems(tests);
        }

        function escapeId(str) {
            return str.replace(/[^a-zA-Z0-9]/g, '_');
        }

        function renderTestItems(items) {
            let html = '';
            for (const item of items) {
                let icon = '📄';
                if (item.type === 'module') icon = '📁';
                else if (item.type === 'test') icon = '🧪';

                const itemId = escapeId(item.path + (item.testName || ''));
                const itemData = JSON.stringify({
                    type: item.type,
                    name: item.name,
                    path: item.path,
                    testName: item.testName || null
                }).replace(/"/g, '&quot;');

                const hasChildren = item.children && item.children.length > 0;
                const expanderId = 'exp_' + itemId;

                html += '<div class="test-item ' + item.type + '">';
                if (hasChildren) {
                    html += '<span class="expander" id="' + expanderId + '" onclick="toggleExpand(\\'' + expanderId + '\\')">▶</span>';
                } else {
                    html += '<span class="expander-spacer"></span>';
                }
                html += '<input type="checkbox" id="chk_' + itemId + '" onchange="toggleItem(this, ' + "'" + itemData + "'" + ')">';
                html += '<label for="chk_' + itemId + '">' + icon + ' ' + item.name + '</label>';
                html += '</div>';

                if (hasChildren) {
                    html += '<div class="test-children collapsed" id="children_' + expanderId + '">';
                    html += renderTestItems(item.children);
                    html += '</div>';
                }
            }
            return html;
        }

        function toggleExpand(expanderId) {
            const expander = document.getElementById(expanderId);
            const children = document.getElementById('children_' + expanderId);
            if (children.classList.contains('collapsed')) {
                children.classList.remove('collapsed');
                expander.textContent = '▼';
            } else {
                children.classList.add('collapsed');
                expander.textContent = '▶';
            }
        }

        function toggleItem(checkbox, dataStr) {
            const data = JSON.parse(dataStr.replace(/&quot;/g, '"'));
            if (checkbox.checked) {
                // Add to selection if not already there
                const exists = selectedItems.some(i =>
                    i.path === data.path && i.type === data.type && i.testName === data.testName
                );
                if (!exists) {
                    selectedItems.push(data);
                }
            } else {
                // Remove from selection
                selectedItems = selectedItems.filter(i =>
                    !(i.path === data.path && i.type === data.type && i.testName === data.testName)
                );
            }
            updateSelectionSummary();
        }
    </script>
</body>
</html>`;
    }
}
