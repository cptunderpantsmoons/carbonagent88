# Carbon Agent 80/20 Progress

## Master Task List Status

### Phase 1: Schemas and Local Store
- [x] 1.1 Define Zod schemas for all minimal domain models in `shared-schemas`.
- [x] 1.2 Implement SQLite adapter in `local-store` with tables for Workspaces, Profiles, Documents, Runs.
- [x] 1.3 Establish filesystem layout (`~/.carbon-agent/`, `vault/`, `documents/`, `runs/`).
- [x] 1.4 Implement JSONL append-only logger for `RunEvent`.

### Phase 2: AI Gateway
- [x] 2.1 Implement LLM provider abstraction in `core-runtime` supporting Anthropic, OpenAI, and Custom OpenAI-compatible.
- [x] 2.2 Build Settings UI in Renderer to configure and save `AIProviderConfig`.
- [x] 2.3 Implement Test Connection and single streaming chat call via IPC.

### Phase 3: Carbon Bridge (CloakBrowser)
- [ ] 3.1 Implement `BrowserProfile` CRUD in `cloak-bridge`.
- [ ] 3.2 Build `launchLoginPortal(profileId)`: Spawn headed CloakBrowser with persistent profile directory.
- [ ] 3.3 Build Carbon Bridge UI in Renderer (List profiles, Launch Login, Health Check).
- [ ] 3.4 Implement session health check (silently verify cookies against target domain).

### Phase 4: Capture and Ingestion
- [ ] 4.1 Configure CloakBrowser to route downloads to controlled folder.
- [ ] 4.2 Implement file watcher for downloads, create Document records.
- [ ] 4.3 Build `ingestion` worker: parse, chunk, embed via configured AI provider.
- [ ] 4.4 Store chunks in local vector store with source metadata.

### Phase 5: Agent Runtime & Playground
- [ ] 5.1 Implement ReAct/tool loop with max step limits.
- [ ] 5.2 Wire up 6 core tools.
- [ ] 5.3 Build Playground UI.
- [ ] 5.4 Ensure all tool calls and LLM streams written to JSONL.

### Phase 6: Desktop Packaging & Hardening
- [ ] 6.1 Harden Electron Main/Preload security.
- [ ] 6.2 Implement lazy CloakBrowser binary detection.
- [ ] 6.3 Configure electron-builder for Windows .exe NSIS installer.
- [ ] 6.4 Ensure Session Vault path warnings for OneDrive/Dropbox.

---

## Current Cycle Execution Log
- **Focus**: Phase 2 — AI Gateway + Desktop Shell
- **Files Modified**:
  - `packages/core-runtime/src/gateway.ts` — Unified LLM interface
  - `packages/core-runtime/src/providers/{anthropic,openai,custom-openai}.ts` — Provider adapters
  - `apps/desktop/src/main.ts` — Electron Main with Zod IPC
  - `apps/desktop/src/preload.ts` — Safe IPC bridge
  - `apps/desktop/src/renderer/{index.html,renderer.ts,types.d.ts}` — UI views
- **Technical Details**:
  - Provider factory pattern: `createProvider(config)` returns typed LLMProvider
  - All providers implement: `chat()`, `stream()`, `testConnection()`
  - IPC handlers validate every request with `IpcRequestSchema.parse()`
  - Renderer uses `window.carbonAPI.invoke()` — no raw `ipcRenderer` access
  - UI: Sidebar nav, Playground chat, Provider settings form, Profile/Workspace lists

## Build Status
- Typecheck: Success (all 6 packages)
- Tests: 32/32 passing
- Git: 3 commits on master

---

# JUDGE EVALUATION REPORT

**Gate 1: Product Truth**
- [CLAIM: IN PROGRESS] 
- Evidence: Foundation laid. Zod schemas validate all data. SQLite stores providers/profiles/workspaces. LLM gateway supports 3 providers. Desktop shell has Playground, Settings, Profile, Workspace views. Agent loop and browser automation not yet wired.

**Gate 2: Security & Invariants**
- [CLAIM: PASS]
- Evidence: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` in Electron. All IPC payloads validated by Zod (`IpcRequestSchema.parse()`). Preload exposes only `invoke()` method. Renderer has zero filesystem access. No passwords in LLM context (passwords stored in SQLite, not sent to LLM).

**Gate 3: Architecture & Scope**
- [CLAIM: PASS]
- Evidence: Monorepo matches spec exactly. Layer ownership enforced: Main owns IPC/fs, Renderer owns UI, core-runtime owns LLM, local-store owns persistence. Zero code for visual workflows, billing, multi-user, or online demos. Strict 80/20 scope maintained.

**Gate 4: Observability & Operations**
- [CLAIM: PARTIAL]
- Evidence: JSONL logger implemented with typed event builders (`llmRequestEvent`, `toolCallStartEvent`, etc.). SQLite tracks tool_calls with start/end timestamps. Health check endpoint exists for profiles (`profile/health`). Run logging not yet wired to actual agent executions (Phase 5).
