/**
 * Database Context — Shared DB initialization and LLM caller builder
 */

import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import {
  CarbonDatabase,
  initDatabase,
} from "@carbon-agent/local-store";
import { createProvider } from "@carbon-agent/core-runtime";
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

async function seedDefaultProviders(d: CarbonDatabase): Promise<void> {
  const existing = await d.listProviders();
  if (existing.length > 0) return;

  await d.createProvider({
    id: crypto.randomUUID(),
    type: "custom-openai",
    name: "Umans AI",
    apiKey: "sk-HPfucc2JwcHPdWHh0F_S8VE_BP8lHb8rCiooKO_pZmA",
    baseUrl: "https://api.code.umans.ai/v1",
    model: "umans-kimi-k2.6",
  });
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
