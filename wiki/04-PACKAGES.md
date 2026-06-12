# 4. Package Reference

## 4.1 Package Dependency Graph

```mermaid
graph TB
    subgraph "App"
        D[carbon-agent-desktop]
    end

    subgraph "Packages"
        S[shared-schemas<br/>Zero Dependencies]
        CR[core-runtime<br/>Depends on: S, LS]
        CB[cloak-bridge<br/>Depends on: S]
        ING[ingestion<br/>Depends on: S, LS]
        LS[local-store<br/>Depends on: S]
    end

    D --> S
    D --> CR
    D --> CB
    D --> ING
    D --> LS
    CR --> S
    CR --> LS
    ING --> S
    ING --> LS
    CB --> S
    LS --> S

    style D fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style S fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    style CR fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    style CB fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    style ING fill:#e0f2f1,stroke:#00897b,stroke-width:2px
    style LS fill:#fff8e1,stroke:#fbc02d,stroke-width:2px
```

## 4.2 Shared Schemas (`@carbon-agent/shared-schemas`)

**Location**: `packages/shared-schemas/src/index.ts`  
**Size**: 709 lines | 27.8 KB  
**Purpose**: Zod schemas for all domain types and IPC contracts

### Schema Classes

```mermaid
graph LR
    subgraph "AI Provider Models"
        P1[AIProviderConfigSchema<br/>id, type, name, apiKey, baseUrl, model]
        P2[AIProviderPublicSchema<br/>Same but no apiKey]
    end

    subgraph "Browser Models"
        B1[BrowserProfileSchema<br/>id, name, targetDomains, status, cdpUrl, profileDir]
        B2[SupervisionModeSchema<br/>watch | confirm]
    end

    subgraph "Workspace Models"
        W1[WorkspaceSchema<br/>id, name, vaultDir]
        W2[ConversationSchema<br/>id, workspaceId, messages]
        W3[RunSchema<br/>id, conversationId, status, messages, jsonlLogPath]
        W4[RunEventSchema<br/>id, runId, type, timestamp, payload]
    end

    subgraph "Skill Models"
        S1[LearnedSkillSchema<br/>trigger, toolSequence, successCount, failureCount, version]
        S2[ToolCallSchema<br/>stealth_open, scrape, download, ingest_file, rag_retrieve, write_note]
    end

    subgraph "Orchestration Models"
        O1[OrchestrationSessionSchema<br/>workspaceId, conversationId, root, supervisionMode, currentGoal]
        O2[SessionEventSchema<br/>sessionId, role, kind, summary, payload]
        O3[SessionWorkingSetSchema<br/>documents, gaps, provenanceScore, metrics]
        O4[CoreAgentRoleSchema<br/>main-assistant, goals, planner, browser, knowledge, validator, judge]
    end

    style P1 fill:#e3f2fd
    style B1 fill:#fce4ec
    style W1 fill:#fff3e0
    style S1 fill:#e8f5e9
    style O1 fill:#e0f2f1
```

### CoreAgentRoleSchema Detail

| Role | Responsibility | Model Type |
|------|-------------|------------|
| `main-assistant` | User conversation, specialist spawning | Fast |
| `goals` | Define success criteria | Reasoning |
| `planner` | Collection strategy | Reasoning |
| `browser` | Authenticated browser ops | Fast |
| `knowledge` | Working set normalization | Reasoning |
| `validator` | Quality gate | Reasoning |
| `judge` | Sufficiency decision | Reasoning |

### SessionEventKindSchema Values

| Event | When Emitted |
|-------|-------------|
| `goal_defined` | Goals agent sets objective |
| `plan_updated` | Planner refines strategy |
| `browser_action_started` | Browser agent begins navigation |
| `browser_action_completed` | Browser agent finishes extraction |
| `document_discovered` | New source found |
| `document_acquired` | Document downloaded/parsed |
| `working_set_updated` | Knowledge graph updated |
| `validation_passed` | Validator approves quality |
| `validation_failed` | Validator rejects, sends to planner |
| `judgment_requested` | Judge evaluates sufficiency |
| `judgment_returned` | Judge approves or requests more |
| `specialist_spawned` | New specialist agent created |
| `specialist_completed` | Specialist returns results |
| `output_approved` | Final output passes all gates |
| `output_rejected` | Output needs revision |

## 4.3 Core Runtime (`@carbon-agent/core-runtime`)

**Location**: `packages/core-runtime/src/`  
**Purpose**: Agent execution engine, LLM provider routing, orchestration

### Module Breakdown

```mermaid
graph TB
    subgraph "core-runtime"
        direction TB
        A[agent.ts<br/>Main Agent Loop]
        G[gateway.ts<br/>Provider Factory]
        O[orchestrator.ts<br/>Multi-Agent Coordination]
        B[browser-orchestration.ts<br/>Browser Automation]
        S[skills.ts<br/>Skill Execution]
        P[providers/]
    end

    subgraph "Provider Implementations"
        P1[anthropic.ts<br/>Claude API]
        P2[openai.ts<br/>GPT API]
        P3[custom-openai.ts<br/>Any Compliant API]
    end

    A --> G
    A --> S
    O --> B
    O --> G
    G --> P1
    G --> P2
    G --> P3

    style A fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style O fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style B fill:#fce4ec,stroke:#c2185b,stroke-width:2px
```

### Agent Loop (agent.ts)

```mermaid
graph LR
    M[Messages + Context] --> P[Build LLM Prompt]
    P --> S[Stream Request]
    S --> C{Chunk Type}
    C -->|Text| T[Append to
    response]
    C -->|Tool Call| TC[Extract tool
    name + args]
    TC --> R[Route to executor]
    R --> TO[Tool Output]
    TO --> M
    C -->|Done| F[Final Response]
    F --> U[Update conversation]

    style M fill:#e3f2fd
    style S fill:#fff3e0
    style TC fill:#fce4ec
    style F fill:#e8f5e9
```

### LLM Gateway (gateway.ts)

| Provider | Pattern | Default Model |
|----------|---------|---------------|
| Anthropic | Claude API | Claude Sonnet |
| OpenAI | GPT API | GPT-4 |
| Custom OpenAI | Base URL + API Key | User-specified |

### Orchestrator (orchestrator.ts)

```mermaid
graph TB
    subgraph "Orchestrator"
        A[receive session/create] --> B[Create Session DB Record]
        B --> C[Initialize Core Agents]
        C --> D[Spawn Goal Agent]
        D --> E[Spawn Planner Agent]
        E --> F[Spawn Browser Agent]
        F --> G[Collect Loop]
        G --> H[Spawn Knowledge Agent]
        H --> I[Validate]
        I --> J{Quality?}
        J -->|Fail| E
        J -->|Pass| K[Spawn Judge Agent]
        K --> L{Sufficient?}
        L -->|No| E
        L -->|Yes| M[Spawn Specialist]
        M --> N[Return to Main Assistant]
    end

    style A fill:#e3f2fd
    style G fill:#fff3e0
    style I fill:#fce4ec
    style K fill:#e0f2f1
    style M fill:#e8f5e9
```

### Browser Orchestration (browser-orchestration.ts)

| Method | Description |
|--------|-------------|
| `startViewportStreaming(profileId)` | Capture browser screenshots |
| `stopViewportStreaming(profileId)` | End screenshot capture |
| `getAccessibilityTree(profileId)` | Extract page AX tree |
| `executeBrowserAction(profileId, action)` | Run stealth action |
| `observePageChanges(profileId)` | Monitor DOM mutations |

### Skills (skills.ts)

| Method | Description |
|--------|-------------|
| `registerSkill(skill)` | Add learned skill to registry |
| `executeSkill(trigger, context)` | Match trigger, execute tool sequence |
| `recordSkillSuccess(skillId)` | Increment success count |
| `recordSkillFailure(skillId)` | Increment failure count, check disable |

## 4.4 Cloak Bridge (`@carbon-agent/cloak-bridge`)

**Location**: `packages/cloak-bridge/src/index.ts`  
**Purpose**: Chrome DevTools Protocol (CDP) session management

```mermaid
graph LR
    C[Chrome Browser] --> CDP[CDP WebSocket
    localhost:9222]
    CDP --> CB[CloakBridge]
    CB --> B1[launchBrowser(profile)]
    CB --> B2[connectCDP(url)]
    CB --> B3[stealthNavigate(tab, url)]
    CB --> B4[stealthScrape(tab)]
    CB --> B5[stealthDownload(tab, url)]
    CB --> B6[checkSessionHealth(profileId)]
    CB --> B7[launchLoginPortal(profileId)]
    CB --> B8[closeAllBrowsers()]

    style C fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style CDP fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style CB fill:#fce4ec,stroke:#c2185b,stroke-width:2px
```

### Browser Profile States

```mermaid
graph LR
    U[unknown] -->|check| A[active]
    U -->|expired| E[expired]
    E -->|re-login| A
    A -->|lock| L[locked]
    L -->|unlock| A
    L -->|timeout| E

    style A fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style E fill:#ffebee,stroke:#c62828,stroke-width:2px
    style L fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
```

## 4.5 Ingestion (`@carbon-agent/ingestion`)

**Location**: `packages/ingestion/src/`  
**Purpose**: Document processing pipeline

### Pipeline Phases

```mermaid
graph LR
    subgraph "Phase 1: Discovery"
        D[Scan watched
        directories]
    end
    subgraph "Phase 2: Parsing"
        P[Extract text from
        PDF/DOCX/MD/TXT]
    end
    subgraph "Phase 3: Chunking"
        C[Split into ~500
        token chunks]
    end
    subgraph "Phase 4: Embedding"
        E[Generate vector
        using Xenova]
    end
    subgraph "Phase 5: Graph Extraction"
        G[Extract entities +
        relationships]
    end
    subgraph "Storage"
        S[SQLite:
        data_sources
        documents
        document_chunks
        vectors
        knowledge_graph]
    end

    D --> P --> C --> E --> G --> S

    style D fill:#e3f2fd
    style P fill:#fff3e0
    style C fill:#e8f5e9
    style E fill:#fce4ec
    style G fill:#e0f2f1
    style S fill:#fff8e1
```

### Module Details

| Module | Function |
|--------|----------|
| `index.ts` | Orchestrate full pipeline, export APIs |
| `graph.ts` | Build knowledge graph from entity extraction |
| `semantic-embed.ts` | Generate embeddings with Xenova transformers |

## 4.6 Local Store (`@carbon-agent/local-store`)

**Location**: `packages/local-store/src/`  
**Purpose**: Data persistence, encryption, file management

### Module Details

```mermaid
graph TB
    subgraph "local-store"
        S[sqlite.ts<br/>All DB operations]
        M[memory.ts<br/>Agent memory]
        MR[model-roles.ts<br/>Role assignments]
        SK[skills.ts<br/>Learned skills]
        C[crypto.ts<br/>AES-GCM encrypt]
        J[jsonl.ts<br/>Append logs]
        P[paths.ts<br/>Path resolution]
    end

    subgraph "Consumers"
        D1[Desktop App IPC
    Handlers]
        D2[Core Runtime
    Agent Loop]
        D3[Ingestion
    Pipeline]
    end

    D1 --> S
    D1 --> M
    D1 --> MR
    D1 --> SK
    D1 --> C
    D2 --> S
    D2 --> M
    D2 --> C
    D3 --> S

    style S fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style C fill:#fce4ec,stroke:#c2185b,stroke-width:2px
```

### SQLite Schema Modules

| Module | Tables Managed |
|--------|---------------|
| `sqlite.ts` | All tables (providers, workspaces, conversations, runs, documents, etc.) |
| `memory.ts` | memories table (key-value with tags, importance) |
| `skills.ts` | skills table (tool sequences, success metrics) |
| `model-roles.ts` | model_roles table (role → provider mapping) |

### Encryption (crypto.ts)

```mermaid
graph LR
    D[API Key] --> K[deriveKey
    from device secret]
    K --> E[AES-GCM
    Encrypt]
    E --> S[Store in SQLite
    as ciphertext]
    S --> R[Retrieve
    ciphertext]
    R --> D2[deriveKey
    again]
    D2 --> Dec[AES-GCM
    Decrypt]
    Dec --> O[API Key
    recovered]

    style D fill:#e3f2fd
    style E fill:#fce4ec
    style S fill:#fff3e0
    style O fill:#e8f5e9
```

### JSONL Logging (jsonl.ts)

| Feature | Description |
|---------|-------------|
| Format | Append-only JSON Lines |
| Structure | `{id, runId, type, timestamp, payload}` |
| Use Case | Complete audit trail for every agent run |
| Location | `~/.carbon-agent/logs/{runId}.jsonl` |

### Path Resolution (paths.ts)

| Path | Purpose |
|------|---------|
| `~/.carbon-agent/db.sqlite` | Main database |
| `~/.carbon-agent/vault/{workspaceId}/` | Knowledge vault files |
| `~/.carbon-agent/logs/` | Run event logs |
| `~/.carbon-agent/profiles/` | Cloak browser profiles |
