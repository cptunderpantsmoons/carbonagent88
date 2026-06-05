# Carbon Agent Browser Orchestration PoC Design

**Date:** 2026-06-06

**Status:** Draft for review

## Goal

Build a browser-native orchestration system that starts from an Outlook email thread, autonomously collects relevant information from authenticated browser sessions across Outlook, SharePoint, Monday, Xero, and browser-based spreadsheets, assembles a structured working set with provenance, and hands high-quality data to existing output specialists for statements, dashboards, presentations, and related deliverables.

This PoC is optimized for effectiveness and reuse, not production hardening. It should feel autonomous once the user has logged into the relevant systems, while preserving enough structure to support auditability, replay, and later ecosystem reuse.

## Product Scope

### In scope

- Outlook email thread as the primary entry point for a user job
- Browser-only access to third-party systems using normal user credentials
- Autonomous collection after user authentication
- Broad exploratory collection beyond explicit attachments and links
- Persistent core agents that gather, validate, judge, and coordinate work
- Ephemeral specialist agents, including Claude Code and Codex, for output-specific tasks
- Structured working set and persistent memory to improve cross-run effectiveness
- Existing output capabilities for financial statements and interactive dashboards, with room for presentations, forecasts, and related business artifacts

### Out of scope for this PoC

- Production-grade access controls, policy engines, and strict agent isolation
- Non-browser computer-use or hardware orchestration inside this repo
- API-first integrations as a requirement for any target system
- Final enterprise hardening for governance, multi-tenant isolation, or deployment operations

## User Experience

1. The user authenticates browser sessions for the relevant systems.
2. The user gives Carbon Agent a request anchored to an Outlook email thread.
3. The system autonomously explores related content across the authenticated browser sessions.
4. The system loops until the validator and judge agents consider the collected data sufficient.
5. The system invokes the right output specialist or sub-agent.
6. The resulting artifact or executed task is returned to the main assistant and then delivered to the user or sent onward through an approved channel.

For the PoC, authentication is the trust handshake. After login, runtime supervision is a mode choice:

- `Watch mode`: the user watches the live session while the system runs autonomously.
- `Confirm mode`: the system pauses at chosen checkpoints even though sessions are already authenticated.

## Core Architectural Position

Carbon Agent should be treated as a browser-native collection orchestrator and evidence assembly system, not primarily as a chat interface with tools.

The system should be built around reusable abstractions that can later support adjacent products, but the current repo remains focused on the browser collection PoC. Hardware endpoints, smart glasses, and air-gapped physical execution systems are treated as future consumers of the same architecture, not current scope.

The architecture should optimize for:

- autonomous multi-source collection
- structured replay and downstream automation
- strong provenance
- reusable agent boundaries
- enough flexibility for iterative loops and specialist spawning

## Persistent Core Agents

The PoC uses persistent core agents with durable roles and durable state:

### 1. Main Assistant

- Owns the user-facing conversation
- Accepts the request and session context
- Chooses when to spawn specialist agents
- Receives the final judged result and returns it to the user

### 2. Goals Agent

- Turns the user request into explicit goals and success criteria
- Maintains the current objective and sub-objective priorities
- Decides what “done” means at the goal level

### 3. Planner Agent

- Builds the collection strategy
- Chooses the next source, query, or traversal step
- Revises the strategy when the judge reports gaps

### 4. Browser Execution Agent

- Operates the live authenticated browser sessions
- Navigates sources, downloads artifacts, extracts visible information, and reports structured results
- Is optimized for operational effectiveness rather than deep synthesis

### 5. Knowledge Graph Agent

- Normalizes collected data into entities, documents, relationships, metrics, and provenance
- Maintains the current working set
- Updates persistent memory and reusable patterns

### 6. Validator Agent

- Checks extraction quality and internal consistency
- Flags duplicates, conflicts, weak evidence, and malformed results
- Rejects low-quality data before it pollutes the working set

### 7. Judge Agent

- Decides whether the current working set satisfies the original request
- Identifies concrete missing evidence or unresolved ambiguity
- Approves final output before it becomes user-visible or triggers an external action

## Ephemeral Specialist Agents

The main assistant may spawn temporary specialists as needed. These are disposable workers with narrow responsibilities. Examples include:

- spreadsheet analysis
- PDF or Word document analysis
- financial statement generation
- dashboard generation
- presentation generation
- forecast modeling
- Claude Code sub-agents
- Codex sub-agents

Specialists do not own the system memory or completion logic. They consume high-quality inputs and return their outputs through the validator and judge flow.

## Operating Model

The PoC should allow high intuition and iterative looping inside agents. It should not over-constrain their reasoning style while the system is still proving product value.

The hard constraints belong at the system level:

- all meaningful work emits structured events
- validators and judges enforce quality gates
- outputs must re-enter the system through validation and judgment
- the system keeps looping until judged sufficient or explicitly stopped

In short: let agents think freely, but force the system to remember and justify structurally.

## Execution Flow

1. Main assistant receives the user request, anchored to an Outlook email thread.
2. Goals agent converts the request into explicit success criteria and an initial end state.
3. Planner agent builds a browser-native exploration and collection plan.
4. Browser execution agent traverses Outlook, SharePoint, Monday, Xero, and browser-based spreadsheets using the authenticated sessions.
5. Knowledge graph agent transforms findings into a structured working set.
6. Validator agent checks quality, resolves obvious defects, and blocks weak or conflicting data.
7. Judge agent evaluates sufficiency against the original request.
8. If data is insufficient, the planner receives specific gaps and the loop continues.
9. Once the working set is sufficient, the main assistant spawns the appropriate specialist or sub-agent.
10. Specialist outputs flow back through validator and judge checks.
11. Approved results are returned to the main assistant for user delivery or approved downstream execution.

Looping is expected behavior. The system should keep refining until the judges are satisfied or the user stops the run.

## Session Root and Collection Strategy

The primary v1 root object is the Outlook email thread.

From the thread, the system should expand broadly and exploratorily rather than staying tightly scripted. It may use:

- attachments
- links
- participants
- client or project names
- dates
- financial references
- recurring document patterns
- previously learned organization-specific structures

The collection bias is intentionally broad. The system should build a rich working set rather than stopping at the minimum visible trail.

To keep that exploration useful, the design must include:

- exploration budgets
- confidence thresholds
- source relevance ranking
- provenance scoring
- loop termination signals from judges

## Data Model

The reusable core should be event-sourced first. Human-readable case views, reports, and dashboards are derived from the event history and the normalized working set.

### Primary records

#### Session

Represents one user job and its runtime context, including root email thread, authenticated sources, mode, and lifecycle state.

#### SessionEvent

Append-only structured event record for planning, browsing, extraction, validation, judgment, specialist handoff, and delivery.

#### WorkingSet

Current normalized state for the session, including documents, extracted fields, entities, metrics, relationships, hypotheses, and provenance.

#### EvidenceRecord

Immutable evidence artifact linked to its source, acquisition event, and interpretation context.

#### PersistentKnowledge

Cross-session memory about clients, recurring document types, common traversal patterns, prior discoveries, and useful relationships.

For the PoC, persistent knowledge should be scoped primarily per client or tenant to avoid cross-organization data bleed. A smaller shared pattern layer may exist for generic workflow heuristics, document-type recognition, and source traversal strategies, but business data, entities, and evidence-derived knowledge must remain tenant-scoped.

### Recommended event families

- `GoalDefined`
- `PlanUpdated`
- `BrowserActionStarted`
- `BrowserActionCompleted`
- `DocumentDiscovered`
- `DocumentAcquired`
- `ObservationCaptured`
- `FieldExtracted`
- `EntityResolved`
- `WorkingSetUpdated`
- `ValidationPassed`
- `ValidationFailed`
- `JudgmentRequested`
- `JudgmentReturned`
- `SpecialistSpawned`
- `SpecialistResultReceived`
- `OutputApproved`
- `OutputRejected`
- `DeliveryRequested`
- `DeliveryCompleted`

These names are illustrative, but the system should preserve the distinction between intent, execution, evidence, validation, and judgment.

## Model and Routing Strategy

The system should assume multiple AI models from the start.

Known current model roles:

- `umans-qwen3.6-35b-a3b` as the high-speed model for broad collection loops and operational passes
- `umans-kimi-k2.6` as the stronger reasoning model for higher-value synthesis and harder judgments
- Claude Code and Codex as specialist execution surfaces for output and task-specific work

The design should therefore include a model-routing layer that can choose:

- which model handles which role
- when to escalate from fast to intelligent reasoning
- when to invoke an external specialist or sub-agent
- how to preserve shared session state across model boundaries

The PoC does not need a perfect optimizer. It needs clear routing semantics and the ability to improve later.

## Quality Gates

Quality enforcement should focus on two system checkpoints:

### Validator quality gates

- duplicate detection
- conflicting extracted fields
- malformed document parsing
- weak provenance
- missing metadata
- clearly incomplete acquisition

### Judge quality gates

- sufficiency relative to original request
- coverage across relevant sources
- consistency of conclusions with evidence
- readiness of the final output for user consumption or delivery
- explicit rationale for completion versus continued looping

The judges should be the durable gate that makes the PoC feel like magic without becoming arbitrary.

## Deliverable Boundary

The system is not trying to invent outputs from thin air. It is trying to produce or support existing high-value deliverables using better collected and validated data.

The current deliverable boundary is:

- data collection and correlation are first-class platform concerns
- artifact generation is downstream and may reuse existing skills
- all outputs still return through validator and judge checks before release

This keeps the implementation centered on the actual product gap: gathering high-quality data from multiple browser-native enterprise systems without API integration work.

## Testing Strategy

The implementation plan should emphasize proof of behavior rather than broad infrastructure hardening.

Minimum testing themes:

- session creation and lifecycle for email-thread-rooted jobs
- agent-to-agent contract integrity
- browser collection event generation
- working set and provenance updates
- validator and judge loop behavior
- specialist handoff and result return flow
- model-routing decisions at the contract level

For the PoC, reliable event trails and reproducible working set updates are more important than strict production-grade enforcement policies.

## Non-Goals for the First Plan

The first implementation plan should avoid:

- solving hardware orchestration in this repo
- solving final production governance
- solving every future source type
- over-building a universal knowledge graph platform
- forcing airtight inter-agent restrictions before the PoC proves value

The right first plan is the smallest architecture that makes autonomous multi-source browser collection, validation, judgment, and specialist handoff work end to end.
