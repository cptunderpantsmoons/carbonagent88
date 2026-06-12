# 2. Architecture & Data Flow

## 2.1 Monorepo Architecture

```mermaid
graph TB
    subgraph "Apps"
        D[apps/desktop]
    end

    subgraph "Shared Packages"
        S[shared-schemas]
        CR[core-runtime]
        CB[cloak-bridge]
        ING[ingestion]
        LS[local-store]
    end

    subgraph "External"
        LLM1[Anthropic]
        LLM2[OpenAI]
        LLM3[Custom]
        BROWSER[Chrome Browser]
        FILE[File System]
    end

    D -->|workspace:*| S
    D -->|workspace:*| CR
    D -->|workspace:*| CB
    D -->|workspace:*| ING
    D -->|workspace:*| LS

    CR -->|workspace:*| S
    CR -->|workspace:*| LS
    ING -->|workspace:*| S
    ING -->|workspace:*| LS
    CB -->|workspace:*| S
    LS -->|workspace:*| S

    CR -->|Provider Config| LS
    CR -->|LLM API| LLM1
    CR -->|LLM API| LLM2
    CR -->|LLM API| LLM3

    CB -->|CDP Protocol| BROWSER
    ING -->|Parse/Embed| FILE
    LS -->|SQLite DB| FILE

    style D fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style S fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    style CR fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    style CB fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    style ING fill:#e0f2f1,stroke:#00897b,stroke-width:2px
    style LS fill:#fff8e1,stroke:#fbc02d,stroke-width:2px
```

## 2.2 IPC Communication Architecture

The IPC layer enforces type safety through Zod schemas. All communication is strictly validated.

### 2.2.1 Request Flow (Renderer → Main)

```mermaid
sequenceDiagram
    participant R as Renderer
    participant P as Preload
    participant M as Main Process
    participant DB as SQLite DB

    R->>R: User Action
    R->>P: carbonAPI.invoke({type: "provider/list"})
    P->>M: ipcRenderer.invoke("carbon-ipc", request)
    
    M->>M: IpcRequestSchema.parse(rawRequest)
    M->>M: Switch on request.type

    alt "provider/list"
        M->>DB: SELECT * FROM providers
        DB-->>M: Provider rows
        M->>M: mapProviderRow(row)
    else "run/create"
        M->>DB: INSERT run record
        DB-->>M: Run row
        M->>M: spawnAgentThread()
    else "session/create"
        M->>DB: INSERT session record
        M->>M: emitSessionUpdate()
    end

    M-->>P: IpcResponse (Zod validated)
    P-->>R: Promise resolves
    
    alt Streaming Events
        M-->>P: ipcMain.emit("carbon-event:session-update")
        P-->>R: onSessionUpdate callback
    end
```

### 2.2.2 Event Flow (Main → Renderer)

| Event Channel | Payload | Emitted When |
|--------------|---------|-------------|
| `carbon-event:viewport-frame` | `{profileId, screenshot}` | Browser viewport capture |
| `carbon-event:agent-topology` | `{runId, nodes, edges}` | Agent topology changes |
| `carbon-event:axtree` | `{profileId, tree, activeNodeId}` | Accessibility tree update |
| `carbon-event:watcher-analytics` | `{runs[]}` | Watcher run completes |
| `carbon-event:vault-change` | `{workspaceId, filePath, content}` | Vault file modified |
| `carbon-event:session-update` | `{sessionId, status, currentGoal}` | Orchestration session state |
| `carbon-event:session-working-set` | `{documents[], gaps[], provenanceScore}` | Working set update |
| `carbon-event:session-event` | `{sessionId, event}` | New session event logged |

## 2.3 Agent Execution Flow

### 2.3.1 Single Run Flow

```mermaid
graph TD
    A[User sends message<br/>in Playground] --> B[createRun()<br/>SQLite]
    B --> C[runAgent(runId)<br/>agent-runner.ts]
    C --> D[Load conversation history]
    D --> E[Build LLM prompt]
    E --> F[Stream request to LLM]
    F -->|chunk| G[Append to JSONL log]
    G --> H[Emit stream events]
    H --> I[Update UI in real-time]
    F --> J[Tool call detected?]
    J -->|Yes| K[Execute tool]
    K --> L[Store tool output]
    L --> E
    J -->|No| M[Complete response]
    M --> N[Update run status]
    N --> O[Emit completion event]

    style A fill:#e3f2fd
    style F fill:#fff3e0
    style K fill:#fce4ec
    style M fill:#e8f5e9
```

### 2.3.2 Orchestration Session Flow

```mermaid
graph TB
    subgraph "Phase 1: Init"
        U[User Request<br/>Outlook Thread]
        G1[Goals Agent]
        G2[Planner Agent]
    end

    subgraph "Phase 2: Collect"
        B[Browser Execution<br/>Authenticated Sessions]
        K[Knowledge Graph<br/>Normalization]
    end

    subgraph "Phase 3: Validate"
        V[Validator Agent]
        J[Judge Agent]
    end

    subgraph "Phase 4: Deliver"
        S[Specialist Agent<br/>Output Generation]
        R[Result Delivery]
    end

    U -->|root object| G1
    G1 -->|success criteria| G2
    G2 -->|collection plan| B
    B -->|raw data| K
    K -->|working set| V
    V -->|quality pass| J
    V -->|quality fail --> gaps| G2
    J -->|sufficient| S
    J -->|insufficient --> gaps| G2
    S -->|output| V
    S -->|approved result| R

    style U fill:#ffebee,stroke:#c62828,stroke-width:2px
    style R fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style V fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style J fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
```

## 2.4 Document Processing Pipeline

```mermaid
graph LR
    subgraph "Source"
        F1[Local File]
        F2[Browser Download]
        F3[Web Scrape]
    end

    subgraph "Ingestion"
        J1[Create Job<br/>status: pending]
        J2[Parse Document<br/>PDF/DOCX/MD/TXT]
        J3[Chunk Content<br/>~500 tokens]
        J4[Generate Embedding<br/>Xenova Transformers]
        J5[Extract Graph<br/>Entities + Relations]
    end

    subgraph "Storage"
        S1[data_sources table]
        S2[documents table]
        S3[document_chunks table]
        S4[SQLite Vectors]
        S5[Knowledge Graph]
    end

    subgraph "Query"
        Q1[RAG Retrieve<br/>Semantic Search]
        Q2[graph_query<br/>Entity Relations]
    end

    F1 --> J1
    F2 --> J1
    F3 --> J1
    J1 --> J2
    J2 --> J3
    J3 --> J4
    J4 --> J5
    J2 --> S2
    J3 --> S3
    J4 --> S4
    J5 --> S5
    F1 --> S1
    F2 --> S1
    F3 --> S1
    S2 --> Q1
    S3 --> Q1
    S4 --> Q1
    S5 --> Q2

    style J2 fill:#e3f2fd
    style J4 fill:#e8f5e9
    style J5 fill:#fce4ec
    style Q1 fill:#fff3e0
```

## 2.5 Database Primary Tables

```mermaid
graph TB
    W[workspaces] --> P[providers]
    W --> C[conversations]
    W --> R[runs]
    W --> D[documents]
    W --> DC[document_chunks]
    W --> SK[skills]
    W --> WA[watchers]
    W --> M[memories]
    W --> MR[model_roles]
    W --> OS[orchestration_sessions]
    W --> GD[generated_documents]

    C --> M1[messages]
    R --> RE[run_events]
    RE --> T[tool_calls]
    R --> J[jsonl files]
    D --> DS[data_sources]
    OS --> SE[session_events]
    OS --> WS[session_working_sets]

    SK -->|trigger embedding| V[vectors]
    DC -->|embedding| V

    style W fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style OS fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    style RE fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style V fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```
