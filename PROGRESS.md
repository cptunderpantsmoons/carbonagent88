# Carbon Agent 80/20 Progress

## Master Task List Status

### Phase 1: Schemas and Local Store
- [x] 1.1 Define Zod schemas for all minimal domain models in `shared-schemas`.
- [x] 1.2 Implement SQLite adapter in `local-store` with tables for Workspaces, Profiles, Documents, Runs.
- [x] 1.3 Establish filesystem layout (`~/.carbon-agent/`, `vault/`, `documents/`, `runs/`).
- [x] 1.4 Implement JSONL append-only logger for `RunEvent`.

### Phase 2: AI Gateway
- [ ] 2.1 Implement LLM provider abstraction in `core-runtime` supporting Anthropic, OpenAI, and Custom OpenAI-compatible.
- [ ] 2.2 Build Settings UI in Renderer to configure and save `AIProviderConfig`.
- [ ] 2.3 Implement Test Connection and single streaming chat call via IPC.

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
- **Focus**: Phase 1 — Schemas, Local Store, JSONL Logger
- **Files Modified**: See Phase 1 deliverables below
- **Technical Details**: 
  - Zod schemas define the full domain model with strict validation
  - SQLite adapter uses better-sqlite3 with WAL mode for concurrent safety
  - JSONL logger writes append-only events per agent run
  - Filesystem layout rooted at `~/.carbon-agent/`

## Build Status
- Typecheck: Success
- Tests: Success
