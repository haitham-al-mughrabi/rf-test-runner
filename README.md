# RF Test Runner - VS Code Extension

A VS Code extension for running Robot Framework tests with configurable options.

## Features

- **Results Service Control**: Start/stop the results web server directly from VS Code
- **Test Selection**: Browse and select tests, suites, or entire modules to run
- **Docker Execution**: Run tests in Docker with VNC support
- **Local Execution**: Run tests locally with Python/Robot Framework
- **Full Configuration**: All script options available via dropdown menus and input fields

## Installation

### From Source

1. Open the `rf-test-runner` folder in VS Code
2. Run `npm install` to install dependencies
3. Press `F5` to launch the extension in debug mode

### Package as VSIX

```bash
cd rf-test-runner
npm install -g @vscode/vsce
vsce package
```

Then install the `.vsix` file via VS Code: Extensions > ... > Install from VSIX

## Usage

1. Click the Robot icon in the Activity Bar (left sidebar)
2. The extension panel shows four sections:

### Results Service
- Set the port number
- Click "Start" to launch the results server
- Opens browser automatically to view test results

### Test Selection
- Browse available test files in the Tests folder
- Check individual tests, suites, or modules
- Or enter a custom path manually

### Run Configuration
- Switch between Docker and Local tabs
- Configure all test execution options:
  - Environment (UAT, Stage, Production, Dev)
  - Window dimensions
  - Headless mode
  - Video recording, HAR, Playwright tracing
  - And many more options

### Run Tests
- Click "Run (Docker)" or "Run (Local)" to execute
- Watch output in the RF Test Runner output channel
- Stop running tests with the "Stop Tests" button

## Configuration Options

### Common Options
| Option | Description | Default |
|--------|-------------|---------|
| Environment | Test environment | UAT (Docker) / Stage (Local) |
| Headless | Run without browser UI | False |
| Record Video | Capture video of test execution | False |
| Enable HAR | Capture HTTP Archive | False |
| Playwright Tracing | Enable Playwright traces | False |
| Log Level | Robot Framework log level | TRACE |

### Docker-Only Options
| Option | Description | Default |
|--------|-------------|---------|
| Maximize Browser | Maximize browser window | False |
| Keep VNC Open | Keep VNC session after tests | False |
| Auto Close Browser | Auto-close browser after tests | True |
| Docker Image | Docker image to use | robot-framework-custom:latest |

### Local-Only Options
| Option | Description | Default |
|--------|-------------|---------|
| Install Dependencies | Install/update Python deps | False |
| Check Dependencies | Verify deps are installed | False |

## Commands

Available from Command Palette (Cmd/Ctrl+Shift+P):

- `RF: Start Results Service`
- `RF: Stop Results Service`
- `RF: Run Tests (Docker)`
- `RF: Run Tests (Local)`
- `RF: Refresh Test List`

## Requirements

- VS Code 1.85.0 or higher
- For Docker execution: Docker installed and running
- For Local execution: Python 3.10+ with Robot Framework
