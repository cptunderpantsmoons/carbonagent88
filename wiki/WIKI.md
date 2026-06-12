# Carbon Agent — Local Wiki

> Enterprise document reasoning with authenticated browser sessions.
> Version: 0.1.0 | Last Updated: 2026-06-06

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture & Data Flow](#2-architecture--data-flow)
3. [Project Structure](#3-project-structure)
4. [Desktop Application (Electron)](#4-desktop-application-electron)
5. [Package Reference](#5-package-reference)
6. [User Interface](#6-user-interface)
7. [Data Models & Schemas](#7-data-models--schemas)
8. [Core Features](#8-core-features)
9. [Browser Orchestration](#9-browser-orchestration)
10. [Developer Guide](#10-developer-guide)
11. [Appendix](#11-appendix)

---

## 1. System Overview

### 1.1 What is Carbon Agent?

Carbon Agent is an Electron-based desktop application for **enterprise document reasoning**. It enables authenticated browser sessions to collect, process, and reason over documents from multiple sources (Outlook, SharePoint, Monday, Xero, spreadsheets, and local files).

### 1.2 Key Capabilities

| Capability | Description |
|------------|-------------|
| **Multi-Provider AI** | Anthropic, OpenAI, Custom OpenAI-compatible APIs |
| **Browser Authentication** | CloakBridge for persistent authenticated sessions |
| **Document Ingestion** | File parsing, chunking, embedding, local RAG |
| **Knowledge Vault** | Note-taking with backlinks, outgoing links, mentions |
| **Orchestration** | Multi-agent system for autonomous data collection |
| **Document Generation** | Markdown, DOCX, PDF output formats |
| **Watchers** | Cron-scheduled automated tasks |
| **CLI Integration** | Claude Code and Codex sub-agent support |

### 1.3 Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vanilla TypeScript, CSS Variables, Electron Renderer |
| Backend (Main) | Electron Main, Node.js 22+ |
| IPC | Electron IPC with Zod validation |
| Database | SQLite (via better-sqlite3) |
| Packages | pnpm workspace monorepo |
| Testing | Vitest |
| Styling | CSS Variables, Grid, Flexbox |

---

## 2. Architecture & Data Flow

### 2.1 System Architecture Diagram

```mermaid
graph TB
    subgraph "Desktop App (Electron)"
        R[Renderer Process<br/>UI / Views]
        P[Preload Script<br/>Zod IPC Bridge]
        M[Main Process<br/>IPC Handlers]
    end

    subgraph "Packages"
        S[shared-schemas<br/>Zod IPC Contracts]
        CR[core-runtime<br/>Agent Loop, LLM Gateway]
        CB[cloak-bridge<br/>Browser Session Control]
        ING[ingestion<br/>Parse, Chunk, Embed]
        LS[local-store<br/>SQLite / Filesystem]
    end

    subgraph "External Services"
        LLM1[Anthropic API]
        LLM2[OpenAI API]
        LLM3[Custom OpenAI]
        B1[Outlook]
        B2[SharePoint]
        B3[Monday]
        B4[Xero]
        B5[Spreadsheets]
    end

    R -->|IPC Request| P
    P -->|carbon-ipc| M
    M -->|IpcResponse| P
    P -->|Event| R
    
    M -->|Zod Validate| S
    M -->|Query| LS
    M -->|Agent Run| CR
    M -->|Browser| CB
    M -->|Ingest| ING
    
    CR -->|LLM Call| LLM1
    CR -->|LLM Call| LLM2
    CR -->|LLM Call| LLM3
    CB -->|CDP| B1
    CB -->|CDP| B2
    CB -->|CDP| B3
    CB -->|CDP| B4
    CB -->|CDP| B5
    
    ING -->|Vectors| LS

    style R fill:#e1f5fe
    style M fill:#fff3e0
    style S fill:#f3e5f5
    style CR fill:#e8f5e9
    style CB fill:#fce4ec
    style ING fill:#e0f2f1
    style LS fill:#fff8e1
```

### 2.2 IPC Communication Flow

```mermaid
sequenceDiagram
    participant R as Renderer
    participant P as Preload
    participant M as Main
    participant DB as SQLite
    participant LLM as LLM API

    R->>P: Window.carbonAPI.invoke(request)
    P->>M: ipcRenderer.invoke("carbon-ipc", request)
    M->>M: IpcRequestSchema.parse(rawRequest)
    alt Provider Operation
        M->>DB: CRUD provider config
        M->>M: createProvider(config)
        M->>LLM: API Key test call
    else Run Operation
        M->>DB: createRun()
        M->>M: runAgent(runId, message)
        M->>LLM: Stream response
        M-->>P: Stream chunks
        P-->>R: onSessionUpdate event
    end
    M-->>P: IpcResponse
    P-->>R: Promise resolution
```

### 2.3 Document Processing Pipeline

```mermaid
graph LR
    A[File/URL] --> B[Ingestion Job]
    B --> C[Parse & Extract]
    C --> D[Chunking]
    D --> E[Embedding]
    E --> F[Knowledge Graph
    Entities & Relationships]
    F --> G[Local SQLite Store]
    
    style A fill:#ffebee
    style B fill:#fff3e0
    style C fill:#fffde7
    style D fill:#e8f5e9
    style E fill:#e0f2f1
    style F fill:#e3f2fd
    style G fill:#f3e5f5
```

---

## 3. Project Structure

### 3.1 Monorepo Layout

```
carbon-agent/
├── apps/desktop/              # Electron desktop application
│   ├── src/
│   │   ├── main.ts            # Electron main process entry
│   │   ├── preload.ts         # IPC bridge (Zod validated)
│   │   ├── ipc-handlers.ts    # All IPC route handlers
│   │   ├── agent-runner.ts    # Agent execution orchestrator
│   │   ├── watcher-manager.ts # Cron job scheduler
│   │   ├── document-generator.ts  # DOCX/PDF/Markdown generation
│   │   ├── document-records.ts    # Generated document persistence
│   │   ├── db-context.ts      # Database connection context
│   │   ├── session-events.ts  # Session event emitters
│   │   ├── desktop-events.ts  # Desktop-wide event emitters
│   │   ├── cli-subagent.ts    # Claude Code/Codex detection
│   │   └── renderer/          # Frontend UI
│   │       ├── index.html     # Main HTML shell
│   │       ├── renderer.ts    # View router, CMDK palette
│   │       ├── styles.css     # Complete design system
│   │       ├── vault.ts       # Knowledge Vault view
│   │       ├── topology.ts    # Agent topology visualization
│   │       ├── axtree.ts      # Accessibility tree inspector
│   │       ├── components.ts  # Reusable UI components
│   │       ├── view-helpers.ts # Shared view utilities
│   │       ├── types.d.ts     # Renderer type definitions
│   │       ├── ui-components.ts # UI building blocks
│   │       ├── watcher-analytics.ts # Analytics dashboard
│   │       └── views/         # Screen views
│   │           ├── playground-view.ts     # Chat playground
│   │           ├── session-view.ts      # Session orchestration
│   │           ├── profiles-view.ts   # Cloak Bridge profiles
│   │           ├── providers-view.ts    # AI provider settings
│   │           ├── workspaces-view.ts   # Workspace management
│   │           ├── ingestion-view.ts    # File ingestion
│   │           ├── skills-view.ts       # Learned skills
│   │           ├── watchers-view.ts     # Task watchers
│   │           └── outputs-view.ts      # Document outputs
│   ├── dist/                  # Compiled JavaScript
│   ├── package.json           # Electron app manifest
│   └── tsconfig.json
│
├── packages/                  # Shared packages
│   ├── shared-schemas/        # Zod schemas for IPC + data models
│   │   └── src/index.ts       # All domain schemas (709 lines)
│   ├── core-runtime/          # Agent loop, providers, tools
│   │   └── src/
│   │       ├── index.ts       # Package exports
│   │       ├── agent.ts       # Agent execution engine
│   │       ├── gateway.ts     # LLM provider routing
│   │       ├── orchestrator.ts # Multi-agent orchestration
│   │       ├── browser-orchestration.ts # Browser automation
│   │       ├── skills.ts      # Skill registration & execution
│   │       └── providers/     # LLM provider implementations
│   │           ├── anthropic.ts
│   │           ├── openai.ts
│   │           └── custom-openai.ts
│   ├── cloak-bridge/          # Browser session management
│   │   └── src/index.ts       # CDP (Chrome DevTools Protocol)
│   ├── ingestion/             # Document processing pipeline
│   │   └── src/
│   │       ├── index.ts       # Ingestion orchestrator
│   │       ├── graph.ts       # Knowledge graph builder
│   │       ├── semantic-embed.ts # Vector embeddings
│   │       └── sql-js.d.ts    # sql.js type declarations
│   └── local-store/           # Data persistence layer
│       └── src/
│           ├── index.ts       # Package exports
│           ├── sqlite.ts      # SQLite database operations
│           ├── memory.ts      # Agent memory storage
│           ├── model-roles.ts  # Model role assignments
│           ├── skills.ts      # Learned skills storage
│           ├── crypto.ts      # Encryption utilities
│           ├── jsonl.ts       # JSONL log append operations
│           └── paths.ts       # File system path utilities
│
├── docs/superpowers/          # Architecture docs
│   ├── specs/                 # Design specifications
│   └── plans/                 # Implementation plans
├── package.json               # Root monorepo config
├── pnpm-workspace.yaml        # pnpm workspace definition
└── eslint.config.mjs        # Linting rules
```

---

## 4. Desktop Application (Electron)

### 4.1 Main Process Entry Point

**File**: `apps/desktop/src/main.ts`

```mermaid
sequenceDiagram
    participant App as Electron App
    participant Win as BrowserWindow
    participant WM as WatcherManager
    participant IPC as IPC Handlers

    App->>App: whenReady
    App->>Win: createWindow(1400x900)
    Win->>Win: loadFile(index.html)
    App->>WM: new WatcherManager()
    App->>WM: wm.initAll()
    WM->>WM: Initialize cron jobs
    App->>IPC: setWatcherManager(wm)
    App->>App: on("before-quit")
    App->>CB: closeAllBrowsers()
```

**Key Configuration**:
- Window: 1400×900 px
- Preload: `preload.js` with contextIsolation, sandbox enabled
- Node integration: Disabled (security)
- macOS app.on("activate") for proper dock behavior

### 4.2 Preload Script

**File**: `apps/desktop/src/preload.ts`

The preload script is the **security gateway** between renderer and main:

| Feature | Implementation |
|---------|---------------|
| IPC Bridge | `contextBridge.exposeInMainWorld("carbonAPI", api)` |
| Typed Invoke | Zod-validated `invoke(request)` → `Promise<IpcResponse>` |
| Event Listeners | Type-safe subscriptions for: viewport, topology, AXTree, analytics, vault, sessions |
| No raw Node.js | Only IPC channels, no fs/process access |

**Exposed API Channels**:
```typescript
interface CarbonAPI {
  invoke(request: IpcRequest): Promise<IpcResponse>;
  onViewportFrame?: (cb: (frame) => void) => () => void;
  onAgentTopology?: (cb: (data) => void) => () => void;
  onAXTree?: (cb: (data) => void) => () => void;
  onWatcherAnalytics?: (cb: (data) => void) => () => void;
  onVaultChange?: (cb: (data) => void) => () => void;
  onSessionUpdate?: (cb: (data) => void) => () => void;
  onSessionWorkingSet?: (cb: (data) => void) => () => void;
  onSessionEvent?: (cb: (data) => void) => () => void;
}
```

### 4.3 IPC Handlers

**File**: `apps/desktop/src/ipc-handlers.ts` (**719 lines**, consolidated single handler)

| Category | Operations |
|----------|------------|
| **Provider** | list, create, update, delete, test |
| **Profile** | list, create, update, delete, health, launchLogin, lock, unlock |
| **Workspace** | list, create, get |
| **Conversation** | list, create, get, delete |
| **Run** | list, create, get, cancel, stream |
| **Orchestration** | session/create, start, get, events, working-set |
| **Ingestion** | scan, retry |
| **Watcher** | list, create, update, toggle, delete, run |
| **Document** | generate, list, open, reveal |
| **Vault** | list, read, write |
| **Skills** | list, pin, delete, export, import |
| **Memory** | list, delete |
| **Model Roles** | list, set, delete |
| **CLI** | detect |
| **Stats** | list (active runs count) |

---

## 5. Package Reference

### 5.1 Shared Schemas (`@carbon-agent/shared-schemas`)

**Purpose**: Zod schemas for all domain types and IPC contracts.

**Key Schemas** (see Schema Reference for full definitions):

| Schema | Usage |
|--------|-------|
| `AIProviderConfigSchema` | AI provider settings (type, API key, model, baseUrl) |
| `BrowserProfileSchema` | CloakBridge profiles (status, targetDomains, cdpUrl) |
| `WorkspaceSchema` | Data isolation boundary |
| `ConversationSchema` | Chat thread |
| `RunSchema` | Agent execution instance |
| `RunEventSchema` | Audit trail events (llm_request, tool_call, etc.) |
| `LearnedSkillSchema` | Tool sequence + success metrics |
| `WatcherSchema` | Cron job definition |
| `OrchestrationSessionSchema` | Browser orchestration session |
| `SessionEventSchema` | Structured orchestration events |
| `ToolCallSchema` | 6 built-in tools (stealth_open, ingest_file, etc.) |
| `IpcRequestSchema` | All 40+ IPC operations in discriminated union |
| `IpcResponseSchema` | All response shapes in discriminated union |

### 5.2 Core Runtime (`@carbon-agent/core-runtime`)

**Purpose**: Agent execution, LLM routing, tools, orchestration.

| Module | Responsibility |
|--------|-------------|
| `agent.ts` | Main agent loop: process messages, call tools, stream responses |
| `gateway.ts` | LLM provider factory (Anthropic, OpenAI, Custom) |
| `orchestrator.ts` | Multi-agent coordination (Main, Goals, Planner, Browser, Knowledge, Validator, Judge) |
| `browser-orchestration.ts` | Browser session automation via CDP |
| `skills.ts` | Learned skill registration and execution |
| `providers/` | Provider-specific API implementations |

### 5.3 Cloak Bridge (`@carbon-agent/cloak-bridge`)

**Purpose**: Chrome DevTools Protocol (CDP) browser session management.

| Function | Description |
|----------|-------------|
| `launchBrowser(profile)` | Launch Chrome with profile directory |
| `connectCDP(url)` | Connect to running Chrome via CDP |
| `stealthNavigate(tab, url)` | Navigate without detection |
| `stealthScrape(tab)` | Extract page content |
| `stealthDownload(tab, url)` | Download file from page |
| `checkSessionHealth(profileId, dir, domain)` | Validate session cookies |
| `launchLoginPortal(profileId, dir)` | Open login page for manual auth |
| `lockProfile(profileId)` | Mark profile as locked |
| `unlockProfile(profileId)` | Mark profile as unlocked |
| `closeAllBrowsers()` | Graceful browser shutdown |

### 5.4 Ingestion (`@carbon-agent/ingestion`)

**Purpose**: Document processing pipeline.

| Module | Responsibility |
|--------|-------------|
| `index.ts` | Orchestrate scan → parse → chunk → embed |
| `graph.ts` | Build knowledge graph from extracted entities |
| `semantic-embed.ts` | Generate vector embeddings (Xenova transformers) |

**Pipeline Phases**:
1. **Detected** — File discovered in watched directory
2. **Parsed** — Content extracted (PDF, DOCX, MD, TXT)
3. **Embedded** — Vector embedding generated
4. **Graph Extract** — Entities and relationships identified

### 5.5 Local Store (`@carbon-agent/local-store`)

**Purpose**: Data persistence (SQLite + filesystem).

| Module | Responsibility |
|--------|-------------|
| `sqlite.ts` | All database operations, schema migrations |
| `memory.ts` | Agent memory (key-value with tags, importance) |
| `model-roles.ts` | Role-to-provider mapping |
| `skills.ts` | Learned skills CRUD |
| `crypto.ts` | AES-GCM encryption for API keys |
| `jsonl.ts` | Append-only log files for runs |
| `paths.ts` | Platform-aware path resolution |

---

## 6. User Interface

### 6.1 Application Layout

```mermaid
graph TD
    subgraph "Carbon Agent Desktop"
        SB[Sidebar Navigation<br/>5 Groups, 15+ Views]
        TB[Top Bar<br/>Workspace / Provider / Status]
        PT[Page Title Bar]
        CS[Content Shell<br/>Main Content + Inspector Panel]
    end

    subgraph "Sidebar Groups"
        G1[Core:<br/>Playground, Sessions, Vault, Watchers]
        G2[Data:<br/>Workspaces, Ingestion, Outputs]
        G3[Config:<br/>AI Providers, Cloak Bridge]
        G4[Cognitive:<br/>Learned Skills]
        G5[Debug:<br/>Topology, AXTree, Analytics]
    end

    subgraph "Overlays"
        CMDK[Command Palette<br/>Ctrl+K / Cmd+K]
        INS[Inspector Panel<br/>380px, slide-in]
        LV[Live Viewport<br/>Browser preview]
        RI[Run Inspector Modal]
        TC[Toast Container]
    end

    SB --> G1
    SB --> G2
    SB --> G3
    SB --> G4
    SB --> G5
    TB --> SB
    CS --> INS
    CS --> CMDK
    CS --> LV
    CS --> RI
    CS --> TC

    style SB fill:#e3f2fd
    style G1 fill:#fff3e0
    style G5 fill:#fce4ec
    style CMDK fill:#f3e5f5
    style INS fill:#e8f5e9
```

### 6.2 Command Palette (Ctrl+K)

**Features**:
- Search all views and actions
- Keyboard navigation (↑/↓/Enter/Escape)
- Grouped by category (Navigation, Actions)
- Visual shortcut hints

```mermaid
graph LR
    A[Ctrl+K] --> B[CMDK Opens]
    B --> C[Type Query]
    C --> D[Filtered Results]
    D --> E[Arrow Navigation]
    E --> F[Enter to Execute]
    F --> G[Action Performed]

    style A fill:#e3f2fd
    style B fill:#fff3e0
    style G fill:#e8f5e9
```

### 6.3 View List (15+ Screens)

| # | View | Category | Purpose |
|---|------|----------|---------|
| 1 | **Playground** | Core | Chat interface with AI assistant |
| 2 | **Sessions** | Core | Orchestration session control |
| 3 | **Knowledge Vault** | Core | Markdown note-taking with backlinks |
| 4 | **Watchers** | Core | Scheduled task monitoring |
| 5 | **Workspaces** | Data | Workspace management |
| 6 | **Ingestion** | Data | Document pipeline status |
| 7 | **Outputs** | Data | Generated document viewer |
| 8 | **AI Providers** | Config | LLM provider settings |
| 9 | **Cloak Bridge** | Config | Browser profile management |
| 10 | **Learned Skills** | Cognitive | Reusable agent skill library |
| 11 | **Topology** | Debug | Agent graph visualization |
| 12 | **AXTree** | Debug | Accessibility tree inspector |
| 13 | **Analytics** | Debug | Watcher run statistics |

---

## 7. Data Models & Schemas

### 7.1 Core Entity Relationship

```mermaid
graph LR
    subgraph "Workspace"
        W[Workspace]
        C[Conversation]
        R[Run]
        V[Vault Files]
        D[Documents]
        SK[Skills]
        WA[Watchers]
        M[Memories]
    end

    W -->|contains| C
    W -->|contains| R
    W -->|stores| V
    W -->|ingests| D
    W -->|learns| SK
    W -->|schedules| WA
    W -->|remembers| M
    C -->|spawns| R
    R -->|logs| E[Run Events]
    D -->|chunks| DC[Document Chunks]
    DC -->|embeds| VEC[Vectors]

    style W fill:#e3f2fd
    style R fill:#fff3e0
    style D fill:#e8f5e9
```

### 7.2 Orchestration Data Model

```mermaid
graph TB
    S[OrchestrationSession
    root=Outlook Thread] --> G[Goals Agent]
    S --> P[Planner Agent]
    S --> B[Browser Execution Agent]
    S --> K[Knowledge Graph Agent]
    S --> V[Validator Agent]
    S --> J[Judge Agent]
    
    G -->|defines| GS[Current Goal]
    P -->|builds| PL[Collection Plan]
    B -->|traverses| SRC[Sources:
    Outlook, SharePoint,
    Monday, Xero, Sheets]
    K -->|normalizes| WS[Working Set
    Documents, Entities,
    Metrics, Provenance]
    V -->|validates| WS
    J -->|judges| WS
    J -->|triggers| LOOP[Loop or Proceed]
    WS -->|feeds| SP[Specialist Agent
    Output Generation]
    
    S -->|emits| EV[Session Events
    goal_defined, plan_updated,
    browser_action_started,
    document_discovered,
    working_set_updated,
    judgment_returned]

    style S fill:#e3f2fd
    style WS fill:#fff3e0
    style J fill:#e8f5e9
    style EV fill:#f3e5f5
```

### 7.3 Run Event Types

| Event Type | Description | Example |
|------------|-------------|---------|
| `llm_request` | LLM API call initiated | Sending user query to Claude |
| `llm_response` | LLM response received | Assistant message received |
| `llm_error` | LLM API failure | Rate limit exceeded |
| `tool_call_start` | Tool execution started | Opening browser for download |
| `tool_call_end` | Tool execution completed | File downloaded successfully |
| `tool_call_error` | Tool execution failed | Network timeout |
| `system_message` | System message | Agent handoff complete |
| `ingestion_start` | Ingestion job started | Processing new document |
| `ingestion_complete` | Ingestion finished | 47 chunks created |
| `user_message` | User sent message | "Summarize this file" |
| `assistant_message` | Assistant response | "Here's the summary..." |

---

## 8. Core Features

### 8.1 Playground (Chat Interface)

**File**: `apps/desktop/src/renderer/views/playground-view.ts`

| Feature | Description |
|---------|-------------|
| Session Context | Workspace + Provider selectors |
| Suggested Tasks | Quick-action chips (Inspect portal, Ingest file, Draft document) |
| Chat Thread | User / assistant message bubbles |
| Streaming | Real-time LLM response streaming |
| Tool Results | Inline tool execution cards |
| Empty State | Helpful onboarding when no conversation |

### 8.2 Knowledge Vault

**File**: `apps/desktop/src/renderer/vault.ts`

| Feature | Description |
|---------|-------------|
| File Tree | Hierarchical markdown file browser |
| Search | Full-text search over vault files |
| Editor | In-place markdown editor |
| Preview | Live rendered markdown preview |
| Outgoing Links | Links from current note |
| Backlinks | Notes linking to current note |
| Mentions | Contextual mentions found in content |
| Inspector | Detail panel for selected file |

### 8.3 Document Generation

**File**: `apps/desktop/src/document-generator.ts`

| Output Format | Library | Use Case |
|---------------|---------|----------|
| Markdown | Native | Quick notes, reports |
| DOCX | docx (npm) | Business documents |
| PDF | pdf-lib (npm) | Formatted reports |

### 8.4 Watchers (Scheduled Tasks)

**File**: `apps/desktop/src/watcher-manager.ts`

| Field | Description |
|-------|-------------|
| Name | Human-readable task name |
| Prompt | Instruction for the agent |
| Cron Expression | Schedule (e.g., "0 9 * * 1" for weekly) |
| Enabled | On/off toggle |
| Profile | Optional browser profile for auth |
| Status | Success / Failed / Running / Pending |
| Last Run | Timestamp of last execution |

### 8.5 CLI Sub-Agents

**File**: `apps/desktop/src/cli-subagent.ts`

**Detected CLIs**:
| CLI | Purpose | Install Command |
|-----|---------|-----------------|
| Claude Code | Anthropic's coding assistant | `npm install -g @anthropic-ai/claude-code` |
| Codex | OpenAI's coding assistant | `npm install -g @anthropic-ai/???` |

---

## 9. Browser Orchestration

### 9.1 Browser Orchestration Goals

Carbon Agent's flagship feature: autonomous multi-source browser collection.

**Sources**:
- Outlook (email threads)
- SharePoint (documents)
- Monday.com (project boards)
- Xero (financial data)
- Web Spreadsheets (Google Sheets, Excel Online)

### 9.2 Two Supervision Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| **Watch Mode** | System runs autonomously, user watches live viewport | Trusted sessions |
| **Confirm Mode** | System pauses at checkpoints for user approval | Sensitive data |

### 9.3 Orchestration Execution Flow

```mermaid
graph TD
    A[User Request<br/>Outlook Thread] --> B[Goals Agent<br/>Defines success criteria]
    B --> C[Planner Agent<br/>Builds collection plan]
    C --> D[Browser Execution Agent<br/>Traverses authenticated sources]
    D --> E[Knowledge Graph Agent<br/>Normalizes to working set]
    E --> F[Validator Agent<br/>Checks quality]
    F -->|Gaps Found| C
    F -->|Quality OK| G[Judge Agent<br/>Evaluates sufficiency]
    G -->|Insufficient| C
    G -->|Sufficient| H[Main Assistant<br/>Spawns specialist]
    H --> I[Output Specialist<br/>Generates artifact]
    I --> F
    I --> J[Approved Result<br/>Delivered to user]

    style A fill:#ffebee
    style J fill:#e8f5e9
    style C fill:#fff3e0
    style D fill:#fce4ec
    style G fill:#e3f2fd
```

### 9.4 Persistent Core Agents

| Agent | Role | Responsibility |
|-------|------|-------------|
| **Main Assistant** | Coordinator | User conversation, specialist spawning |
| **Goals Agent** | Objective Setter | Explicit success criteria |
| **Planner Agent** | Strategist | Collection plan, source selection |
| **Browser Execution Agent** | Collector | Authenticated browser operations |
| **Knowledge Graph Agent** | Organizer | Working set normalization |
| **Validator Agent** | Quality Gate | Extraction quality checks |
| **Judge Agent** | Arbiter | Sufficiency vs. original request |

### 9.5 Ephemeral Specialist Agents

| Specialist | Deliverable |
|------------|-------------|
| Spreadsheet Analyst | Data analysis report |
| PDF/Document Analyst | Document extraction |
| Financial Statement Generator | Financial reports |
| Dashboard Generator | Interactive dashboards |
| Presentation Generator | Slide decks |
| Forecast Modeler | Projections |
| Claude Code Sub-Agent | Code tasks |
| Codex Sub-Agent | Code tasks |

---

## 10. Developer Guide

### 10.1 Build & Run

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Type check
pnpm typecheck

# Run tests
pnpm test

# Start Electron dev
pnpm --filter carbon-agent-desktop dev
```

### 10.2 Package Dependencies

```mermaid
graph TB
    subgraph "App"
        D[carbon-agent-desktop]
    end
    subgraph "Packages"
        S[shared-schemas]
        CR[core-runtime]
        CB[cloak-bridge]
        ING[ingestion]
        LS[local-store]
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

    style D fill:#e3f2fd
    style S fill:#fff3e0
```

### 10.3 Testing

| Package | Tests | Status |
|---------|-------|--------|
| shared-schemas | 15 | All pass |
| cloak-bridge | 7 | 1 pass (known: pruneAXTree not exported) |
| local-store | 11 | All pass |
| core-runtime | 20 | All pass |
| desktop | 2 | Pass (main, ipc-handlers) |

### 10.4 Code Style

- **TypeScript**: Strict mode, no implicit any
- **IPC**: All requests/responses Zod-validated
- **CSS**: Variables-driven, no inline styles
- **Unicode**: Zero emoji/symbols in source (CSS pseudo-elements only)
- **Security**: `sandbox: true`, `contextIsolation: true`, no `nodeIntegration`

### 10.5 Database Schema Overview

```mermaid
graph TB
    subgraph "SQLite Tables"
        T1[providers] --> T2[workspaces]
        T2 --> T3[conversations]
        T2 --> T4[runs]
        T2 --> T5[documents]
        T2 --> T6[watchers]
        T2 --> T7[skills]
        T2 --> T8[memories]
        T2 --> T9[model_roles]
        T5 --> T10[document_chunks]
        T3 --> T11[messages]
        T4 --> T12[run_events]
        T2 --> T13[orchestration_sessions]
        T13 --> T14[session_events]
        T13 --> T15[session_working_sets]
        T5 --> T16[data_sources]
        T2 --> T17[generated_documents]
    end

    style T1 fill:#e3f2fd
    style T2 fill:#fff3e0
    style T4 fill:#e8f5e9
    style T13 fill:#fce4ec
```

---

## 11. Appendix

### 11.1 File Size Reference

| Component | Lines | Size |
|-----------|-------|------|
| `renderer.ts` | 290 | 12.5 KB |
| `styles.css` | ~1500 | 52 KB |
| `playground-view.ts` | ~400 | 12.3 KB |
| `providers-view.ts` | ~450 | 13.6 KB |
| `session-view.ts` | ~520 | 16.6 KB |
| `profiles-view.ts` | ~330 | 10.5 KB |
| `skills-view.ts` | ~260 | 7.9 KB |
| `ipc-handlers.ts` | 719 | 33 KB |
| `shared-schemas/index.ts` | 709 | 27.8 KB |
| `agent-runner.ts` | ~700 | 25 KB |

### 11.2 JUDGE EVALUATION GATES

All GUI iterations pass 4 quality gates:

| Gate | Criteria | Status |
|------|----------|--------|
| **Gate 1** | Visual Hierarchy & Cohesion | PASS |
| **Gate 2** | Information Density & Clarity | PASS |
| **Gate 3** | Architectural Integrity | PASS |
| **Gate 4** | Provisional Polish | PASS |

### 11.3 Design System Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--font-xs` | 11px | Metadata, badges |
| `--font-sm` | 12px | Labels, timestamps |
| `--font-base` | 14px | Body text |
| `--font-lg` | 17px | Section titles |
| `--font-xl` | 20px | Page titles |
| `--sidebar-width` | 200px | Navigation width |
| `--topbar-height` | 48px | Header height |
| `--inspector-width` | 380px | Detail panel |

---

*Wiki generated: 2026-06-06*
*Carbon Agent v0.1.0*
*All Rights Reserved*
