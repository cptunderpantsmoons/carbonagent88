/**
 * Database Context — Shared DB initialization and LLM caller builder
 */

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
  }
  return db;
}

export async function buildLLMCallerForGraphExtraction(): Promise<LLMCaller | undefined> {
  const d = await ensureDb();
  const providers = await d.listProvidersWithKeys();
  if (providers.length === 0) return undefined;

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
