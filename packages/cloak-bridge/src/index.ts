/**
 * Cloak Bridge — Browser Profile Management & Stealth Automation
 *
 * Control Corridor:
 * - Owns: Browser profiles, sessions, downloads, stealth tools
 * - Must NOT own: RAG indexing, LLM decisions
 *
 * Uses Playwright for headed browser automation with persistent profiles.
 */

import { chromium, type Browser, type BrowserContext } from "playwright";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function getDocumentsDir(): string {
  return path.join(os.homedir(), ".carbon-agent", "documents");
}

// ---------------------------------------------------------------------------
// Profile lock management (Invariant #6: Profile locking)
// ---------------------------------------------------------------------------

const lockedProfiles = new Map<string, BrowserContext>();
const activeBrowsers = new Map<string, Browser>();

export function isProfileLocked(profileId: string): boolean {
  return lockedProfiles.has(profileId);
}

export function getLockedContext(profileId: string): BrowserContext | undefined {
  return lockedProfiles.get(profileId);
}

export async function lockProfile(profileId: string, profileDir: string): Promise<BrowserContext> {
  if (lockedProfiles.has(profileId)) {
    throw new Error(`Profile ${profileId} is already locked by another run`);
  }

  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  const browser = await chromium.launch({
    headless: false,
    args: [
      `--user-data-dir=${profileDir}`,
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const context = browser.contexts()[0] ?? await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0",
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  lockedProfiles.set(profileId, context);
  activeBrowsers.set(profileId, browser);
  return context;
}

export async function unlockProfile(profileId: string): Promise<void> {
  const browser = activeBrowsers.get(profileId);
  if (browser) {
    await browser.close();
    activeBrowsers.delete(profileId);
  }
  lockedProfiles.delete(profileId);
}

// ---------------------------------------------------------------------------
// Launch Login Portal (Phase 3.2)
// ---------------------------------------------------------------------------

export interface LaunchLoginResult {
  success: boolean;
  error?: string;
}

export async function launchLoginPortal(profileId: string, profileDir: string, startUrl?: string): Promise<LaunchLoginResult> {
  try {
    if (isProfileLocked(profileId)) {
      return { success: false, error: "Profile is currently in use by an agent run" };
    }

    const browser = await chromium.launch({
      headless: false,
      args: [
        `--user-data-dir=${profileDir}`,
        "--no-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    });

    const context = browser.contexts()[0] ?? await browser.newContext({
      viewport: { width: 1440, height: 900 },
      acceptDownloads: true,
    });

    const docsDir = getDocumentsDir();
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }

    context.setDefaultTimeout(60000);

    const page = await context.newPage();

    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    await page.goto(startUrl ?? "about:blank");

    activeBrowsers.set(`login-${profileId}`, browser);

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message ?? String(err) };
  }
}

// ---------------------------------------------------------------------------
// Session Health Check (Phase 3.4)
// ---------------------------------------------------------------------------

export interface HealthCheckResult {
  status: "active" | "expired" | "unknown";
  domain: string;
  httpStatus?: number;
  error?: string;
}

export async function checkSessionHealth(_profileId: string, profileDir: string, targetDomain: string): Promise<HealthCheckResult> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        `--user-data-dir=${profileDir}`,
        "--no-sandbox",
      ],
    });

    const context = browser.contexts()[0] ?? await browser.newContext();
    const page = await context.newPage();

    const response = await page.goto(targetDomain, { waitUntil: "domcontentloaded", timeout: 15000 });
    const url = page.url();
    const status = response?.status() ?? 0;

    const isLoginPage = /login|signin|auth|authenticate/i.test(url) && url !== targetDomain;

    await browser.close();
    browser = null;

    if (status >= 200 && status < 400 && !isLoginPage) {
      return { status: "active", domain: targetDomain, httpStatus: status };
    }
    if (status === 401 || status === 403 || isLoginPage) {
      return { status: "expired", domain: targetDomain, httpStatus: status };
    }
    return { status: "unknown", domain: targetDomain, httpStatus: status };
  } catch (err: any) {
    if (browser) await browser.close();
    return { status: "unknown", domain: targetDomain, error: err.message ?? String(err) };
  }
}

// ---------------------------------------------------------------------------
// Stealth Tools (Phase 5.2)
// ---------------------------------------------------------------------------

export interface StealthOpenInput {
  profileId: string;
  profileDir: string;
  url: string;
}

export interface StealthOpenOutput {
  success: boolean;
  url: string;
  title: string;
  error?: string;
}

export async function stealthOpen(input: StealthOpenInput): Promise<StealthOpenOutput> {
  const context = getLockedContext(input.profileId);
  if (!context) {
    throw new Error(`Profile ${input.profileId} is not locked. Lock it before using stealth tools.`);
  }

  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(input.url, { waitUntil: "networkidle", timeout: 30000 });

  const title = await page.title();
  return { success: true, url: page.url(), title };
}

export interface StealthScrapeInput {
  profileId: string;
  url?: string;
}

export interface StealthScrapeOutput {
  success: boolean;
  url: string;
  title: string;
  text: string;
  error?: string;
}

export async function stealthScrape(input: StealthScrapeInput): Promise<StealthScrapeOutput> {
  const context = getLockedContext(input.profileId);
  if (!context) {
    throw new Error(`Profile ${input.profileId} is not locked. Lock it before using stealth tools.`);
  }

  const page = context.pages()[0];
  if (!page) {
    throw new Error("No active page in profile context");
  }

  if (input.url && page.url() !== input.url) {
    await page.goto(input.url, { waitUntil: "networkidle", timeout: 30000 });
  }

  const title = await page.title();
  const url = page.url();

  const text = await page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("script, style, nav, header, footer, aside").forEach((el: Element) => el.remove());
    return clone.innerText;
  });

  return { success: true, url, title, text: text.trim() };
}

export interface StealthDownloadInput {
  profileId: string;
  url: string;
  filename?: string;
}

export interface StealthDownloadOutput {
  success: boolean;
  filePath: string;
  fileName: string;
  sizeBytes: number;
  error?: string;
}

export async function stealthDownload(input: StealthDownloadInput): Promise<StealthDownloadOutput> {
  const context = getLockedContext(input.profileId);
  if (!context) {
    throw new Error(`Profile ${input.profileId} is not locked. Lock it before using stealth tools.`);
  }

  const docsDir = getDocumentsDir();
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  const page = context.pages()[0];
  if (!page) {
    throw new Error("No active page in profile context");
  }

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    page.evaluate((url: string) => {
      const a = document.createElement("a");
      a.href = url;
      a.download = "";
      a.click();
    }, input.url),
  ]);

  const suggested = download.suggestedFilename();
  const fileName = input.filename ?? suggested ?? `download-${Date.now()}`;
  const filePath = path.join(docsDir, fileName);

  await download.saveAs(filePath);
  const stats = fs.statSync(filePath);

  return { success: true, filePath, fileName, sizeBytes: stats.size };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export async function closeAllBrowsers(): Promise<void> {
  for (const [_id, browser] of activeBrowsers) {
    try { await browser.close(); } catch { /* ignore */ }
  }
  activeBrowsers.clear();
  lockedProfiles.clear();
}
