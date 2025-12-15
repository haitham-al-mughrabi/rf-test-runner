#!/bin/bash
# Production build script for Robot Framework Test Runner VS Code extension

set -e

echo "🤖 Building Robot Framework Test Runner for Production"

# Check if required tools are available
if ! command -v vsce &> /dev/null; then
    echo "❌ vsce (Visual Studio Code Extension Manager) not found. Installing..."
    npm install -g @vscode/vsce
fi

if ! command -v npm &> /dev/null; then
    echo "❌ npm not found. Please install Node.js first."
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm ci

# Compile TypeScript
echo "🔨 Compiling TypeScript code..."
npm run compile

# Build the VSIX package
echo "🏗️  Building VSIX package..."
vsce package

echo "✅ Extension built successfully!"
echo "✅ You can find the .vsix file in the current directory."
echo ""
echo "To install in VS Code:"
echo "1. Open VS Code"
echo "2. Open Command Palette (Ctrl+Shift+P)"
echo "3. Execute: Extensions: Install from VSIX..."
echo "4. Select the built .vsix file"

