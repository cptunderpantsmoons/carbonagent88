#!/bin/bash
# Build script for Carbon Agent Desktop
# Runs tsc, copies static assets to dist/renderer/

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "→ Building..."
tsc --project tsconfig.json

echo "→ Copying renderer assets..."
cp src/renderer/styles.css dist/renderer/
cp src/renderer/index.html dist/renderer/

echo "✓ Build complete"
