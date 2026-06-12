/**
 * Database Context — Shared DB initialization and LLM caller builder
 *
 * Credentials are encrypted at rest using AES-256-GCM with a
 * machine-derived key (hostname + username + salt).
 */

import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import {
  CarbonDatabase,
  initDatabase,
} from "@carbon-agent/local-store";
import { createProvider } from "@carbon-agent/core-runtime";
import { loadEnv as _loadEnv, buildConfig as _buildConfig, validateConfig } from "./env.js";

// Note: LLMCaller type is not exported from @carbon-agent/ingestion
type LLMCaller = (prompt: string) => Promise<string>;

let db: CarbonDatabase | null = null;

export async function ensureDb(): Promise<CarbonDatabase> {
  if (!db) {
    await initDatabase();
    const { initSkillsTable } = await import("@carbon-agent/local-store");
    await initSkillsTable();
    db = new CarbonDatabase();
    await seedDefaultProviders(db);
    await seedDefaultProfiles(db);
  }
  return db;
}

function getEnvApiKeys(): { openai?: string; anthropic?: string; customBaseUrl?: string; customKey?: string; customModel?: string } {
  const env = _loadEnv();
  const cfg = _buildConfig(env);
  const validation = validateConfig(cfg);
  if (!validation.valid) {
    console.warn("[Carbon Agent] Environment configuration issues:");
    for (const k of validation.missing) {
      console.warn(`  Missing: ${k}`);
    }
    for (const { key, reason } of validation.invalid) {
      console.warn(`  Invalid: ${key} — ${reason}`);
    }
  }
  return {
    openai: cfg.openaiApiKey,
    anthropic: cfg.anthropicApiKey,
    customBaseUrl: cfg.customOpenAiBaseUrl,
    customKey: cfg.customOpenAiApiKey,
    customModel: cfg.customOpenAiModel,
  };
}

async function seedDefaultProviders(d: CarbonDatabase): Promise<void> {
  const existing = await d.listProviders();
  if (existing.length > 0) return;

  const keys = getEnvApiKeys();
  const providers: Array<{
    id: string;
    type: "openai" | "anthropic" | "custom-openai";
    name: string;
    apiKey: string;
    baseUrl?: string;
    model: string;
  }> = [];

  if (keys.customKey && keys.customBaseUrl && keys.customModel) {
    providers.push({
      id: crypto.randomUUID(),
      type: "custom-openai",
      name: "Custom Provider",
      apiKey: keys.customKey,
      baseUrl: keys.customBaseUrl,
      model: keys.customModel,
    });
  }
  if (keys.openai) {
    providers.push({
      id: crypto.randomUUID(),
      type: "openai",
      name: "OpenAI",
      apiKey: keys.openai,
      model: "gpt-4o",
    });
  }
  if (keys.anthropic) {
    providers.push({
      id: crypto.randomUUID(),
      type: "anthropic",
      name: "Anthropic (Claude)",
      apiKey: keys.anthropic,
      model: "claude-sonnet-4-20250514",
    });
  }

  for (const p of providers) {
    try {
      await d.createProvider(p);
    } catch (err) {
      console.warn("Failed to seed provider:", p.name, err);
    }
  }
}

async function seedDefaultProfiles(d: CarbonDatabase): Promise<void> {
  const existing = await d.listProfiles();
  if (existing.length > 0) return;

  const profileDir = path.join(os.homedir(), ".carbon-agent", "profiles", "default");
  await d.createProfile({
    id: crypto.randomUUID(),
    name: "Default",
    description: "Default browser profile for authenticated web sessions",
    profileDir,
    targetDomains: [],
  });
}

export async function buildLLMCallerForGraphExtraction(): Promise<LLMCaller> {
  const d = await ensureDb();
  const providers = await d.listProvidersWithKeys();
  if (providers.length === 0) {
    throw new Error("No AI provider configured. Add a provider in AI Providers before running graph extraction.");
  }

  const providerRow = providers[0];
  const providerConfig = {
    id: providerRow.id as string,
    type: providerRow.type as "anthropic" | "openai" | "custom-openai",
    name: providerRow.name as string,
    apiKey: providerRow.api_key as string,
    baseUrl: providerRow.base_url as string | undefined,
    model: providerRow.model as string,
    createdAt: providerRow.created_at as string,
    updatedAt: providerRow.updated_at as string,
  };

  const provider = createProvider(providerConfig);
  return async (prompt: string): Promise<string> => {
    const response = await provider.chat({
      messages: [
        {
          role: "system",
          content: "You are a precise knowledge graph extraction engine. Respond only with valid JSON.",
        },
        { role: "user", content: prompt },
      ],
      model: providerConfig.model,
      maxTokens: 4096,
      temperature: 0.2,
    });
    return response.content;
  };
}
