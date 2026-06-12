# 8. Browser Orchestration

> Reference: `docs/superpowers/specs/2026-06-06-carbon-agent-browser-orchestration-design.md`

## 8.1 Browser Orchestration Vision

```mermaid
graph TB
    subgraph "Enterprise User"
        U[User authenticates
        browser sessions]
        U --> A[Systems:
    Outlook, SharePoint,
    Monday, Xero, Sheets]
    end

    subgraph "Carbon Agent"
        R[User request
    e.g., "Summarize Q1 invoices"]
        R --> M[Main Assistant]
        M --> O[Orchestrator
    spawns agents]
    end

    subgraph "Autonomous Collection"
        O --> B[Browser Agent
    uses authenticated sessions]
        B --> D1[Outlook:
    Search emails]
        B --> D2[SharePoint:
    Download docs]
        B --> D3[Monday:
    Get project status]
        B --> D4[Xero:
    Extract financials]
        B --> D5[Sheets:
    Read data]
    end

    subgraph "Output"
        V[Validator confirms
    data quality]
        V --> J[Judge confirms
    sufficiency]
        J --> S[Specialist generates
    report / dashboard]
        S --> M2[Main Assistant
    presents to user]
    end

    D1 & D2 & D3 & D4 & D5 --> K[Knowledge Graph
    Working Set]
    K --> V

    style U fill:#e3f2fd
    style O fill:#fff3e0
    style B fill:#fce4ec
    style S fill:#e8f5e9
```

## 8.2 Two Supervision Modes

```mermaid
graph LR
    subgraph "Watch Mode"
        W[User watches
    live viewport]
        W --> A[System runs
    autonomously]
        A --> C1[Chrome Browser
    full CDP control]
        A --> S1[Speed: Full
    No pauses]
        A --> T1[Trust Level: High
    Sessions already authenticated]
    end

    subgraph "Confirm Mode"
        M[User must approve
    each checkpoint]
        M --> B[System pauses
    at checkpoints]
        B --> C2[Chrome Browser
    manual navigation]
        B --> S2[Speed: Slower
    User approval time]
        B --> T2[Trust Level: Cautious
    Sensitive data access]
    end

    style W fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style M fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
```

## 8.3 Orchestration Execution Flow

```mermaid
graph TB
    subgraph "Phase 1: Initialize"
        P1[Outlook Thread
    Root object] --> P2[Goals Agent
    defines success criteria]
        P2 --> P3[Planner Agent
    builds collection plan]
    end

    subgraph "Phase 2: Collect"
        P3 --> C1[Browser Execution Agent
    navigates authenticated systems]
        C1 --> C2[Explore sources:
    emails, attachments,
    links, participants]
        C2 --> C3[Knowledge Graph Agent
    normalizes findings]
    end

    subgraph "Phase 3: Validate"
        C3 --> V1[Validator Agent
    checks quality]
        V1 -->|Gaps| P3
        V1 -->|Quality OK| V2[Judge Agent
    evaluates sufficiency]
    end

    subgraph "Phase 4: Deliver"
        V2 -->|Insufficient| P3
        V2 -->|Sufficient| D1[Main Assistant
    spawns specialist]
        D1 --> D2[Specialist Agent
    generates output]
        D2 --> V3[Validator re-checks
    specialist output]
        V3 --> D3[Deliver to user]
    end

    style P1 fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style C2 fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    style V2 fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style D3 fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```

## 8.4 Source Expansion Strategy

```mermaid
graph TB
    subgraph "Root: Outlook Thread"
        R[Email Thread] --> A1[Attachments]
        R --> A2[Links]
        R --> A3[Participants]
        R --> A4[Body Text]
        R --> A5[Subject]
    end

    subgraph "Exploratory Collection"
        A1 --> D1[Documents on
    SharePoint]
        A2 --> D2[Web pages
    Spreadsheets]
        A3 --> D3[Employee records
    Communication history]
        A4 --> D4[Project names
    Financial references]
        A5 --> D5[Date ranges
    Recurring patterns]
    end

    subgraph "Learned Patterns"
        L1[Organization-specific
    structures]
        L2[Recurring document
    types]
    end

    D4 --> L1
    D5 --> L2

    style R fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style D1 fill:#e8f5e9
    style D2 fill:#fce4ec
    style D3 fill:#fff3e0
    style D4 fill:#e0f2f1
    style L1 fill:#f3e5f5
```

## 8.5 Quality Gates

### Validator Quality Gates

```mermaid
graph LR
    D[Working Set Data] --> Q1[Duplicate Detection]
    D --> Q2[Conflicting Fields]
    D --> Q3[Malformed Parsing]
    D --> Q4[Weak Provenance]
    D --> Q5[Missing Metadata]
    D --> Q6[Incomplete Acquisition]

    Q1 --> C{Criteria Met?}
    Q2 --> C
    Q3 --> C
    Q4 --> C
    Q5 --> C
    Q6 --> C
    C -->|All Pass| P[PASS
    to Judge]
    C -->|Any Fail| F[FAIL
    send to Planner]

    style D fill:#e3f2fd
    style P fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style F fill:#ffebee,stroke:#c62828,stroke-width:2px
```

### Judge Quality Gates

```mermaid
graph LR
    D[Working Set] --> J1[Sufficiency vs
    Original Request]
    J1 --> J2[Source Coverage]
    J2 --> J3[Consistency of
    Conclusions]
    J3 --> J4[Output Readiness]
    J4 --> C{Judgment}
    C -->|Approved| A[APPROVED
    spawn specialist]
    C -->|Rejected| R[REJECTED
    gaps to Planner]

    style D fill:#e3f2fd
    style A fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style R fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
```

## 8.6 Session Root Object

```mermaid
graph LR
    subgraph "Session Root (v1)"
        S[SessionRootSchema] --> K[kind:
    "outlook-thread"]
        S --> T[threadId:
    email thread ID]
        S --> N[threadSubject:
    email subject]
        S --> M[mailbox:
    user@company.com]
    end

    style S fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
```

## 8.7 Model Routing Strategy

```mermaid
graph TB
    subgraph "Model Roles"
        F[umans-qwen3.6-35b-a3b
    Fast model] --> R1[Broad collection loops
    Operational passes
    Browser execution]
        R2[umans-kimi-k2.6
    Reasoning model] --> R3[Synthesis
    Hard judgments
    Planning]
        R3b[Claude Code / Codex] --> R4[Code tasks
    Output generation]
    end

    subgraph "Routing Layer"
        T[Task arrives] --> Q{Complexity?}
        Q -->|Fast pass| F
        Q -->|Deep reasoning| R2
        Q -->|Code task| R3b
    end

    style F fill:#e3f2fd
    style R2 fill:#fff3e0
    style R3b fill:#fce4ec
    style Q fill:#e8f5e9
```

## 8.8 Event-Sourced Architecture

```mermaid
graph TB
    subgraph "Event Log"
        E1[GoalDefined
    "Summarize Q1"]
        E2[PlanUpdated
    "Check Outlook + SharePoint"]
        E3[BrowserActionStarted
    "Navigate to SharePoint"]
        E4[BrowserActionCompleted
    "Downloaded report.docx"]
        E5[DocumentDiscovered
    "Found 3 similar docs"]
        E6[DocumentAcquired
    "Extracted text + tables"]
        E7[FieldExtracted
    "revenue: $120k"]
        E8[EntityResolved
    "Acme Corp (confirmed)"]
        E9[WorkingSetUpdated
    "12 docs, 8 entities"]
        E10[ValidationPassed
    "Zero duplicates found"]
        E11[JudgmentReturned
    "Sufficient (score: 0.92)"]
        E12[SpecialistSpawned
    "Financial Report Agent"]
        E13[SpecialistResultReceived
    "Q1_Summary.docx"]
        E14[OutputApproved
    "Ready for delivery"]
    end

    E1 --> E2 --> E3 --> E4 --> E5 --> E6 --> E7 --> E8 --> E9 --> E10 --> E11 --> E12 --> E13 --> E14

    style E1 fill:#e3f2fd
    style E11 fill:#fff3e0
    style E14 fill:#e8f5e9
    style E3 fill:#fce4ec
```

## 8.9 Persistent Knowledge

```mermaid
graph LR
    subgraph "Knowledge Scope"
        T[Tenant-Scoped
    Business Data] --> C1[Client profiles
    Recurring docs
    Entity relationships]
        S[Shared Patterns] --> C2[Document type recognition
    Traversal strategies
    Generic heuristics]
    end

    T ---|never cross| S

    style T fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style S fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
```

## 8.10 Session Data Model

```mermaid
graph TB
    subgraph "Orchestration Session"
        S[OrchestrationSession] --> ID[id]
        S --> W[workspaceId]
        S --> C[conversationId]
        S --> R[runId]
        S --> RT[root
    outlook-thread object]
        S --> SM[supervisionMode
    watch | confirm]
        S --> ST[status
    draft | running | waiting | completed | failed | cancelled]
        S --> CG[currentGoal
    string]
        S --> CS[completionSummary]
    end

    style S fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style ST fill:#fff3e0
    style CG fill:#e8f5e9
```

## 8.11 Provenance Scoring

```mermaid
graph LR
    subgraph "Provenance"
        D[Document
    in Working Set] --> S[Source URL
    where found]
        D --> A[Acquisition Event
    id + timestamp]
        D --> C[Confidence Score
    0-1]
        D --> R[Source Relevance
    to request]
    end

    S --> PS[provenanceScore
    composite metric]
    A --> PS
    C --> PS
    R --> PS
    PS --> J[Judge evaluates
    sufficiency]

    style D fill:#e3f2fd
    style PS fill:#fff3e0
    style J fill:#e8f5e9
```
