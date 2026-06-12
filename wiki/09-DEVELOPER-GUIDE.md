# 9. Developer Guide

## 9.1 Build & Run Workflow

### File: `apps/desktop/build.sh`

```mermaid
graph LR
    A[pnpm install] --> B[pnpm build]
    B --> C[tsc --project tsconfig.json]
    C --> D[Compile all .ts
    to dist/]
    D --> E[electron .]
    E --> F[Desktop App
    Window opens]

    style A fill:#e3f2fd
    style B fill:#fff3e0
    style F fill:#e8f5e9
```

### Commands

```bash
# Install all dependencies across monorepo
pnpm install

# Build all packages (topological order)
pnpm build

# Type check all packages
pnpm typecheck

# Run all tests
pnpm test

# Start Electron dev mode
cd apps/desktop
pnpm dev          # or: electron .

# Lint
pnpm lint
pnpm lint:fix
```

## 9.2 Package Build Order

```mermaid
graph TB
    subgraph "Build Dependencies"
        S[shared-schemas]
        LS[local-store
    depends on S]
        CR[core-runtime
    depends on S, LS]
        CB[cloak-bridge
    depends on S]
        ING[ingestion
    depends on S, LS]
        D[desktop
    depends on all packages]
    end

    S --> LS
    S --> CR
    S --> CB
    S --> ING
    LS --> CR
    LS --> ING
    CR --> D
    CB --> D
    ING --> D
    LS --> D

    style S fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style D fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
```

## 9.3 Testing Matrix

### Test Results

```mermaid
graph TB
    subgraph "Test Packages"
        S[shared-schemas
    15/15 PASS] --> V[100%]
        CB[cloak-bridge
    1/7 PASS] --> V2[14%
    Known: pruneAXTree
    not exported]
        LS[local-store
    11/11 PASS] --> V3[100%]
        CR[core-runtime
    20/20 PASS] --> V4[100%]
        D[desktop
    Tests: main, ipc-handlers] --> V5[PASS]
    end

    style S fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style LS fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style CR fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style D fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style CB fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
```

### Test Configuration

| Package | Config | Runner |
|---------|--------|--------|
| `apps/desktop` | `vitest.config.ts` | Vitest |
| `packages/core-runtime` | `vitest.config.ts` (implied) | Vitest |
| `packages/ingestion` | `vitest.config.ts` | Vitest |
| `packages/local-store` | `vitest.config.ts` | Vitest |
| `packages/shared-schemas` | `vitest.config.ts` | Vitest |

## 9.4 IPC Testing Pattern

```mermaid
graph LR
    subgraph "IPC Handler Mock Test"
        T[test.ts] --> M[Mock CarbonDatabase
    with in-memory SQLite]
        M --> R[Create Run
    inject test data]
        R --> I[Invoke IPC handler
    with test payload]
        I --> A[Assert response
    matches IpcResponseSchema]
    end

    style T fill:#e3f2fd
    style M fill:#fff3e0
    style A fill:#e8f5e9
```

## 9.5 File Size Reference

```mermaid
graph TB
    subgraph "Source File Sizes"
        S1[shared-schemas/index.ts
    709 lines, 27.8 KB]
        I[ipc-handlers.ts
    719 lines, 33.3 KB]
        A[agent-runner.ts
    ~700 lines, 25 KB]
        R[renderer/renderer.ts
    290 lines, 12.5 KB]
        SS[renderer/styles.css
    ~1500 lines, 52 KB]
        P[views/playground-view.ts
    ~400 lines, 12.3 KB]
        PR[views/providers-view.ts
    ~450 lines, 13.6 KB]
        SE[views/session-view.ts
    ~520 lines, 16.6 KB]
    end

    style S1 fill:#e3f2fd
    style I fill:#fff3e0
    style SS fill:#e8f5e9
    style SE fill:#fce4ec
```

| Component | Lines | Size |
|-----------|-------|------|
| `renderer.ts` | 290 | 12.5 KB |
| `styles.css` | ~1500 | 52 KB |
| `playground-view.ts` | ~400 | 12.3 KB |
| `providers-view.ts` | ~450 | 13.6 KB |
| `session-view.ts` | ~520 | 16.6 KB |
| `profiles-view.ts` | ~330 | 10.5 KB |
| `skills-view.ts` | ~260 | 7.9 KB |
| `ipc-handlers.ts` | 719 | 33.3 KB |
| `shared-schemas/index.ts` | 709 | 27.8 KB |
| `agent-runner.ts` | ~700 | 25 KB |

## 9.6 Electron Security Checklist

```mermaid
graph LR
    subgraph "Security Layers"
        S1[contextIsolation: true
    renderer isolated from Node.js]
        S2[nodeIntegration: false
    no require() in renderer]
        S3[sandbox: true
    OS-level isolation]
        S4[Zod Validation
    All IPC validated]
        S5[AES-GCM Encryption
    API keys encrypted at rest]
        S6[Vault Path Validation
    Prevent path escape]
    end

    style S1 fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style S2 fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style S3 fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style S4 fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style S5 fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style S6 fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```

| Security Feature | Status | File |
|------------------|--------|------|
| contextIsolation | ✅ Enabled | main.ts |
| nodeIntegration | ❌ Disabled | main.ts |
| sandbox | ✅ Enabled | main.ts |
| preload | ✅ Used | main.ts |
| Zod IPC | ✅ All validated | preload.ts, ipc-handlers.ts |
| AES-GCM | ✅ API keys encrypted | crypto.ts |
| Vault path check | ✅ `path.resolve()` validation | ipc-handlers.ts |

## 9.7 Code Style Standards

### TypeScript

```mermaid
graph LR
    A[TypeScript Strict Mode] --> B[No implicit any]
    A --> C[Discriminated unions for IPC]
    A --> D[Explicit return types]
    A --> E[Readonly where possible]
    A --> F[Optional chaining]

    style A fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
```

### CSS

```mermaid
graph LR
    A[CSS Architecture] --> B[CSS Variables for tokens]
    A --> C[No inline styles]
    A --> D[CSS pseudo-elements for icons]
    A --> E[Flexbox/Grid layouts]
    A --> F[Consistent spacing scale]

    style A fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
```

### Zero Unicode Policy

```mermaid
graph LR
    A[Before] --> B[Unicode symbols in HTML
    ◈ ◉ ◆ ⊞]
    B --> C[Problem: Emoji rendering
    inconsistency]
    C --> D[After]
    D --> E[CSS classes only
    .icon-playground { }]
    E --> F[All icons via ::before
    content: "●"]
    F --> G[Zero Unicode in renderer]

    style B fill:#ffebee
    style F fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```

| Metric | Value |
|--------|-------|
| Inline styles in renderer.ts | 0 ✅ |
| Inline styles in index.html | 0 ✅ |
| Uncode symbols in renderer | 0 ✅ |
| CSS icon classes | 19 |
| Empty state icon classes | 15 |

## 9.8 Database Schema Quick Reference

### Table Listing

```mermaid
graph TB
    subgraph "SQLite Schema"
        W[workspaces] --> P[providers]
        W --> C[conversations]
        W --> R[runs]
        W --> D[documents]
        W --> SK[skills]
        W --> WA[watchers]
        W --> M[memories]
        W --> MR[model_roles]
        W --> OS[orchestration_sessions]
        W --> GD[generated_documents]
        
        C --> M1[messages]
        R --> RE[run_events]
        RE --> TC[tool_calls]
        D --> DS[data_sources]
        D --> DC[document_chunks]
        OS --> SE[session_events]
        OS --> WS[session_working_sets]
    end

    style W fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style OS fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    style RE fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
```

### Key Table Fields

| Table | Key Fields |
|-------|-----------|
| `workspaces` | id, name, vaultDir, createdAt, updatedAt |
| `providers` | id, type, name, apiKey (encrypted), baseUrl, model |
| `browser_profiles` | id, name, status, targetDomains, cdpUrl, profileDir |
| `conversations` | id, workspaceId, title, createdAt, updatedAt |
| `runs` | id, conversationId, status, model, jsonlLogPath |
| `run_events` | id, runId, type, timestamp, payload |
| `documents` | id, dataSourceId, title, content, chunkCount |
| `document_chunks` | id, documentId, chunkIndex, content, embedding |
| `skills` | id, workspaceId, trigger, toolSequence, successCount, pinned |
| `watchers` | id, workspaceId, name, prompt, cronExpression, enabled, status |
| `memories` | id, workspaceId, key, content, tags, importance, source |
| `orchestration_sessions` | id, workspaceId, status, currentGoal, rootJson, supervisionMode |
| `session_events` | id, sessionId, role, kind, summary, payload |
| `session_working_sets` | sessionId, documentsJson, gapsJson, provenanceScore |

## 9.9 Development Environment

### Required

| Dependency | Version |
|------------|---------|
| Node.js | >= 22.0.0 |
| pnpm | Latest |
| Electron | ^33.0.0 |
| TypeScript | ^5.7.0 |
| better-sqlite3 | Native module |

### Platform Targets

| Platform | Target | Icon |
|----------|--------|------|
| Windows | NSIS Installer | `assets/icon.ico` |
| macOS | DMG | `assets/icon.icns` |
| Linux | AppImage | `assets/icon.png` |

## 9.10 Mock API Development

```mermaid
graph LR
    subgraph "Development Mode"
        R[Renderer] --> M[Mock IPC
    when carbonAPI missing]
        M --> D1[Mock responses
    for providers/list]
        M --> D2[Mock events
    for session-update]
        M --> D3[Mock data
    for vault files]
    end

    style R fill:#e3f2fd
    style M fill:#fff3e0
    style D1 fill:#e8f5e9
```

**File**: `apps/desktop/src/renderer/mock-api.js` (9.2 KB)

Provides mock data for development without backend:
- Provider list (Anthropic, OpenAI mock)
- Workspace list
- Session events
- Vault file listing
- Watcher status
