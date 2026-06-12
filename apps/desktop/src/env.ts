/**
 * Runtime configuration loader for Carbon Agent.
 *
 * On first start, attempts to read .env from the app data directory
 * and seeds default provider credentials. After first run, all
 * credentials are stored in the encrypted SQLite database.
 */

import path from "node:path";
import fs from "node:fs";
import { app } from "electron";

/** Result of env validation. */
export interface EnvValidation {
  valid: boolean;
  missing: string[];
  invalid: Array<{ key: string; reason: string }>;
}

export interface CarbonConfig {
  dataDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
  logPretty: boolean;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  customOpenAiBaseUrl?: string;
  customOpenAiApiKey?: string;
  customOpenAiModel?: string;
  telemetryEnabled: boolean;
  cloakHeadless: boolean;
  cloakSlowMo: number;
}

function findEnvFile(): string | null {
  try {
    const appDir = app.getPath("userData");
    const envApp = path.join(appDir, ".env");
    if (fs.existsSync(envApp)) return envApp;
  } catch { /* not ready */ }

  // Check package root (dev / portable)
  const candidates = [".env", ".env.local", path.join(process.cwd(), ".env")];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function parseEnv(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/(^["']|["']$)/g, "");
    if (key && value) vars[key] = value;
  }
  return vars;
}

export function loadEnv(): Record<string, string> {
  const envFile = findEnvFile();
  if (!envFile) return {};
  try {
    const content = fs.readFileSync(envFile, "utf-8");
    return parseEnv(content);
  } catch {
    return {};
  }
}

/** Validate the runtime configuration. Checks required API keys and URL formats. */
export function validateConfig(cfg: CarbonConfig): EnvValidation {
  const missing: string[] = [];
  const invalid: Array<{ key: string; reason: string }> = [];

  if (cfg.customOpenAiBaseUrl && !cfg.customOpenAiBaseUrl.startsWith("http")) {
    invalid.push({ key: "CUSTOM_OPENAI_BASE_URL", reason: "Must be a valid HTTP/HTTPS URL" });
  }

  if (cfg.customOpenAiBaseUrl && !cfg.customOpenAiApiKey) {
    missing.push("CUSTOM_OPENAI_API_KEY");
  }
  if (cfg.customOpenAiBaseUrl && !cfg.customOpenAiModel) {
    missing.push("CUSTOM_OPENAI_MODEL");
  }

  if (!cfg.openaiApiKey && !cfg.anthropicApiKey && !cfg.customOpenAiApiKey) {
    missing.push("OPENAI_API_KEY or ANTHROPIC_API_KEY or CUSTOM_OPENAI_API_KEY");
  }

  return {
    valid: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
  };
}

export function buildConfig(env: Record<string, string>): CarbonConfig {
  const defaults: CarbonConfig = {
    dataDir: env.CARBON_DATA_DIR || (() => {
      try { return app.getPath("userData"); } catch { return process.cwd(); }
    })(),
    logLevel: (env.CARBON_LOG_LEVEL as CarbonConfig["logLevel"]) || "info",
    logPretty: env.CARBON_LOG_PRETTY === "true" || !app.isPackaged,
    telemetryEnabled: env.CARBON_TELEMETRY === "true",
    cloakHeadless: env.CLOAK_HEADLESS === "true",
    cloakSlowMo: Number(env.CLOAK_SLOW_MO || 50),
  };

  // Only include API keys if explicitly present
  if (env.OPENAI_API_KEY) defaults.openaiApiKey = env.OPENAI_API_KEY;
  if (env.ANTHROPIC_API_KEY) defaults.anthropicApiKey = env.ANTHROPIC_API_KEY;
  if (env.CUSTOM_OPENAI_BASE_URL) defaults.customOpenAiBaseUrl = env.CUSTOM_OPENAI_BASE_URL;
  if (env.CUSTOM_OPENAI_API_KEY) defaults.customOpenAiApiKey = env.CUSTOM_OPENAI_API_KEY;
  if (env.CUSTOM_OPENAI_MODEL) defaults.customOpenAiModel = env.CUSTOM_OPENAI_MODEL;

  return defaults;
}
