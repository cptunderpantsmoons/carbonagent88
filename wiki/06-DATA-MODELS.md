# 6. Data Models & Schemas

## 6.1 Entity Relationship Diagram

```mermaid
graph TB
    subgraph "Carbon Agent Domain Model"
        %% Primary entities
        W[Workspace
        id, name, vaultDir]
        P[Provider
        id, type, name, apiKey, model]
        BR[BrowserProfile
        id, name, status, targetDomains, cdpUrl]
        
        %% Conversation layer
        C[Conversation
        id, workspaceId, title]
        M1[Message
        id, conversationId, role, content]
        
        %% Execution layer
        R[Run
        id, conversationId, status, model, jsonlLogPath]
        RE[RunEvent
        id, runId, type, timestamp, payload]
        TC[ToolCall
        id, runId, toolName, input, output, error]
        
        %% Document layer
        DS[DataSource
        id, workspaceId, type, name, path]
        D[Document
        id, dataSourceId, title, content, chunkCount]
        DC[DocumentChunk
        id, documentId, chunkIndex, content, embedding]
        
        %% Knowledge layer
        S[LearnedSkill
        id, workspaceId, trigger, toolSequence, successCount]
        WM[AgentMemory
        id, workspaceId, key, content, tags, importance]
        
        %% Orchestration layer
        OS[OrchestrationSession
        id, workspaceId, status, currentGoal, root]
        SE[SessionEvent
        id, sessionId, role, kind, summary, payload]
        WS2[SessionWorkingSet
        sessionId, documents, gaps, provenanceScore]
        
        %% Operational layer
        WA[Watcher
        id, workspaceId, name, cronExpression, enabled]
        MR[ModelRole
        id, role, providerId, workspaceId]
        GD[GeneratedDocument
        id, workspaceId, title, format, filePath]
    end

    %% Relationships
    W -->|contains| C
    W -->|has| P
    W -->|has| BR
    W -->|imports| DS
    W -->|learns| S
    W -->|remembers| WM
    W -->|schedules| WA
    W -->|assigns| MR
    W -->|generates| GD
    
    C -->|has| M1
    C -->|spawns| R
    
    R -->|logs| RE
    R -->|calls| TC
    
    DS -->|parsed to| D
    D -->|chunks to| DC
    
    OS -->|emits| SE
    OS -->|maintains| WS2
    
    style W fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style C fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style R fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    style D fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    style OS fill:#e0f2f1,stroke:#00897b,stroke-width:2px
    style WA fill:#fff8e1,stroke:#fbc02d,stroke-width:2px
    style S fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
```

## 6.2 Workspace-Centric Model

```mermaid
graph TB
    subgraph "Workspace Isolation"
        W1[Workspace A
        Client: Acme Corp]
        W2[Workspace B
        Client: Globex]
    end
    
    W1 --> V1[Vault Files
    ~/.carbon-agent/vault/{uuid}/]
    W1 --> D1[Documents Chunks
    RAG Queries]
    W1 --> R1[Runs Log
    ~/.carbon-agent/logs/]
    W1 --> S1[Skills Learned
    Acme patterns]
    W1 --> M1[Memories
    Acme context]
    
    W2 --> V2[Vault Files
    ~/.carbon-agent/vault/{uuid}/]
    W2 --> D2[Documents Chunks]
    W2 --> R2[Runs Log]
    W2 --> S2[Skills Learned
    Globex patterns]
    W2 --> M2[Memories
    Globex context]
    
    style W1 fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style W2 fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style V1 fill:#e8f5e9
    style D1 fill:#fce4ec
    style S1 fill:#f3e5f5
```

## 6.3 Run Lifecycle State Machine

```mermaid
graph LR
    I[idle] --> C[running]
    C --> P[paused]
    P --> C
    C --> CO[completed]
    C --> F[failed]
    C --> CA[cancelled]
    CO --> I
    F --> I
    CA --> I

    style C fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style CO fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style F fill:#ffebee,stroke:#c62828,stroke-width:2px
    style CA fill:#fce4ec,stroke:#c2185b,stroke-width:2px
```

## 6.4 Orchestration Session State Machine

```mermaid
graph LR
    D[draft] --> R[running]
    R --> W[waiting]
    W --> R
    R --> CO[completed]
    R --> F[failed]
    R --> CA[cancelled]
    W --> CO
    W --> F
    W --> CA

    style D fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style R fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style CO fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style F fill:#ffebee,stroke:#c62828,stroke-width:2px
    style CA fill:#fce4ec,stroke:#c2185b,stroke-width:2px
```

## 6.5 Watcher State Machine

```mermaid
graph LR
    P[pending] --> R[running]
    R --> S[success]
    R --> F[failed]
    S --> P2[pending
    next cycle]
    F --> P2
    P2 --> R2[running]

    style P fill:#e3f2fd
    style R fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style S fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style F fill:#ffebee,stroke:#c62828,stroke-width:2px
```

## 6.6 Document Processing State Machine

```mermaid
graph LR
    P[pending] --> PR[processing]
    PR --> C[completed]
    PR --> F[failed]

    style P fill:#e3f2fd
    style PR fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style C fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style F fill:#ffebee,stroke:#c62828,stroke-width:2px
```

## 6.7 IPC Request/Response Flow

```mermaid
graph TB
    subgraph "Renderer → Main Request"
        REQ[IpcRequest
        discriminated union: type field]
        
        P1[provider/list]
        P2[provider/create]
        P3[provider/update]
        P4[provider/delete]
        P5[provider/test]
        
        R1[run/create]
        R2[run/stream]
        R3[run/cancel]
        
        O1[session/create]
        O2[session/start]
        O3[session/get]
        
        V1[vault/read]
        V2[vault/write]
    end

    subgraph "Main → Renderer Response"
        RES[IpcResponse
        discriminated union: type field]
        
        S1[provider/list.success]
        S2[provider/create.success]
        
        SR1[run/stream.success
        chunk: string]
        SR2[run/stream.complete]
        
        SV1[vault/read.success
        content: string]
        
        E[error
        error: string
        code: string]
    end

    REQ --> P1 & P2 & R1 & O1 & V1
    P1 & P2 & R1 & O1 & V1 --> RES
    RES --> S1 & S2 & SR1 & SV1 & E

    style REQ fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style RES fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    style E fill:#ffebee,stroke:#c62828,stroke-width:2px
```

## 6.8 Data Flow: Playground Chat

```mermaid
graph LR
    subgraph "User Action"
        U[Type message
        Click Send]
    end
    subgraph "Renderer"
        R1[playground-view.ts
        render message bubble]
        R2[carbonAPI.invoke
        request: run/stream]
    end
    subgraph "Preload"
        P[preload.ts
        ipcRenderer.invoke]
    end
    subgraph "Main"
        M[ipc-handlers.ts
        case "run/stream"]
        A[agent-runner.ts
        runAgent]
        AG[core-runtime
        agent.ts
        Stream LLM]
        DB[SQLite
        messages, runs, run_events]
        LOG[JSONL
        append events]
    end
    subgraph "Stream Back"
        E[Main emits
        session-update event]
        PS[Preload receives
        onSessionUpdate]
        PR[Renderer updates
    chat in real-time]
    end

    U --> R1
    R1 --> R2
    R2 --> P
    P --> M
    M --> A
    A --> AG
    A --> DB
    A --> LOG
    AG --> E
    E --> PS
    PS --> PR

    style R1 fill:#e3f2fd
    style M fill:#fff3e0
    style AG fill:#fce4ec
    style PR fill:#e8f5e9
```

## 6.9 Knowledge Graph Data Model

```mermaid
graph TB
    subgraph "Knowledge Graph"
        E1[Entity: Invoice #1234
        type: document]
        E2[Entity: Acme Corp
        type: organization]
        E3[Entity: Jan 15 2024
        type: date]
        E4[Entity: $5,000
        type: amount]
        
        R1[RELATION: issued_by]
        R2[RELATION: dated]
        R3[RELATION: amount]
        R4[RELATION: mentions]
    end

    E1 --> R1 --> E2
    E1 --> R2 --> E3
    E1 --> R3 --> E4
    E2 --> R4 --> E4

    style E1 fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style E2 fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    style E3 fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style E4 fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    style R1 fill:#f3e5f5
    style R2 fill:#e0f2f1
    style R3 fill:#fff8e1
```

## 6.10 Factories (Data Creation Patterns)

```mermaid
graph LR
    subgraph "Factory Pattern"
        F1[createProvider(type, name, apiKey, model)
        → AIProviderConfig]
        F2[createWorkspace(name, vaultDir)
        → Workspace]
        F3[createRun(conversationId, providerId)
        → Run]
        F4[createWatcher(workspaceId, name, cron, prompt)
        → Watcher]
        F5[createSession(workspaceId, root, goal)
        → OrchestrationSession]
        F6[createSkill(workspaceId, trigger, toolSequence)
        → LearnedSkill]
    end

    F1 --> DB[SQLite INSERT]
    F2 --> DB
    F3 --> DB
    F4 --> DB
    F5 --> DB
    F6 --> DB

    style F1 fill:#e3f2fd
    style DB fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```
