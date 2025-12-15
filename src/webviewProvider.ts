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
        :root { --vscode-font-family: var(--vscode-editor-font-family, -apple-system, BlinkMacSystemFont, sans-serif); }
        * { box-sizing: border-box; }
        body { font-family: var(--vscode-font-family); font-size: 13px; padding: 0; margin: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); }
        .container { padding: 10px; }
        .section { margin-bottom: 16px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; overflow: hidden; }
        .section-header { background: var(--vscode-sideBarSectionHeader-background); padding: 8px 12px; font-weight: 600; cursor: pointer; display: flex; justify-content: space-between; align-items: center; user-select: none; }
        .section-header:hover { background: var(--vscode-list-hoverBackground); }
        .section-header .toggle { font-size: 10px; }
        .section-content { padding: 12px; display: block; }
        .section-content.collapsed { display: none; }
        .form-group { margin-bottom: 12px; }
        .form-group:last-child { margin-bottom: 0; }
        label { display: block; margin-bottom: 4px; font-weight: 500; color: var(--vscode-descriptionForeground); }
        input[type="text"], input[type="number"], select, textarea { width: 100%; padding: 6px 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 3px; font-size: 12px; }
        input:focus, select:focus, textarea:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
        textarea { min-height: 60px; resize: vertical; font-family: var(--vscode-editor-font-family); }
        select { cursor: pointer; }
        .btn { padding: 8px 14px; border: none; border-radius: 3px; cursor: pointer; font-size: 12px; font-weight: 500; transition: opacity 0.2s; }
        .btn:hover { opacity: 0.9; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-danger { background: #d32f2f; color: white; }
        .btn-success { background: #388e3c; color: white; }
        .btn-group { display: flex; gap: 8px; margin-top: 10px; }
        .btn-group .btn { flex: 1; }
        .status-indicator { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 3px; font-size: 11px; margin-bottom: 10px; }
        .status-indicator.running { background: rgba(56, 142, 60, 0.2); color: #81c784; }
        .status-indicator.stopped { background: rgba(211, 47, 47, 0.2); color: #e57373; }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; }
        .status-dot.running { background: #81c784; animation: pulse 1.5s infinite; }
        .status-dot.stopped { background: #e57373; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .inline-group { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .tabs { display: flex; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 12px; }
        .tab { padding: 8px 12px; cursor: pointer; border: none; background: transparent; color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 500; border-bottom: 2px solid transparent; flex: 1; text-align: center; }
        .tab:hover { color: var(--vscode-foreground); }
        .tab.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .divider { height: 1px; background: var(--vscode-panel-border); margin: 16px 0; }
        .info-text { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px; }
        .test-list { max-height: 200px; overflow-y: auto; border: 1px solid var(--vscode-input-border); border-radius: 3px; padding: 8px; background: var(--vscode-input-background); }
        .test-item { padding: 4px 0; display: flex; align-items: center; gap: 6px; }
        .test-item input[type="radio"], .test-item input[type="checkbox"] { margin: 0; cursor: pointer; }
        .test-item label { margin: 0; cursor: pointer; display: inline; font-weight: normal; color: var(--vscode-foreground); flex: 1; font-size: 12px; }
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

        <!-- Test Selection Section with 3 Tabs -->
        <div class="section">
            <div class="section-header" onclick="toggleSection(this)">
                <span>Test Selection</span>
                <span class="toggle">▼</span>
            </div>
            <div class="section-content">
                <div class="tabs">
                    <button class="tab active" onclick="switchTestTab('single')">Single Test</button>
                    <button class="tab" onclick="switchTestTab('suite')">Suite(s)</button>
                    <button class="tab" onclick="switchTestTab('module')">Module</button>
                </div>

                <!-- Single Test Tab -->
                <div id="singleTestTab" class="tab-content active">
                    <div class="form-group">
                        <label for="singleTestSuite">Select Suite</label>
                        <select id="singleTestSuite" onchange="updateTestCaseList()">
                            <option value="">-- Select a suite --</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Select Test Case</label>
                        <div class="test-list" id="testCaseList">
                            <div style="color: var(--vscode-descriptionForeground); font-style: italic;">Select a suite first</div>
                        </div>
                    </div>
                </div>

                <!-- Suite(s) Tab -->
                <div id="suiteTab" class="tab-content">
                    <div class="form-group">
                        <label>Select Suite(s) to Run</label>
                        <div class="test-list" id="suiteList">
                            <div style="color: var(--vscode-descriptionForeground); font-style: italic;">No suites found</div>
                        </div>
                    </div>
                </div>

                <!-- Module Tab -->
                <div id="moduleTab" class="tab-content">
                    <div class="form-group">
                        <label>Select Module (Folder)</label>
                        <div class="test-list" id="moduleList">
                            <div style="color: var(--vscode-descriptionForeground); font-style: italic;">No modules found</div>
                        </div>
                    </div>
                </div>

                <button class="btn btn-secondary" onclick="refreshTests()" style="margin-top: 8px; width: 100%;">
                    Refresh Test List
                </button>

                <div class="form-group" style="margin-top: 12px;">
                    <label for="customTestPath">Or Enter Custom Path</label>
                    <input type="text" id="customTestPath" placeholder="Tests/MyModule/MySuite.robot">
                    <div class="info-text">Overrides selection above</div>
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
                    <button class="tab active" onclick="switchRunTab('docker')" id="dockerTabBtn">Docker</button>
                    <button class="tab" onclick="switchRunTab('local')" id="localTabBtn">Local</button>
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

                <div class="inline-group">
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
                </div>

                <div class="form-group">
                    <label for="reportTitle">Report Title</label>
                    <input type="text" id="reportTitle" value="Unified Automation Regression Testing Report">
                </div>

                <div class="divider"></div>

                <div class="inline-group">
                    <div class="form-group">
                        <label for="headless">Headless</label>
                        <select id="headless"><option value="false">False</option><option value="true">True</option></select>
                    </div>
                    <div class="form-group">
                        <label for="captchaSolver">Captcha Solver</label>
                        <select id="captchaSolver"><option value="true">True</option><option value="false">False</option></select>
                    </div>
                </div>

                <div class="inline-group">
                    <div class="form-group">
                        <label for="windowFull">Window Full</label>
                        <select id="windowFull"><option value="false">False</option><option value="true">True</option></select>
                    </div>
                    <div class="form-group">
                        <label for="windowMaximized">Window Maximized</label>
                        <select id="windowMaximized"><option value="false">False</option><option value="true">True</option></select>
                    </div>
                </div>

                <div class="inline-group">
                    <div class="form-group">
                        <label for="recordVideo">Record Video</label>
                        <select id="recordVideo"><option value="false">False</option><option value="true">True</option></select>
                    </div>
                    <div class="form-group">
                        <label for="enableHar">Enable HAR</label>
                        <select id="enableHar"><option value="false">False</option><option value="true">True</option></select>
                    </div>
                </div>

                <div class="inline-group">
                    <div class="form-group">
                        <label for="playwrightTracing">Playwright Tracing</label>
                        <select id="playwrightTracing"><option value="false">False</option><option value="true">True</option></select>
                    </div>
                    <div class="form-group">
                        <label for="devTools">Dev Tools</label>
                        <select id="devTools"><option value="false">False</option><option value="true">True</option></select>
                    </div>
                </div>

                <div class="inline-group">
                    <div class="form-group">
                        <label for="runOffline">Run Offline</label>
                        <select id="runOffline"><option value="false">False</option><option value="true">True</option></select>
                    </div>
                    <div class="form-group">
                        <label for="omitContent">Omit Content</label>
                        <select id="omitContent"><option value="false">False</option><option value="true">True</option></select>
                    </div>
                </div>

                <div class="form-group">
                    <label for="chromeSecuritySandbox">Chrome Security Sandbox</label>
                    <select id="chromeSecuritySandbox"><option value="false">False</option><option value="true">True</option></select>
                </div>

                <!-- Docker-only Options -->
                <div id="dockerOptions">
                    <div class="divider"></div>
                    <label style="font-weight: 600; margin-bottom: 10px; display: block; color: var(--vscode-textLink-foreground);">Docker Options</label>
                    <div class="inline-group">
                        <div class="form-group">
                            <label for="maximizeBrowser">Maximize Browser</label>
                            <select id="maximizeBrowser"><option value="false">False</option><option value="true">True</option></select>
                        </div>
                        <div class="form-group">
                            <label for="autoCloseBrowser">Auto Close Browser</label>
                            <select id="autoCloseBrowser"><option value="true">True</option><option value="false">False</option></select>
                        </div>
                    </div>
                    <div class="inline-group">
                        <div class="form-group">
                            <label for="keepVncOpen">Keep VNC Open</label>
                            <select id="keepVncOpen"><option value="false">False</option><option value="true">True</option></select>
                        </div>
                        <div class="form-group">
                            <label for="fullWidthViewport">Full Width Viewport</label>
                            <select id="fullWidthViewport"><option value="false">False</option><option value="true">True</option></select>
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
                            <select id="installDependencies"><option value="false">False</option><option value="true">True</option></select>
                        </div>
                        <div class="form-group">
                            <label for="checkDeps">Check Dependencies</label>
                            <select id="checkDeps"><option value="false">False</option><option value="true">True</option></select>
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
        let currentTestTab = 'single';
        let currentRunTab = 'docker';
        let allTests = [];
        let selectedTestCase = null;
        let selectedSuites = [];
        let selectedModule = null;

        window.addEventListener('load', () => {
            vscode.postMessage({ type: 'getInitialState' });
        });

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'initialState':
                    applyConfig(message.config);
                    allTests = message.tests || [];
                    populateTestSelections();
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
                    allTests = message.tests || [];
                    populateTestSelections();
                    break;
            }
        });

        function toggleSection(header) {
            const content = header.nextElementSibling;
            const toggle = header.querySelector('.toggle');
            content.classList.toggle('collapsed');
            toggle.textContent = content.classList.contains('collapsed') ? '▶' : '▼';
        }

        function switchTestTab(tab) {
            currentTestTab = tab;
            document.querySelectorAll('#singleTestTab, #suiteTab, #moduleTab').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.section:nth-child(2) .tab').forEach(t => t.classList.remove('active'));

            if (tab === 'single') {
                document.getElementById('singleTestTab').classList.add('active');
                document.querySelector('.section:nth-child(2) .tab:nth-child(1)').classList.add('active');
            } else if (tab === 'suite') {
                document.getElementById('suiteTab').classList.add('active');
                document.querySelector('.section:nth-child(2) .tab:nth-child(2)').classList.add('active');
            } else {
                document.getElementById('moduleTab').classList.add('active');
                document.querySelector('.section:nth-child(2) .tab:nth-child(3)').classList.add('active');
            }
        }

        function switchRunTab(tab) {
            currentRunTab = tab;
            document.getElementById('dockerTabBtn').classList.toggle('active', tab === 'docker');
            document.getElementById('localTabBtn').classList.toggle('active', tab === 'local');
            document.getElementById('dockerOptions').style.display = tab === 'docker' ? 'block' : 'none';
            document.getElementById('localOptions').style.display = tab === 'local' ? 'block' : 'none';
            document.getElementById('environment').value = tab === 'docker' ? 'uat' : 'stage';
        }

        function populateTestSelections() {
            populateSuiteDropdown();
            populateSuiteList();
            populateModuleList();
        }

        function getAllSuites(items, result = []) {
            for (const item of items) {
                if (item.type === 'suite') {
                    result.push(item);
                }
                if (item.children) {
                    getAllSuites(item.children, result);
                }
            }
            return result;
        }

        function getAllModules(items, result = []) {
            for (const item of items) {
                if (item.type === 'module') {
                    result.push(item);
                }
                if (item.children) {
                    getAllModules(item.children, result);
                }
            }
            return result;
        }

        function populateSuiteDropdown() {
            const select = document.getElementById('singleTestSuite');
            const suites = getAllSuites(allTests);
            select.innerHTML = '<option value="">-- Select a suite --</option>';
            suites.forEach((suite, idx) => {
                select.innerHTML += '<option value="' + idx + '">' + suite.path + '</option>';
            });
        }

        function updateTestCaseList() {
            const select = document.getElementById('singleTestSuite');
            const list = document.getElementById('testCaseList');
            const idx = select.value;

            if (idx === '') {
                list.innerHTML = '<div style="color: var(--vscode-descriptionForeground); font-style: italic;">Select a suite first</div>';
                selectedTestCase = null;
                return;
            }

            const suites = getAllSuites(allTests);
            const suite = suites[parseInt(idx)];

            if (!suite.children || suite.children.length === 0) {
                list.innerHTML = '<div style="color: var(--vscode-descriptionForeground); font-style: italic;">No test cases found in this suite</div>';
                return;
            }

            let html = '';
            suite.children.forEach((tc, i) => {
                const id = 'tc_' + idx + '_' + i;
                html += '<div class="test-item">';
                html += '<input type="radio" name="testCase" id="' + id + '" value="' + tc.testName + '" data-suite="' + suite.path + '" onchange="selectTestCase(this)">';
                html += '<label for="' + id + '">🧪 ' + tc.name + '</label>';
                html += '</div>';
            });
            list.innerHTML = html;
        }

        function selectTestCase(radio) {
            selectedTestCase = { name: radio.value, suitePath: radio.dataset.suite };
        }

        function populateSuiteList() {
            const list = document.getElementById('suiteList');
            const suites = getAllSuites(allTests);

            if (suites.length === 0) {
                list.innerHTML = '<div style="color: var(--vscode-descriptionForeground); font-style: italic;">No suites found</div>';
                return;
            }

            let html = '';
            suites.forEach((suite, idx) => {
                html += '<div class="test-item">';
                html += '<input type="checkbox" id="suite_' + idx + '" value="' + suite.path + '" onchange="toggleSuiteSelection(this)">';
                html += '<label for="suite_' + idx + '">📄 ' + suite.path + '</label>';
                html += '</div>';
            });
            list.innerHTML = html;
        }

        function toggleSuiteSelection(checkbox) {
            if (checkbox.checked) {
                if (!selectedSuites.includes(checkbox.value)) {
                    selectedSuites.push(checkbox.value);
                }
            } else {
                selectedSuites = selectedSuites.filter(s => s !== checkbox.value);
            }
        }

        function populateModuleList() {
            const list = document.getElementById('moduleList');
            const modules = getAllModules(allTests);

            // Add root Tests folder
            let html = '<div class="test-item">';
            html += '<input type="radio" name="module" id="module_root" value="Tests" onchange="selectModule(this)">';
            html += '<label for="module_root">📁 Tests (All)</label>';
            html += '</div>';

            modules.forEach((mod, idx) => {
                html += '<div class="test-item">';
                html += '<input type="radio" name="module" id="module_' + idx + '" value="' + mod.path + '" onchange="selectModule(this)">';
                html += '<label for="module_' + idx + '">📁 ' + mod.path + '</label>';
                html += '</div>';
            });
            list.innerHTML = html;
        }

        function selectModule(radio) {
            selectedModule = radio.value;
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

        function getTestSelection() {
            const customPath = document.getElementById('customTestPath').value.trim();
            if (customPath) {
                return { testPath: customPath, testNames: [] };
            }

            if (currentTestTab === 'single' && selectedTestCase) {
                return { testPath: selectedTestCase.suitePath, testNames: [selectedTestCase.name] };
            } else if (currentTestTab === 'suite' && selectedSuites.length > 0) {
                return { testPath: selectedSuites.join(' '), testNames: [] };
            } else if (currentTestTab === 'module' && selectedModule) {
                return { testPath: selectedModule, testNames: [] };
            }

            return { testPath: 'Tests', testNames: [] };
        }

        function getConfig() {
            const selection = getTestSelection();
            return {
                selections: [],
                customTestPath: selection.testPath,
                testCaseNames: selection.testNames,
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
    </script>
</body>
</html>`;
    }
}
