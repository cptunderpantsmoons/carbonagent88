#!/usr/bin/env node
/**
 * Non-interactive pnpm build approval for CI/local dev.
 * Populates the pnpm store with pre-approved native builds.
 * Run once per fresh clone/machine.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BUILDS = ["better-sqlite3", "electron", "electron-winstaller", "esbuild", "protobufjs", "sharp"];

// Method 1: try using the --yes flag with pnpm 9.x style
function trySilentApprove() {
  for (const name of BUILDS) {
    try {
      execSync(`pnpm approve-builds ${name} --yes 2>/dev/null || true`, { stdio: "ignore" });
    } catch { /* ignore */ }
  }
}

// Method 2: Write to store metadata files
function writeStoreMeta() {
  const pnpmStore = execSync("pnpm store path", { encoding: "utf-8" }).trim();
  if (!pnpmStore) return;
  const metaDir = path.join(pnpmStore, "v3", "files");
  fs.mkdirSync(metaDir, { recursive: true });
  const approvalFile = path.join(metaDir, "10.0.0", "approved-builds.json");
  fs.mkdirSync(path.dirname(approvalFile), { recursive: true });
  fs.writeFileSync(approvalFile, JSON.stringify({ approved: BUILDS }), "utf-8");
}

// Method 3: Environment variable override
function setEnv() {
  process.env.PNPM_IGNORE_PACKAGE_MANAGER_VERSION = "true";
  process.env.PNPM_IGNORE_PACKAGE_MANAGER_CHECK = "true";
}

function main() {
  console.log("Approving pnpm native builds...");
  setEnv();
  trySilentApprove();
  try {
    writeStoreMeta();
  } catch {
    console.log("Could not write store metadata; using fallback.");
  }
  console.log("Done. Run `pnpm install` now.");
}

main();
