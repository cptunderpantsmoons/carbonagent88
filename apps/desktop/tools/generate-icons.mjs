#!/usr/bin/env node
/**
 * Icon Generator — converts apps/desktop/assets/icon.svg into
 * .png, .ico, and .icns formats for Electron packager.
 *
 * Requires: chromium (or google-chrome) in PATH for SVG→PNG rendering.
 * Requires: python3 + Pillow (PIL) for .ico/.icns multi-size bundles.
 *
 * Usage: node tools/generate-icons.mjs
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(__dirname, "../assets");
const SVG = path.join(ASSETS, "icon.svg");

function findChromium() {
  const candidates = [
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
    "/snap/bin/chromium",
    "/usr/bin/chromium",
  ];
  for (const c of candidates) {
    try {
      execSync(`which ${c}`, { stdio: "ignore" });
      return c;
    } catch { /* not found */ }
  }
  return null;
}

function generatePng(chrome) {
  const out = path.join(ASSETS, "icon.png");
  const tmpHtml = path.join(ASSETS, ".tmp-icon-render.html");
  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;width:512px;height:512px;overflow:hidden">
<img src="icon.svg" width="512" height="512">
</body></html>`;
  fs.writeFileSync(tmpHtml, html);
  const url = `file://${tmpHtml}`;
  execSync(
    `${chrome} --headless --disable-gpu --screenshot="${out}" --window-size=512,512 --hide-scrollbars --no-sandbox "${url}"`,
    { stdio: "inherit" }
  );
  fs.unlinkSync(tmpHtml);
  console.log(`✅ PNG: ${path.relative(process.cwd(), out)}`);
}

function generateIcoIcns() {
  const script = `
from PIL import Image
img = Image.open("${path.join(ASSETS, "icon.png")}")
# ICO: include standard sizes
ico_sizes = [(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)]
imgs = [img.resize(s, Image.LANCZOS).convert("RGBA") for s in ico_sizes]
imgs[0].save("${path.join(ASSETS, "icon.ico")}", format="ICO", sizes=ico_sizes)
img.save("${path.join(ASSETS, "icon.icns")}")
print("✅ ICO and ICNS generated")
`;
  execSync(`python3 -c '${script}'`, { stdio: "inherit" });
}

// ─── Main ────────────────────────────────────────────
if (!fs.existsSync(SVG)) {
  console.error(`❌ SVG not found: ${SVG}`);
  process.exit(1);
}

const chrome = findChromium();
if (!chrome) {
  console.error("❌ Chromium/Google Chrome not found in PATH. Cannot render SVG→PNG.");
  process.exit(1);
}

console.log(`Using Chromium: ${chrome}`);
generatePng(chrome);
generateIcoIcns();
console.log("🎉 All icons generated!");
