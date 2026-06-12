# 5. User Interface

## 5.1 Application Layout Diagram

```mermaid
graph TB
    subgraph "Carbon Agent Desktop"
        direction TB
        
        subgraph "Top Bar"
            TB[48px height
            Workspace Label / Provider Label / Status]
        end
        
        subgraph "Sidebar [200px]"
            SH[Sidebar Header<br/>Logo + "Carbon"]
            NG1[Nav Group: Core]
            ND1[--- divider ---]
            NG2[Nav Group: Data]
            ND2[--- divider ---]
            NG3[Nav Group: Config]
            ND3[--- divider ---]
            NG4[Nav Group: Cognitive]
            ND4[--- divider ---]
            NG5[Nav Group: Debug]
            SF[Sidebar Footer<br/>v0.1.0 badge + status dot]
        end
        
        subgraph "Main Content Area"
            PT[Page Title Bar<br/>h1: Current View]
            CS[Content Shell<br/>flex: 1]
        end
        
        subgraph "Right Panel"
            INS[Inspector Panel<br/>380px, slide-in]
        end
        
        subgraph "Floating Overlays"
            CMDK[Command Palette<br/>Ctrl+K modal]
            LV[Live Viewport<br/>Browser preview]
            RI[Run Inspector<br/>Modal popup]
            TC[Toast Container<br/>Auto-dismiss notifications]
        end
    end
    
    TB <-->|context| SH
    NG1 --> CS
    PT --> CS
    CS --> INS
    CS -.-> CMDK
    CS -.-> LV
    CS -.-> RI
    CS -.-> TC

    style SH fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style TB fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style CS fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    style INS fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    style CMDK fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    style NG1 fill:#e0f2f1
    style NG2 fill:#fff8e1
    style NG3 fill:#e3f2fd
    style NG4 fill:#fce4ec
    style NG5 fill:#f3e5f5
```

## 5.2 Navigation Structure

### Sidebar Groups (5 Groups, 15+ Views)

```mermaid
graph LR
    subgraph "Core"
        V1[▣ Playground]
        V2[○ Sessions]
        V3[▤ Knowledge Vault]
        V4[⏱ Watchers]
    end
    
    subgraph "Data"
        V5[▭ Workspaces]
        V6[⫯ Ingestion]
        V7[▶ Outputs]
    end
    
    subgraph "Config"
        V8[◯ AI Providers]
        V9[◬ Cloak Bridge]
    end
    
    subgraph "Cognitive"
        V10[◆ Learned Skills]
    end
    
    subgraph "Debug"
        V11[▣ Topology]
        V12[⊞ AXTree]
        V13[◎ Analytics]
    end
    
    style V1 fill:#e3f2fd
    style V2 fill:#fff3e0
    style V3 fill:#e8f5e9
    style V4 fill:#fce4ec
    style V8 fill:#e0f2f1
    style V9 fill:#fff8e1
    style V10 fill:#f3e5f5
    style V11 fill:#ffebee
```

### View Details

| # | View | File | Category | Purpose |
|---|------|------|----------|---------|
| 1 | **Playground** | `views/playground-view.ts` | Core | Chat interface with AI |
| 2 | **Sessions** | `views/session-view.ts` | Core | Orchestration session control |
| 3 | **Knowledge Vault** | `vault.ts` | Core | Note-taking with backlinks |
| 4 | **Watchers** | `views/watchers-view.ts` | Core | Scheduled task monitoring |
| 5 | **Workspaces** | `views/workspaces-view.ts` | Data | Manage isolation boundaries |
| 6 | **Ingestion** | `views/ingestion-view.ts` | Data | Document pipeline status |
| 7 | **Outputs** | `views/outputs-view.ts` | Data | Generated document viewer |
| 8 | **AI Providers** | `views/providers-view.ts` | Config | LLM provider settings |
| 9 | **Cloak Bridge** | `views/profiles-view.ts` | Config | Browser profile manager |
| 10 | **Learned Skills** | `views/skills-view.ts` | Cognitive | Reusable agent skills |
| 11 | **Topology** | `topology.ts` | Debug | Agent graph visualization |
| 12 | **AXTree** | `axtree.ts` | Debug | Accessibility tree inspector |
| 13 | **Analytics** | `watcher-analytics.ts` | Debug | Watcher run statistics |

## 5.3 View Router System

**File**: `apps/desktop/src/renderer/renderer.ts`

### Render Flow

```mermaid
graph LR
    A[User clicks nav item] --> B[setActiveView(name)]
    B --> C[Clear previous view]
    C --> D[Update nav active state]
    D --> E[Set page title]
    E --> F[Clear inspector]
    F --> G[Look up ViewModule
    in views Map]
    G --> H[Call view.render(container)]
    H --> I[Call view.onShow()]

    style A fill:#e3f2fd
    style B fill:#fff3e0
    style H fill:#e8f5e9
```

### ViewModule Interface

```typescript
type ViewModule = {
  render(container: HTMLElement): void;    // Build DOM
  onShow?: () => void;                     // Lifecycle: view becomes visible
  onHide?: () => void;                     // Lifecycle: view leaves
};
```

## 5.4 Command Palette

**Shortcut**: Ctrl+K / Cmd+K

```mermaid
graph LR
    A[Ctrl+K] --> B[Show Modal Backdrop]
    B --> C[Focus Search Input]
    C --> D[Type Query]
    D --> E[Filter 40+ items]
    E --> F[Arrow Navigation]
    F --> G[Enter to Execute]
    G --> H[Action fires]
    H --> I[Modal closes]
    
    style A fill:#e3f2fd
    style C fill:#fff3e0
    style G fill:#e8f5e9
```

### Palette Items

| Group | Action | Shortcut |
|-------|--------|----------|
| Navigation | Go to Playground | G P |
| Navigation | Go to Sessions | G E |
| Navigation | Go to AI Providers | G A |
| Navigation | Go to Cloak Bridge | G C |
| Navigation | Go to Workspaces | G W |
| Navigation | Go to Knowledge Vault | G V |
| Navigation | Go to Learned Skills | G S |
| Navigation | Go to Watchers | G T |
| Navigation | Go to Outputs | G O |
| Actions | Create Vault Note | N N |
| Actions | Switch Workspace | W W |
| Actions | Launch Browser Profile | L L |
| Actions | Clear Chat | K K |
| Actions | Open Settings | S S |

## 5.5 Inspector Panel

### Behavior

```mermaid
graph LR
    A[User selects item
    in main view] --> B[Open Inspector
    380px panel]
    B --> C[Show item details]
    C --> D[User clicks X]
    D --> E[Close inspector]

    style A fill:#e3f2fd
    style B fill:#fff3e0
    style C fill:#fce4ec
```

### Used In Views

| View | Inspector Content |
|------|-------------------|
| AI Providers | Provider config details |
| Workspaces | Workspace stats (docs, convos, skills, outputs) |
| Watchers | Watcher config + run history |
| Outputs | Document preview + actions |

## 5.6 Top Bar Circuit

```mermaid
graph LR
    subgraph "Top Bar"
        direction LR
        C[Context Area
        Workspace / Provider]
        S[Status Area
        Status Dot + "Idle"]
        A[Actions
        Quick Actions Button]
        N[Active Runs
        Count: 0]
    end

    style C fill:#e3f2fd
    style S fill:#fff3e0
    style A fill:#e8f5e9
    style N fill:#fce4ec
```

| Element | Source | Updates |
|---------|--------|---------|
| Workspace Label | First workspace loaded | On workspace switch |
| Provider Label | First provider loaded | On provider change |
| Status Dot | Run state | Every 5s polling |
| Active Runs | stats/list IPC | Every 5s polling |

## 5.7 Live Viewport

**Purpose**: Real-time browser session display during orchestration.

```mermaid
graph LR
    B[Chrome Browser] --> S[Screenshots
    via CDP]
    S --> M[Main Process]
    M --> E[Emit
    viewport-frame event]
    E --> R[Renderer
    onViewportFrame]
    R --> D[Display in
    Live Viewport Panel]

    style B fill:#e3f2fd
    style M fill:#fff3e0
    style D fill:#e8f5e9
```

## 5.8 Run Inspector Modal

**Purpose**: Detailed view of a specific agent run.

```mermaid
graph LR
    A[Click run in Sessions] --> B[Open Run Inspector Modal]
    B --> C[Load run events
    from JSONL]
    C --> D[Display:
    - Messages
    - Tool calls
    - Events timeline]
    D --> E[Close button
    or click backdrop]

    style A fill:#e3f2fd
    style B fill:#fff3e0
    style D fill:#e8f5e9
```

## 5.9 Screen-by-Screen Specifications

### 5.9.1 Playground View

**File**: `views/playground-view.ts`

```mermaid
graph TB
    subgraph "Playground"
        H[Session Header
        Workspace selector + Provider selector + New Chat]
        TC[Task Chips
        3 quick actions]
        CH[Chat Thread
        User / Assistant messages]
        IP[Input Panel
        Textarea + Send button]
    end

    H --> CH
    TC --> CH
    CH --> IP

    style H fill:#e3f2fd
    style TC fill:#fff3e0
    style CH fill:#e8f5e9
    style IP fill:#fce4ec
```

**Features**:
- Session header with workspace/provider selectors
- 3 suggested task chips ("Inspect a portal", "Ingest a file", "Draft a document")
- `<textarea>` for message input with send button
- Assistant responses styled with explainer blocks
- Empty state with onboarding guidance

### 5.9.2 Knowledge Vault View

**File**: `vault.ts`

```mermaid
graph TB
    subgraph "Knowledge Vault"
        FT[File Tree
        Hierarchical navigator + Search]
        ED[Editor Panel
        Markdown editor]
        PR[Preview Panel
        Rendered output]
        DL[Detail Panel
        Outgoing Links / Backlinks / Mentions]
    end

    FT --> ED
    FT --> PR
    ED --> DL
    PR --> DL

    style FT fill:#e3f2fd
    style ED fill:#fff3e0
    style PR fill:#e8f5e9
    style DL fill:#fce4ec
```

**Features**:
- File tree with hierarchical markdown file listing
- Search input (`#vault-search`)
- Split-pane editor + preview (WYSIWYG)
- Outgoing Links panel (links FROM current note)
- Backlinks panel (links TO current note)
- Mentions panel (contextual references)

### 5.9.3 AI Providers View

**File**: `views/providers-view.ts`

```mermaid
graph TB
    subgraph "AI Providers"
        L[List Column
        Provider cards with status]
        I[Inspector Panel
        Detail form / Create form]
    end

    L --> I

    style L fill:#e3f2fd
    style I fill:#fff3e0
```

**Features**:
- Two-column layout (list left, detail inspector right)
- Preset provider grid (Anthropic, OpenAI, Custom)
- Connection health indicator in cards
- API key field with masked input (dots)
- Model selector dropdown
- Test connection button

### 5.9.4 Cloak Bridge (Profiles) View

**File**: `views/profiles-view.ts`

```mermaid
graph TB
    subgraph "Cloak Bridge"
        EB[Explainer Block
        "What is CloakBridge?"]
        PL[Profile List
        Cards with status]
        CA[Create Actions
        Add profile button]
    end

    EB --> PL
    EB --> CA

    style EB fill:#e3f2fd
    style PL fill:#fff3e0
    style CA fill:#e8f5e9
```

**Features**:
- Explainer block describing CloakBridge purpose
- Profile cards with status badges (active/expired/locked)
- Target domains list per profile
- Last checked timestamp
- Actions: Launch Login, Lock, Unlock, Delete
- Create profile form (name, profileDir, cdpUrl, targetDomains)

### 5.9.5 Ingestion View

**File**: `views/ingestion-view.ts`

```mermaid
graph TB
    subgraph "Ingestion"
        WP[Watched Path
        Folder location display]
        PL[Pipeline Status
        Detected → Parsed → Embedded → Graph Extract]
        FL[File List
        Real filenames, sizes, types]
    end

    WP --> PL
    PL --> FL

    style WP fill:#e3f2fd
    style PL fill:#fff3e0
    style FL fill:#e8f5e9
```

**Features**:
- Watched folder path display
- Pipeline phase indicators (4 steps with status)
- File list with real filenames (not UUIDs)
- File size, MIME type, and status badges
- Retry failed jobs button

### 5.9.6 Watchers View

**File**: `views/watchers-view.ts`

```mermaid
graph TB
    subgraph "Watchers"
        MS[Mission Summary Card
        Total / Healthy / Failed counts]
        WL[Watcher Cards
        Operational status badges]
        QA[Quick Actions
        Run Now, Toggle, View History]
    end

    MS --> WL
    WL --> QA

    style MS fill:#e3f2fd
    style WL fill:#fff3e0
    style QA fill:#e8f5e9
```

**Features**:
- Mission summary card (total, healthy, failed counts)
- Watcher cards with status badges:
  - 🟢 Healthy | Last run succeeded
  - 🔴 Failed | Last run failed
  - 🟡 Paused | Currently not running
  - 🟠 Running | Active execution
  - ⚪ Never Run | Not yet executed
- Quick actions: Run Now, Toggle on/off, View Logs
- Cron expression display (converted to human-readable text)
- Inspector panel for detail editing

### 5.9.7 Outputs View

**File**: `views/outputs-view.ts`

```mermaid
graph TB
    subgraph "Outputs"
        FB[Filter Bar
    MD / DOCX / PDF buttons]
        OG[Output Grid
        Shelf cards layout]
        CA[Card Actions
    Open / Reveal / Copy Path]
    end

    FB --> OG
    OG --> CA

    style FB fill:#e3f2fd
    style OG fill:#fff3e0
    style CA fill:#e8f5e9
```

**Features**:
- Filter buttons by format (MD, DOCX, PDF)
- Shelf card layout
- Format badges per card
- Creation date, preview snippet
- Quick actions: Open, Reveal in folder, Copy path

### 5.9.8 Learned Skills View

**File**: `views/skills-view.ts`

```mermaid
graph TB
    subgraph "Learned Skills"
        SL[Skill Cards
        Playbook-style layout]
        SM[Success Metrics
        Rate + usage stats]
        CA[Capability Summary
        Human-readable description]
    end

    SL --> SM
    SL --> CA

    style SL fill:#e3f2fd
    style SM fill:#fff3e0
    style CA fill:#e8f5e9
```

**Features**:
- Skill cards with playbook-style layout
- Success rate metrics with color coding
- Execution count (success/failure)
- Tool sequence display
- Pin/unpin for quick access
- Human-readable capability summaries

## 5.10 Design System

### 5.10.1 Typography Scale

| Token | Size | Usage |
|-------|------|-------|
| `--font-xs` | 11px | Metadata, badges, timestamps |
| `--font-sm` | 12px | Labels, secondary text |
| `--font-base` | 14px | Body text, primary content |
| `--font-lg` | 17px | Section titles |
| `--font-xl` | 20px | Page titles |

### 5.10.2 Icon System

All icons rendered via CSS pseudo-elements. **Zero Unicode symbols** in source files.

```mermaid
graph LR
    HTML[HTML Element<br/>class="icon-playground"] --> CSS[CSS ::before<br/>content: "●"]
    CSS --> RENDER[Rendered Icon]
    
    style HTML fill:#e3f2fd
    style CSS fill:#fff3e0
    style RENDER fill:#e8f5e9
```

### 5.10.3 Status Colors

| Status | Color | Usage |
|--------|-------|-------|
| Success | Green | Health OK, completed |
| Danger | Red | Failed, expired |
| Warning | Yellow | Paused, caution |
| Info | Blue | Running, in-progress |
| Neutral | Gray | Idle, unknown |

### 5.10.4 Zero Inline Styles Policy

```mermaid
graph LR
    A[Before] --> B[HTML style="margin-left:auto"]
    B --> C[CSS .status-dot-sm]
    C --> D[After]
    D --> E[CSS class only]
    
    style A fill:#ffebee
    style D fill:#e8f5e9
```

| Metric | Value |
|--------|-------|
| Inline styles in renderer.ts | 0 |
| Inline styles in index.html | 0 |
| CSS-driven icon classes | 19 |
| Empty state icon classes | 15 |
