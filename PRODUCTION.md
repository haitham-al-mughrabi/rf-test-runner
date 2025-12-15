 # Robot Framework Test Runner - Production Deployment

Repository: https://github.com/rf-automation/rf-test-runner

## Overview
This extension allows running Robot Framework tests with configurable options and managing results service. This document provides information about the production deployment.

## Production Build

### Docker Build
Build the extension using Docker:
```bash
docker build -t rf-test-runner-extension .
```

Run the container to extract the VSIX package:
```bash
docker run --rm -v ./output:/output rf-test-runner-extension
```

The built VSIX package will be available in the mounted volume.

## Production Configuration

### Extension Settings
The extension supports the following configuration options that can be set in VS Code:
- \`rfTestRunner.config\`: Robot Framework test execution configuration

### Supported Environments
- VS Code version 1.85.0 or higher
- Node.js runtime in VS Code
- Python 3.10+ for Robot Framework execution
- Docker for containerized test execution (optional)

## Deployment Process

1. Build the extension using the Dockerfile
2. Install the VSIX file in VS Code:
   - Open VS Code Command Palette (Ctrl+Shift+P)
   - Execute "Extensions: Install from VSIX..."
   - Select the built VSIX file
   
## Production Notes

- The extension uses workspace-scoped configurations to persist settings
- Results service automatically handles port conflicts by killing processes on the selected port
- Test execution state is properly managed to prevent UI lockups
- All configuration changes are persisted and available on VS Code restart

## Troubleshooting

### Port Conflicts
The extension automatically detects and terminates processes using the configured port before starting the results service.

### Process Termination
- Results service processes are properly terminated when stopped
- Test execution processes are cleaned up after completion
- Error handling prevents hanging processes

## Security Considerations

- Extension requires file system access to run tests
- Docker integration requires Docker daemon access
- Results service opens HTTP server on configured port

