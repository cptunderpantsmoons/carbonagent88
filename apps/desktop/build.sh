#!/bin/bash
# Build script for Carbon Agent Desktop
# Runs tsc, copies static assets to dist/renderer/ and dist/assets/

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "→ Building TypeScript..."
pnpm exec tsc --project tsconfig.json

echo "→ Copying renderer assets..."
cp src/renderer/styles.css dist/renderer/
cp src/renderer/index.html dist/renderer/

echo "→ Copying static assets..."
mkdir -p dist/assets
if [ -d "assets" ]; then
  cp assets/* dist/assets/
fi

echo "→ Build complete ✅"
echo "   main:      dist/main.js"
echo "   renderer:  dist/renderer/"
echo "   assets:    dist/assets/"
