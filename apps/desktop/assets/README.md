# Carbon Agent Assets

This directory contains application assets for the Electron desktop app.

- `icon.svg`   — Master vector icon (source)
- `icon.png`   — 512×512 PNG icon for macOS (.app) and Linux (AppImage)
- `icon.ico`   — Multi-size Windows icon (embedded 16/32/48/64/128/256)
- `icon.icns`  — macOS ICNS bundle icon

The icons are generated from the SVG source using Chromium's headless mode (for PNGs) and Pillow (for ICO/ICNS multi-size bundles).

## Regenerating Icons

```bash
# Generate PNGs from SVG using headless Chromium
chromium --headless --disable-gpu --screenshot=icon.png --window-size=512,512 icon.svg

# Generate ICO/ICNS using Python Pillow
python3 -c "from PIL import Image; img = Image.open('icon.png'); img.save('icon.ico'); img.save('icon.icns')"
```
