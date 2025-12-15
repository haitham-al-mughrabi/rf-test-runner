# Multi-stage build for the Robot Framework Test Runner VS Code extension
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src/ ./src/
COPY tsconfig.json ./

# Build the extension
RUN npm run compile

# Production stage
FROM node:18-alpine

WORKDIR /app

# Install VSCE (Visual Studio Code Extension) globally
RUN npm install -g vsce

# Copy built extension files
COPY --from=builder /app/out ./out
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY README.md ./
COPY tsconfig.json ./
COPY resources/ ./resources/

# Create a complete extension directory structure
RUN mkdir -p /output

# Build the VSIX package
RUN vsce package -o /output/

# Make output available
VOLUME ["/output"]

# Default command
CMD ["sh", "-c", "echo \"Robot Framework Test Runner extension built. VSIX file is available in /output/\"; ls -la /output/"]
