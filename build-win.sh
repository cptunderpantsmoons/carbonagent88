#!/bin/bash
# Windows Build Script for Carbon Agent
# Creates a Windows .exe installer with all dependencies bundled

set -e

echo "=========================================="
echo "  Carbon Agent - Windows Build Script"
echo "=========================================="

# Check if running on Windows (WSL) or Linux
if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]] || [[ -n "$WINDIR" ]]; then
    echo "→ Detected Windows environment"
    IS_WINDOWS=true
else
    echo "→ Detected Linux/macOS environment (cross-compilation)"
    IS_WINDOWS=false
fi

# Step 1: Install dependencies
echo ""
echo "→ Step 1: Installing dependencies..."
pnpm install

# Step 2: Build all packages
echo ""
echo "→ Step 2: Building all packages..."
pnpm build

# Step 3: Build desktop app TypeScript
echo ""
echo "→ Step 3: Building desktop app..."
cd apps/desktop
pnpm build

# Step 4: Copy static assets
echo ""
echo "→ Step 4: Copying static assets..."
bash build.sh

# Step 5: Create Windows installer
echo ""
echo "→ Step 5: Creating Windows installer..."
echo "   This may take several minutes..."

if [[ "$IS_WINDOWS" == true ]]; then
    # Native Windows build
    pnpm dist:win
else
    # Cross-compilation from Linux/macOS
    echo "   Cross-compiling for Windows x64..."
    pnpm dist:win
fi

# Step 6: Report results
echo ""
echo "=========================================="
echo "  Build Complete!"
echo "=========================================="
echo ""
echo "Output files:"
ls -la release/*.exe 2>/dev/null || echo "No .exe files found"
ls -la release/*.yaml 2>/dev/null || echo ""
echo ""
echo "Installer locations:"
echo "  - NSIS Installer: release/Carbon Agent Setup.exe"
echo "  - Portable: release/Carbon Agent.exe"
echo ""
echo "Installation notes:"
echo "  - No login required - fully offline installer"
echo "  - All dependencies bundled in the installer"
echo "  - Installs to user-selected directory"
echo "  - Creates desktop and start menu shortcuts"
echo "=========================================="
