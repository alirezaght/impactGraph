ImpactGraph

Product Requirements and Technical Specification

Status: Initial specification
Product type: VS Code extension with a local analysis engine and CLI
Working name: ImpactGraph
Primary platform: Visual Studio Code
Primary integration model: AI-agnostic, compatible with Claude Code, Cursor, MCP-enabled agents, and other coding assistants

⸻

1. Product Summary

ImpactGraph is a local-first VS Code extension that converts a proposed software specification into an evidence-backed architectural impact model.

The user provides a specification before implementation. ImpactGraph analyzes the current repository and creates an interactive impact graph showing which parts of the system are likely to change.

After implementation, the user or coding agent runs a review command. ImpactGraph compares the original predicted impact against the actual Git diff and reports:

- Predicted components that were changed
- Predicted components that were not changed
- Unexpected components that changed
- Architectural relationships introduced or removed
- Requirements that appear unimplemented
- Implementation changes that were not covered by the specification
- Potential architectural drift
- Areas requiring human review

ImpactGraph does not implement the feature itself. It provides structured architectural context to the human and the coding agent before and after implementation.

⸻

2. Product Vision

AI coding tools are increasingly capable of generating code from specifications, but they usually reason locally.

They may successfully modify the obvious files while missing:

- Indirect dependencies
- Background jobs
- Event consumers
- Infrastructure configuration
- Database migrations
- Read models
- Authorization rules
- Tests
- Observability
- Deployment implications
- Cross-context business rules

ImpactGraph introduces an explicit architectural review layer between specification and implementation.

The intended workflow is:

Task or ticket
↓
Human and AI brainstorm
↓
Clarified specification
↓
ImpactGraph analysis
↓
Human reviews and modifies impact model
↓
Specification is updated if needed
↓
ImpactGraph analysis is approved
↓
Coding agent implements the feature
↓
ImpactGraph reviews the implementation
↓
Human or AI resolves discrepancies

⸻

3. Core Product Principle

ImpactGraph must distinguish between:

1. Deterministically discovered facts
2. AI-inferred architectural interpretations
3. Human-confirmed architectural knowledge

These categories must never be visually or semantically mixed.

Example:

FACT
DealService imports DealRepository.
INFERENCE
The new visibility rule may affect DealSearchIndexer.
CONFIRMED
The user confirmed that DealSearchIndexer belongs to the Search context.

Every inferred impact must include evidence, confidence, and a dependency path where possible.

ImpactGraph must never present unsupported AI reasoning as a repository fact.

⸻

4. Target Users

4.1 Individual developer

An individual developer using:

- Claude Code
- Cursor
- GitHub Copilot
- Another coding agent
- Manual coding workflows

Primary need:

Understand what a feature is likely to affect before asking an agent to implement it.

4.2 Tech lead

A tech lead reviewing:

- Product specifications
- Technical designs
- Merge requests
- Pull requests
- AI-generated implementation plans
- Cross-system architectural changes

Primary need:

Verify that the specification and implementation account for the full architectural impact.

⸻

5. Primary Use Cases

5.1 Pre-implementation impact analysis

The user provides a specification and asks ImpactGraph to identify likely architectural changes.

5.2 Specification refinement

The user reviews the impact graph and discovers:

- Missing requirements
- Ambiguous rules
- Hidden dependencies
- Incorrect assumptions
- Unnecessary architectural changes

The user then modifies the specification and regenerates the graph.

5.3 Agent-assisted planning

Claude Code, Cursor, or another agent retrieves an approved specification and impact analysis before implementation.

5.4 Post-implementation review

ImpactGraph compares the implementation with the approved pre-implementation analysis.

5.5 Merge request review

A tech lead uses ImpactGraph to understand whether the merge request matches the approved specification and expected architecture.

5.6 Architectural discovery

The extension automatically builds an initial architectural model of an unfamiliar repository.

5.7 Human correction

The user corrects discovered contexts, components, ownership, labels, or relationships. Confirmed corrections become persistent project knowledge.

⸻

6. Product Scope

6.1 Supported languages

The architecture must support language-specific adapters.

Initial target languages:

- TypeScript
- JavaScript
- Python
- Java
- HTML
- Astro

Node.js is considered a runtime and ecosystem rather than a separate language.

The first implementation may deliver language support incrementally, but the core graph and plugin architecture must not be TypeScript-specific.

6.2 Supported frameworks and platforms

Initial high-priority support:

- NestJS
- Express
- FastAPI
- Astro
- GCP
- Cloud Run
- GCP Pub/Sub
- Terraform

Additional generic support should include:

- REST APIs
- Database migrations
- Environment configuration
- Scheduled jobs
- Message producers
- Message consumers
- Tests
- Docker files
- CI configuration where practical

6.3 Repository scope

The extension must support:

- Single repositories
- Monorepos
- Multiple applications in one workspace
- Application code
- Infrastructure code
- Database migrations
- Shared packages
- Tests

Cross-repository architecture is outside the MVP but must remain possible in the data model.

⸻

7. Non-Goals for the MVP

The initial product will not:

- Automatically implement features
- Replace coding agents
- Guarantee complete architectural correctness
- Support every programming language
- Require formal DDD
- Require a hosted backend
- Automatically modify specifications without user approval
- Automatically approve implementation quality
- Act as a general-purpose UML editor
- Replace code review
- Build a fully accurate runtime call graph
- Upload entire repositories by default
- Require a specific AI model
- Depend on Claude-specific APIs
- Enforce one software architecture style
- Automatically infer all business rules correctly

⸻

8. AI-Agnostic Design

ImpactGraph must not depend on one AI provider.

The extension should expose structured commands and tools that can be used by:

- Claude Code
- Cursor
- GitHub Copilot
- OpenAI-compatible agents
- Local models
- MCP-enabled tools
- Human users

The system must define an internal provider interface.

Example:

interface ModelProvider {
generateStructuredOutput<T>(
request: ModelRequest,
schema: JsonSchema
): Promise<ModelResponse<T>>;
}

Supported provider strategies may include:

- External agent invokes ImpactGraph tools
- User-configured API provider
- Local model endpoint
- No AI provider, using deterministic analysis only

ImpactGraph must remain useful without direct model integration, though requirement interpretation will be limited.

⸻

9. Privacy Model

Privacy must be configurable per workspace.

Supported modes:

9.1 Local only

No source code or repository metadata leaves the machine.

Only deterministic local analysis is available unless the user configures a local model.

9.2 Selected snippets

Default mode.

Only the minimum evidence required for a specific analysis may be sent to the configured model.

Examples:

- Relevant symbols
- Function signatures
- Selected source ranges
- Architecture metadata
- Specification text
- Dependency paths

9.3 Full-context mode

The user explicitly permits larger source sections to be sent to the configured provider.

9.4 External-agent mode

ImpactGraph itself sends nothing externally. An external agent such as Claude Code invokes ImpactGraph and decides how to use the returned information.

The current privacy mode must be visible in the UI.

ImpactGraph must not silently change privacy modes.

⸻

10. End-to-End User Workflow

10.1 Repository initialization

1. User opens a repository in VS Code.
2. ImpactGraph detects whether the project is initialized.
3. User runs ImpactGraph: Initialize Workspace.
4. ImpactGraph detects:
   - Languages
   - Frameworks
   - Packages
   - Applications
   - Infrastructure
   - Tests
   - Migrations
5. ImpactGraph creates an initial architecture model.
6. The user reviews high-level detected components.
7. The user may correct the model.
8. Approved corrections are written to version-controlled configuration.

10.2 Specification creation

The specification can originate from:

- Pasted text
- Selected editor text
- Current Markdown document
- External AI agent
- Jira ticket retrieved by an AI agent through Jira MCP
- Another MCP-integrated task system

ImpactGraph does not need to implement Jira integration directly in the MVP.

Instead, an external agent may:

1. Retrieve a ticket.
2. Brainstorm with the user.
3. Clarify missing details.
4. Create a specification.
5. Send the specification to ImpactGraph.

10.3 Impact analysis

1. User opens the ImpactGraph specification panel.
2. User enters or imports the specification.
3. User runs analysis.
4. ImpactGraph extracts:
   - Requirements
   - Actors
   - Rules
   - Exceptions
   - State changes
   - Constraints
   - Non-functional requirements
   - Open questions
5. ImpactGraph maps concepts to repository components.
6. ImpactGraph generates candidate impacts.
7. The user reviews the impact tree or graph.
8. The user accepts, rejects, edits, or adds impacts.
9. The user updates the specification when necessary.
10. ImpactGraph regenerates the analysis.
11. User approves a specific analysis version.

10.4 Implementation

The approved analysis can be exported for a coding agent.

The export must include:

- Final specification
- Approved impact nodes
- Relevant evidence
- Constraints
- Architectural decisions
- Expected files or components
- Required tests
- Open warnings
- Explicitly rejected impacts
- Review criteria

10.5 Review

After implementation:

1. User runs ImpactGraph: Review Implementation.
2. ImpactGraph compares the approved analysis snapshot against:
   - Current working tree
   - Current commit
   - Optional selected Git range in later versions
3. ImpactGraph reports:
   - Matched expected changes
   - Missing expected changes
   - Unexpected changes
   - New dependencies
   - Removed dependencies
   - Requirement coverage
   - Potential architectural violations
4. The user or AI investigates discrepancies.
5. The review can be exported as Markdown or JSON.

⸻

11. Specification Model

A specification must have a stable internal representation.

interface Specification {
id: string;
title: string;
sourceType: "pasted" | "selection" | "markdown" | "agent" | "external";
sourceReference?: string;
rawText: string;
version: number;
createdAt: string;
updatedAt: string;
requirements: Requirement[];
actors: Actor[];
constraints: Constraint[];
openQuestions: OpenQuestion[];
decisions: ArchitecturalDecision[];
}

11.1 Requirement

interface Requirement {
id: string;
statement: string;
type:
| "functional"
| "business-rule"
| "exception"
| "state-transition"
| "data"
| "integration"
| "security"
| "performance"
| "operational"
| "observability"
| "testing"
| "documentation";
concepts: string[];
actors: string[];
priority?: "must" | "should" | "could";
sourceRange?: TextRange;
status: "draft" | "confirmed" | "rejected";
}

11.2 Open question

interface OpenQuestion {
id: string;
question: string;
reason: string;
affectedRequirementIds: string[];
severity: "blocking" | "important" | "minor";
status: "open" | "answered" | "dismissed";
answer?: string;
}

⸻

12. Architecture Graph Model

12.1 Node categories

Intent nodes

- Specification
- Requirement
- Constraint
- Actor
- Business rule
- Open question
- Architectural decision

Domain nodes

- Domain
- Bounded context
- Aggregate
- Entity
- Value object
- Policy
- Invariant
- Command
- Query
- Domain event

Application nodes

- Application
- Service
- Module
- Package
- Class
- Interface
- Function
- Method
- API endpoint
- Controller
- Handler
- Job
- CLI command
- UI component
- Page
- Form
- Test

Data nodes

- Database
- Schema
- Table
- Collection
- Column
- Index
- Migration
- Cache
- Search index

Integration nodes

- Topic
- Queue
- Subscription
- Publisher
- Consumer
- Webhook
- External API
- Third-party service

Infrastructure nodes

- Terraform module
- Terraform resource
- Cloud Run service
- Cloud Run job
- GCP project
- Pub/Sub topic
- Pub/Sub subscription
- Service account
- IAM role
- Secret
- Environment variable
- Docker image
- Deployment pipeline

Repository nodes

- Repository
- Workspace
- Package
- Directory
- File
- Symbol

12.2 Edge types

- CONTAINS
- IMPORTS
- CALLS
- IMPLEMENTS
- EXTENDS
- READS_FROM
- WRITES_TO
- PUBLISHES
- SUBSCRIBES_TO
- TRIGGERS
- DEPLOYED_AS
- CONFIGURES
- OWNS
- BELONGS_TO_CONTEXT
- VALIDATES
- ENFORCES
- TESTS
- MIGRATES
- EXPOSES
- USES
- DEPENDS_ON
- AFFECTS
- MAY_AFFECT
- CONTRADICTS
- SATISFIES
- REQUIRES
- DOCUMENTS
- GENERATED_FROM

12.2.1 Edge-type addendum (relationship split)

USES was found to carry at least seven unrelated facts — constructor injection, Spring DI, Express
middleware and route wiring, page-to-route references, template calls, Terraform resource
references. It also appeared to serve as the fallback when an adapter cannot classify a binding,
though those fallback paths turned out to be unreachable (see
docs/engineering/capability-limitations.md). Any traversal,
confidence, or propagation rule attached to it is therefore wrong for some producers, and a type
annotation propagated exactly like a runtime registry binding.

The roster gains the following. Direction is normative: an edge of this type always points the
stated way, whatever the producer, so a propagation rule can stay local and meaningful.

- INJECTS — consumer → injected dependency. The SOURCE receives the dependency; the TARGET is the
  thing supplied. Covers constructor injection and framework DI containers.
- NAVIGATES_TO — referrer → the route or page it navigates to. Produced from `<a href>` and
  `<area href>`, attributes that name somewhere to GO.
- SUBMITS_TO — form → the route it submits to. Produced from `<form action>`, and the form's
  `method` attribute is observed when stated. Separate from NAVIGATES_TO because a submission and a
  link are obliged by different changes: a verb change reaches a form and not a link.
- CALLS_ENDPOINT — client code → the HTTP endpoint it calls. Produced from a `fetch` to a
  same-origin literal path. Distinct from CALLS, which names a callable SYMBOL; this crosses a
  network boundary and its target is a route contract.

  ROUTES_TO was the first attempt at all three and is withdrawn: it fused a navigation link, a form
  submission and a programmatic call, and the attribute that distinguishes them is something the
  producers already read (see docs/engineering/route-evidence-audit.md). One type could not carry
  three different obligations.

- USES_MIDDLEWARE — attaching application or router → the middleware it attaches. Named for its
  direction: every dependency-shaped edge in this roster points consumer → dependency, as IMPORTS
  and INJECTS do, so a propagation rule need not ask which way a given producer wired it.
- REFERENCES_RESOURCE — referencing declaration → referenced infrastructure resource. Today the only
  producer is the Terraform secret reference, which is narrower than the name suggests. Interpolation,
  explicit depends_on, module output references and provider references are NOT currently conflated
  into it — the scanner records those as facts rather than edges — so if they later become edges they
  should be judged separately before reusing this type, because they may not share its propagation
  semantics.
- BINDS — component → messaging endpoint where the association is known but no publish or subscribe
  behaviour is established. RESERVED, with no current producer: every pub/sub adapter already
  resolves a topic handle to PUBLISHES and a subscription handle to SUBSCRIBES_TO, so nothing needs
  the weaker form yet. Retained deliberately rather than removed, so an adapter that later reads a
  registration without runtime direction has somewhere truthful to put it.
- USES_UNKNOWN — the honest name for an unclassified relationship. An adapter that cannot determine
  what a binding means emits this rather than a generic USES, so uncertainty is visible instead of
  disguised as a relationship. Its semantics are fixed and deliberately weak: traversable, may
  contribute at most a `possible` tier, never corroborates another signal, contributes no positive
  confidence, and is described as uncertain in explanations. Two USES_UNKNOWN edges are two
  unknowns, not strong evidence; USES_UNKNOWN combined with CONTAINS is not corroboration either.

USES is retained in the roster for edges no producer has yet migrated. It is not a target for new
producers: a new relationship that does not fit an existing type is either a named addition to this
roster or USES_UNKNOWN.

12.3 Evidence classification

Every node and edge must have a provenance type:

type Provenance =
| "static-analysis"
| "configuration"
| "human-confirmed"
| "llm-inferred"
| "git-history"
| "framework-convention"
| "runtime-observation";

Runtime observation is reserved for future support.

⸻

13. Impact Model

interface ImpactAnalysis {
id: string;
specificationId: string;
specificationVersion: number;
repositorySnapshotId: string;
createdAt: string;
status: "draft" | "reviewed" | "approved" | "superseded";
requirementImpacts: RequirementImpact[];
architecturalOptions: ArchitecturalOption[];
warnings: AnalysisWarning[];
userDecisions: UserImpactDecision[];
}

13.1 Requirement impact

interface RequirementImpact {
requirementId: string;
nodeId: string;
likelihood: "required" | "likely" | "possible" | "unlikely";
impactType:
| "domain-model"
| "business-rule"
| "api-contract"
| "data-model"
| "migration"
| "event-contract"
| "read-model"
| "background-processing"
| "integration"
| "security"
| "observability"
| "performance"
| "infrastructure"
| "deployment"
| "testing"
| "documentation";
directness: "direct" | "indirect";
confidence: number;
explanation: string;
expectedChanges: string[];
evidenceIds: string[];
dependencyPath: string[];
provenance: Provenance;
}

⸻

14. Confidence Model

The confidence score must not be generated only by asking an LLM for a number.

It should be calculated using weighted signals.

Potential signals:

- Exact concept-to-symbol match
- Semantic concept match
- Direct import
- Direct function call
- Direct data access
- API ownership
- Event relationship
- Shared bounded context
- Framework convention
- Historical co-change
- Test association
- Documentation match
- Human-confirmed mapping
- Graph distance
- Ambiguity
- Conflicting evidence
- Unsupported inference

Example:

Confidence: 0.88
Contributing signals:

- Exact match with DealVisibilityPolicy
- Direct dependency from DealQueryService
- Confirmed Search context ownership

* One indirect event boundary

The UI must expose why a confidence score exists.

⸻

15. Automatic Architecture Discovery

ImpactGraph must discover an initial model automatically.

15.1 Generic discovery

The engine should identify:

- Workspaces
- Packages
- Source roots
- Test roots
- Build configuration
- Entry points
- Imports
- Symbols
- Routes
- Data models
- Migrations
- Jobs
- Environment configuration
- Infrastructure files

15.2 Framework detection

NestJS

Detect:

- Modules
- Controllers
- Providers
- Services
- Guards
- Interceptors
- Pipes
- Event handlers
- Scheduled jobs
- Dependency injection relationships
- Routes

Express

Detect:

- Router definitions
- Middleware
- Route handlers
- Application entry points
- Imported service dependencies

FastAPI

Detect:

- Routers
- Endpoints
- Dependencies
- Pydantic models
- Background tasks
- Middleware
- Service modules

Astro

Detect:

- Pages
- Layouts
- Components
- API routes
- Content collections
- Server-side actions where supported
- Imported client components

Terraform

Detect:

- Modules
- Resources
- Data sources
- Variables
- Outputs
- Provider usage
- Resource references
- Cloud Run services and jobs
- Pub/Sub resources
- IAM resources
- Secrets and environment bindings

GCP and Cloud Run

Detect configuration and references for:

- Cloud Run services
- Cloud Run jobs
- Pub/Sub topics
- Pub/Sub subscriptions
- Service accounts
- IAM bindings
- Secret Manager references
- Artifact Registry images
- Scheduled triggers where represented in code or Terraform

15.3 Architecture inference

ImpactGraph may infer:

- Potential contexts
- Module roles
- Service boundaries
- Domain-heavy modules
- Infrastructure layers
- Shared libraries
- Circular dependencies
- High-coupling components

All automatic architectural inference must be labeled as inferred until confirmed.

⸻

16. Human Correction Model

Users must be able to:

- Rename components
- Merge duplicate components
- Split incorrectly grouped components
- Assign a component to a context
- Change a component type
- Confirm or reject a relationship
- Mark generated code as ignored
- Mark a component as infrastructure
- Mark a component as shared
- Add a domain concept alias
- Add an architectural rule
- Ignore a path
- Add ownership information
- Confirm an AI inference

Confirmed project knowledge must be stored in:

.impactgraph/

Suggested files:

.impactgraph/
├── config.yml
├── architecture.yml
├── aliases.yml
├── rules.yml
└── .gitignore

Generated caches and indexes must not be committed.

⸻

17. Configuration Requirements

Example configuration:

version: 1
project:
name: amber
privacyMode: selected-snippets
languages:

- typescript
- python
- terraform
  ignore:
- node_modules/**
- dist/**
- build/**
- coverage/**
- generated/**
- .terraform/**
  contexts:
  deals:
  name: Deal Management
  paths:
  - apps/api/src/deals/**
    subscriptions:
    name: Subscriptions
    paths:
  - apps/api/src/subscriptions/**
    components:
- path: apps/api/src/deals/domain/**
  role: domain
  context: deals
  aliases:
  listing:
  - deal
  - opportunity
    rules:
- id: domain-no-infrastructure-import
  sourceRole: domain
  forbiddenTargetRole: infrastructure
  providers:
  mode: external-agent

Configuration must have a documented JSON Schema.

VS Code should provide validation and autocomplete for configuration files.

⸻

18. VS Code User Interface

18.1 Activity bar container

ImpactGraph must add an activity bar icon.

The container should include:

- Specifications
- Current impact
- Architecture
- Review
- Issues

18.2 Specification view

The specification view must support:

- Paste specification
- Import selected text
- Import current Markdown file
- Receive specification through command or agent tool
- Edit specification
- View extracted requirements
- View ambiguities
- Answer open questions
- Save specification versions
- Compare specification versions
- Run impact analysis

18.3 Impact tree

The tree is the default view.

Suggested hierarchy:

Specification
├── Requirement R1
│ ├── Required
│ ├── Likely
│ └── Possible
├── Requirement R2
└── Open questions

Alternative grouping:

Affected contexts
├── Deal Management
├── Search
├── Billing
└── Infrastructure

Users must be able to switch grouping modes.

18.4 Graph view

The graph is an optional interactive view.

Required features:

- Zoom
- Pan
- Search
- Expand and collapse
- Filter by impact type
- Filter by confidence
- Filter inferred relationships
- Filter unchanged architecture
- Group by context
- Group by application
- Group by requirement
- Show direct versus indirect impact
- Open source file from node
- Show evidence from edge or node
- Accept or reject impact
- Add a missing impact
- Display current and proposed relationships

The graph must avoid displaying the entire symbol graph by default.

Default level should be:

Context → Component → Integration or data dependency

Users may drill down to:

Module → File → Symbol

18.5 Evidence panel

Selecting an impact must display:

- Impact explanation
- Requirement
- Expected change
- Confidence
- Confidence factors
- Provenance
- Direct or indirect classification
- Dependency path
- Source files
- Symbols
- Relevant source ranges
- Related tests
- Human decisions
- Warnings

18.6 Architecture view

The architecture view must show:

- Detected applications
- Contexts
- Components
- Integrations
- Infrastructure
- Unconfirmed inferences
- Architecture issues
- User corrections

18.7 Review view

The review view must show:

- Approved expected impact
- Actual changed components
- Matching changes
- Missing expected changes
- Unexpected changes
- New architectural edges
- Removed architectural edges
- Requirement coverage warnings
- Test coverage warnings
- Infrastructure discrepancies
- Migration discrepancies
- Overall review status

⸻

19. VS Code Commands

Required commands:

ImpactGraph: Initialize Workspace
ImpactGraph: Reindex Workspace
ImpactGraph: Open Architecture
ImpactGraph: Analyze Specification
ImpactGraph: Analyze Selected Text
ImpactGraph: Analyze Current Markdown File
ImpactGraph: Import Specification
ImpactGraph: Save Specification Version
ImpactGraph: Compare Specification Versions
ImpactGraph: Open Impact Tree
ImpactGraph: Open Impact Graph
ImpactGraph: Approve Impact Analysis
ImpactGraph: Reject Impact
ImpactGraph: Add Manual Impact
ImpactGraph: Export Implementation Context
ImpactGraph: Export Markdown Report
ImpactGraph: Export JSON Report
ImpactGraph: Review Implementation
ImpactGraph: Review Working Tree
ImpactGraph: Review Current Commit
ImpactGraph: Open Review Report
ImpactGraph: Configure Privacy
ImpactGraph: Configure Model Provider
ImpactGraph: Edit Project Architecture
ImpactGraph: Show Index Status
ImpactGraph: Clear Local Cache

Context menu commands:

Analyze Selection with ImpactGraph
Mark as Domain Component
Mark as Infrastructure Component
Assign to Context
Ignore Path
Show Architectural Dependencies
Show Requirement Impacts

⸻

20. CLI Requirements

The extension must use the same core engine as a CLI.

Initial commands:

impactgraph init
impactgraph index
impactgraph status
impactgraph architecture
impactgraph analyze
impactgraph approve
impactgraph export
impactgraph review
impactgraph config

Examples:

impactgraph analyze spec.md
impactgraph analyze spec.md --format json
impactgraph review --working-tree
impactgraph review --commit HEAD
impactgraph export --analysis <id> --format markdown

The CLI must support machine-readable JSON output.

Exit codes must distinguish:

- Successful analysis
- Warnings found
- Review discrepancies found
- Configuration error
- Indexing failure
- Provider failure
- Unsupported project

⸻

21. Agent and MCP Interface

ImpactGraph should expose an MCP server or equivalent agent-tool interface.

Initial tools:

impactgraph.initialize_workspace
impactgraph.get_workspace_status
impactgraph.index_workspace
impactgraph.submit_specification
impactgraph.get_specification
impactgraph.extract_requirements
impactgraph.get_open_questions
impactgraph.analyze_impact
impactgraph.get_impact_analysis
impactgraph.update_impact_decision
impactgraph.approve_analysis
impactgraph.export_implementation_context
impactgraph.review_implementation
impactgraph.get_review_report
impactgraph.query_architecture
impactgraph.explain_node
impactgraph.explain_edge
impactgraph.find_components

21.1 Agent workflow

An agent should be able to:

1. Retrieve a task from Jira or another source using a separate MCP.
2. Clarify the task with the user.
3. Build a specification.
4. Submit the specification to ImpactGraph.
5. Ask ImpactGraph for ambiguities.
6. Update the specification.
7. Generate an impact analysis.
8. Present it to the user.
9. Receive approval.
10. Export implementation context.
11. Implement the feature.
12. Run ImpactGraph review.
13. Report mismatches to the user.

ImpactGraph itself should not silently approve an analysis or implementation.

⸻

22. Implementation Context Export

The export provided to coding agents must be structured.

interface ImplementationContext {
specification: Specification;
approvedAnalysis: ImpactAnalysis;
repositorySnapshot: RepositorySnapshotSummary;
requiredImpacts: ImpactSummary[];
likelyImpacts: ImpactSummary[];
rejectedImpacts: ImpactSummary[];
architectureConstraints: ArchitectureRule[];
expectedTests: TestExpectation[];
expectedMigrations: MigrationExpectation[];
expectedInfrastructureChanges: InfrastructureExpectation[];
openWarnings: AnalysisWarning[];
reviewCriteria: ReviewCriterion[];
}

The export must be available as:

- JSON
- Markdown
- Agent-readable tool response

⸻

23. Git Integration

23.1 Repository snapshots

Every analysis must reference:

- Repository identity
- Current branch
- Current commit
- Dirty working tree status
- Index version
- Analysis timestamp

23.2 MVP review targets

The MVP must support:

- Current working tree compared with current commit
- Current commit snapshot
- Approved analysis snapshot

23.3 Future Git targets

Later versions may support:

- Branch comparison
- Commit range
- Pull request
- Merge request
- Remote default branch
- GitHub and GitLab integrations

⸻

24. Implementation Review Logic

The review engine must not only compare filenames.

It should compare:

- Changed files
- Changed symbols
- Added symbols
- Removed symbols
- Changed imports
- Changed calls
- Changed routes
- Changed database models
- Added migrations
- Changed events
- Changed Pub/Sub relationships
- Changed Terraform resources
- Changed Cloud Run configuration
- Changed tests
- Architectural edge changes

24.1 Review result categories

Matched

A predicted component changed in a way consistent with the specification.

Missing

A component marked as required did not change and no evidence explains why.

Unexpected

A component changed but was not included in the approved analysis.

Divergent

A predicted component changed, but the implementation differs from the expected architectural direction.

Unverifiable

ImpactGraph cannot determine whether the requirement was implemented.

Accepted deviation

The user approves a discrepancy and records a reason.

⸻

25. Requirement Coverage

ImpactGraph should attempt to map actual implementation changes back to requirements.

Example:

R1: Deals become invisible after 90 days
Status: Partially implemented
Evidence:
✓ Query filtering was added
✓ Database field was added
✕ No background process or calculated expiration policy was found
? Existing records migration is unclear

Requirement coverage must be presented as an estimate, not a formal proof.

⸻

26. Architectural Alternatives

ImpactGraph may generate alternative implementation approaches.

Example:

Option A: Query-time visibility calculation
Option B: Materialized visibility projection
Option C: Scheduled expiration

Each option should include:

- Components affected
- New dependencies
- Removed dependencies
- Data implications
- Performance implications
- Operational implications
- Consistency model
- Complexity
- Migration requirements
- Testing requirements
- Advantages
- Risks

The user can select one option as the approved architectural direction.

Alternative generation is an AI-assisted feature and must be labeled as such.

⸻

27. Architecture Rules

Users must be able to define enforceable architecture rules.

Examples:

- Domain code must not import infrastructure code.
- Billing must not directly depend on Search.
- Shared packages must not access databases.
- Controllers must not contain business logic.
- Pub/Sub consumers must be idempotent.
- Infrastructure changes require Terraform changes.
- Database schema changes require migrations.
- API contract changes require tests.
- New environment variables must be documented.

Rules may be:

- Deterministic
- Heuristic
- Human-reviewed
- AI-assisted

Rule violations must include evidence.

⸻

28. Storage Architecture

28.1 Version-controlled project knowledge

Store in .impactgraph/:

- Configuration
- Context definitions
- Confirmed component mappings
- Aliases
- Architecture rules
- Ignore rules
- Optional approved analysis summaries

28.2 Local generated state

Use a local SQLite database for:

- Repository index
- Symbols
- Graph nodes
- Graph edges
- Embeddings if enabled
- Analysis versions
- Evidence
- Review reports
- Provider cache
- User feedback

The database should live in VS Code workspace storage or another non-version-controlled local location.

28.3 Future team backend

A hosted or self-hosted shared backend is outside the MVP.

The storage abstraction must allow future synchronization.

⸻

29. Core Technical Architecture

Recommended package structure:

impactgraph/
├── apps/
│ ├── vscode-extension/
│ ├── cli/
│ └── mcp-server/
├── packages/
│ ├── core/
│ ├── graph/
│ ├── storage/
│ ├── specification/
│ ├── impact-engine/
│ ├── review-engine/
│ ├── provider-interface/
│ ├── language-adapters/
│ ├── framework-adapters/
│ └── shared/

29.1 Core engine responsibilities

- Repository indexing
- Graph construction
- Architecture modeling
- Specification modeling
- Impact generation
- Evidence validation
- Confidence calculation
- Review comparison
- Export generation

29.2 Extension responsibilities

- UI
- VS Code commands
- Editor integration
- Source navigation
- Progress reporting
- Configuration
- User decisions

29.3 CLI responsibilities

- Headless execution
- CI support
- Debugging
- JSON and Markdown output

29.4 MCP responsibilities

- Agent tool schemas
- Agent-readable responses
- Authorization boundaries
- Stable command contracts

⸻

30. Language Adapter Interface

interface LanguageAdapter {
id: string;
supportedExtensions: string[];
detectProject(context: RepositoryContext): Promise<DetectionResult>;
indexFiles(
files: RepositoryFile[],
context: IndexingContext
): Promise<GraphFragment>;
analyzeDiff(
diff: GitDiff,
context: AnalysisContext
): Promise<GraphChangeSet>;
}

Initial adapters:

- TypeScript/JavaScript
- Python
- Java
- HTML/Astro
- Terraform

TypeScript and JavaScript may share an adapter.

HTML support should focus on relationships to templates, components, scripts, forms, routes, and assets rather than treating HTML as a full application architecture language.

⸻

31. Framework Adapter Interface

interface FrameworkAdapter {
id: string;
languageIds: string[];
detect(graph: CodeGraph): Promise<FrameworkDetection>;
enrich(
graph: CodeGraph,
context: FrameworkContext
): Promise<GraphFragment>;
}

Initial framework adapters:

- NestJS
- Express
- FastAPI
- Astro
- GCP/Terraform
- Cloud Run
- Pub/Sub

⸻

32. Indexing Requirements

The indexer must:

- Be incremental
- Hash files
- Re-index only changed files
- Be cancellable
- Report progress
- Persist partial progress safely
- Recover from parser failure
- Skip ignored directories
- Handle large monorepos
- Record parser warnings
- Avoid blocking the VS Code extension host
- Run in a separate process or worker where appropriate

The index must be tied to a repository snapshot.

⸻

33. Performance Requirements

Initial targets:

- Extension activation under 500 ms without indexing
- No indexing in the extension host process
- Incremental update for a small change under 3 seconds where practical
- Initial index of 5,000 source files under 2 minutes on a typical development machine
- Impact tree first results under 15 seconds for a pre-indexed repository
- UI remains responsive during indexing
- Graph view defaults to fewer than 200 visible nodes
- Large results must use progressive disclosure

These are product targets, not hard guarantees for every repository.

⸻

34. Reliability Requirements

The system must:

- Preserve previous valid indexes if a new index fails
- Record analysis and repository versions
- Avoid overwriting user-confirmed architecture silently
- Validate AI output against schemas
- Reject references to nonexistent nodes
- Downgrade unsupported claims
- Provide deterministic output where possible
- Log provider failures without exposing source code
- Allow analysis to continue with partial language support
- Clearly report unsupported files or frameworks

⸻

35. Security Requirements

- No secrets may be included in model prompts.
- Environment files must be excluded by default.
- Common secret patterns must be redacted.
- API keys must use VS Code SecretStorage.
- Provider credentials must never be committed.
- External model requests must be inspectable where practical.
- The user must be able to preview data sent externally.
- Repository trust mode must be respected.
- The extension must not execute repository code during static analysis.
- Terraform and configuration files must be parsed, not executed.
- Shell commands must require explicit user action unless clearly safe and internal.
- MCP tools that modify state must require appropriate confirmation.
- Logs must not contain raw secrets or full source files.

⸻

36. Telemetry

For the initial open-source product:

- Telemetry must be off by default.
- The user may explicitly opt in.
- No source code, specification text, filenames, repository names, or graph content may be collected.
- Allowed optional metrics:
  - Command usage counts
  - Index duration buckets
  - Error categories
  - Language adapter usage
  - Feature adoption
- Telemetry configuration must be visible and reversible.

⸻

37. Accessibility

The extension must support:

- Keyboard navigation
- Screen-reader labels
- High-contrast themes
- Color-independent impact indicators
- Text labels in addition to confidence colors
- Focus management
- Resizable panels
- Reduced-motion compatibility
- Accessible graph alternatives through the impact tree

The graph must never be the only way to access information.

⸻

38. Exported Reports

38.1 Impact report

Sections:

1. Specification summary
2. Extracted requirements
3. Open questions
4. Affected contexts
5. Required impacts
6. Likely impacts
7. Possible impacts
8. Data and migration impact
9. API impact
10. Event and messaging impact
11. Infrastructure impact
12. Security impact
13. Test expectations
14. Architectural alternatives
15. Risks
16. User decisions
17. Evidence
18. Repository snapshot

38.2 Review report

Sections:

1. Review summary
2. Approved specification
3. Matched changes
4. Missing expected changes
5. Unexpected changes
6. Divergent changes
7. Requirement coverage
8. Architecture rule violations
9. Test discrepancies
10. Migration discrepancies
11. Infrastructure discrepancies
12. Accepted deviations
13. Recommended follow-up actions

⸻

39. MVP Functional Requirements

The MVP is complete when a user can:

1. Install the VS Code extension.
2. Initialize a repository.
3. Index a TypeScript or JavaScript project.
4. Discover modules, files, symbols, routes, data models, and tests.
5. Add or correct architecture contexts.
6. Paste or import a specification.
7. Extract structured requirements.
8. See ambiguity questions.
9. Generate an evidence-backed impact tree.
10. Open affected files and symbols.
11. Accept or reject impacts.
12. Approve an analysis snapshot.
13. Export implementation context for Claude Code or Cursor.
14. Implement the feature externally.
15. Run a working-tree review.
16. Compare predicted and actual changes.
17. Export the review report.

Initial Terraform, Python, Java, FastAPI, Astro, GCP, and Cloud Run support may be delivered in later milestones, but their adapter interfaces must exist from the beginning.

⸻

40. MVP Acceptance Criteria

40.1 Indexing

- Given a supported TypeScript repository, the extension indexes source files without executing project code.
- Imports and symbol definitions are represented in the graph.
- Express or NestJS routes are detected when the relevant adapter is enabled.
- Ignored paths do not appear in results.
- Incremental re-indexing updates changed files only.

40.2 Specification

- The user can paste text or analyze selected text.
- ImpactGraph creates structured requirements.
- The user can edit extracted requirements.
- Specification versions are preserved.
- Open questions are displayed separately.

40.3 Impact analysis

- Every impact references a repository node.
- Every inferred impact has an explanation and confidence.
- Every impact displays its provenance.
- Unsupported model references are rejected.
- The user can accept, reject, or manually add an impact.
- An approved analysis is immutable and versioned.

40.4 Navigation

- Selecting a file or symbol impact opens the relevant source.
- The user can filter by likelihood and impact type.
- The tree remains usable without the graph view.

40.5 Review

- The user can review current working-tree changes.
- The result distinguishes expected and unexpected changed files.
- Symbol-level comparison is used where supported.
- Missing required impacts are highlighted.
- Review results can be exported as Markdown and JSON.

40.6 Privacy

- Selected-snippet mode is the default.
- No external provider is called without configuration.
- Secrets are stored using VS Code SecretStorage.
- The user can run deterministic analysis without an AI provider.

⸻

41. Quality Metrics

Primary success metrics:

41.1 Direct impact recall

Percentage of genuinely affected direct components identified by ImpactGraph.

Initial target:

Above 90% for supported project patterns.

41.2 Overall precision

Percentage of suggested impacts accepted as relevant.

Initial target:

Above 70%.

41.3 Unsupported claim rate

Percentage of impacts without valid evidence.

Target:

Below 5%.

41.4 Planning improvement

Reduction in time required to produce an approved implementation plan.

Target:

Above 40% in controlled tests.

41.5 Surprise detection

Number of relevant dependencies found by ImpactGraph that the developer initially missed.

This is a primary product-value metric.

⸻

42. Testing Requirements

42.1 Unit tests

Required for:

- Graph model
- Configuration parsing
- Confidence calculation
- Requirement extraction schemas
- Diff comparison
- Evidence validation
- Architecture rules
- Export formatting
- Redaction
- Adapter interfaces

42.2 Fixture repositories

Create test fixtures for:

- TypeScript Express application
- NestJS application
- Python FastAPI application
- Java application
- Astro application
- Terraform GCP project
- Cloud Run service
- Pub/Sub publisher and consumer
- Monorepo
- Database migration workflow

42.3 Golden tests

For each fixture:

- Store expected graph nodes and edges.
- Store expected impact results for sample specifications.
- Store expected review results for sample diffs.

42.4 VS Code integration tests

Test:

- Extension activation
- Commands
- Tree views
- Editor navigation
- Configuration editing
- Secret storage
- Webview communication
- Cancellation
- Error states

42.5 Security tests

Test:

- Secret redaction
- .env exclusion
- Malicious repository content
- Prompt injection inside comments or documentation
- Invalid model output
- Path traversal
- Oversized files
- Symlink handling

Repository source and comments must be treated as untrusted data, not as instructions to the model.

⸻

43. Major Risks and Mitigations

43.1 Graph explosion

Risk: The architecture graph becomes unreadable.

Mitigation:

- Progressive disclosure
- Context-level default view
- Node limits
- Filters
- Tree-first interface
- On-demand symbol expansion

43.2 Hallucinated impact

Risk: AI invents components or dependencies.

Mitigation:

- Validate all referenced nodes
- Require evidence
- Distinguish inference from fact
- Downgrade unsupported claims
- User approval workflow

43.3 Incorrect architecture discovery

Risk: Automatic grouping misrepresents the project.

Mitigation:

- Mark discoveries as inferred
- Allow easy correction
- Store confirmed mappings
- Never silently override human corrections

43.4 Language scope

Risk: Supporting many languages delays delivery.

Mitigation:

- Stable adapter interfaces
- TypeScript/JavaScript first
- Add Python, Terraform, Java, and Astro incrementally
- Report partial support clearly

43.5 Provider inconsistency

Risk: Different models produce different results.

Mitigation:

- Structured schemas
- Deterministic candidate generation
- LLM only classifies bounded candidate sets
- Confidence generated from system signals
- Persist approved human decisions

43.6 False authority

Risk: Users trust an attractive graph too much.

Mitigation:

- Prominent confidence and provenance
- Explicit uncertainty
- Evidence panel
- “Unverifiable” status
- Human approval requirements

⸻

44. Recommended Delivery Phases

Phase 0: Validation and design

- Define graph schema
- Create three sample specifications
- Create a reference repository
- Manually produce ground-truth impact maps
- Validate workflow with developers
- Finalize UX wireframes

Phase 1: Core TypeScript indexer and CLI

- Repository scanner
- TypeScript/JavaScript parser
- Symbol and import graph
- SQLite storage
- Git snapshot
- CLI initialization
- CLI indexing
- JSON graph export

Phase 2: VS Code architecture explorer

- Extension shell
- Activity bar
- Architecture tree
- Source navigation
- Reindex command
- Context correction
- .impactgraph configuration

Phase 3: Specification engine

- Specification editor
- Requirement extraction
- Open questions
- Versioning
- Model-provider interface
- External-agent mode

Phase 4: Impact engine

- Concept matching
- Candidate graph traversal
- Impact classification
- Evidence generation
- Confidence scoring
- Accept and reject workflow
- Analysis approval

Phase 5: Impact graph and exports

- Tree grouping modes
- Interactive graph
- Evidence panel
- Markdown export
- JSON export
- Agent implementation-context export

Phase 6: Review engine

- Working-tree diff analysis
- Symbol-level changes
- Expected versus actual comparison
- Requirement coverage
- Review UI
- Review report export

Phase 7: MCP integration

- MCP server
- Specification submission
- Impact analysis tools
- Review tools
- Claude Code workflow documentation
- Cursor workflow documentation

Phase 8: Additional adapters

Recommended order:

1. Terraform
2. Python and FastAPI
3. GCP and Cloud Run enrichment
4. Pub/Sub enrichment
5. Astro and HTML
6. Java

⸻

45. Initial Epic Backlog

Epic A: Repository indexing

- Define node schema
- Define edge schema
- Define evidence schema
- Implement workspace scanner
- Implement ignore handling
- Implement file hashing
- Implement incremental indexing
- Implement TypeScript parser
- Implement JavaScript parser
- Extract imports
- Extract symbols
- Extract call relationships
- Store graph in SQLite
- Add repository snapshots
- Add index status reporting

Epic B: Framework discovery

- Detect NestJS
- Extract NestJS modules
- Extract NestJS controllers
- Extract NestJS providers
- Extract NestJS routes
- Detect Express
- Extract Express routers
- Extract middleware relationships
- Detect tests
- Detect migrations
- Detect environment references

Epic C: VS Code foundation

- Create extension project
- Add activity bar
- Add architecture tree
- Add command registration
- Add background process communication
- Add progress notifications
- Add source navigation
- Add workspace initialization
- Add reindexing
- Add error diagnostics

Epic D: Architecture correction

- Create architecture configuration schema
- Add context assignment
- Add component-role assignment
- Add ignore-path command
- Add alias configuration
- Persist human confirmation
- Protect human corrections during reindex
- Add configuration autocomplete

Epic E: Specification management

- Create specification input panel
- Import selected text
- Import Markdown file
- Save specification
- Version specification
- Extract requirements
- Edit requirements
- Display open questions
- Record answers
- Compare versions

Epic F: Impact analysis

- Implement concept extraction
- Implement concept-to-node matching
- Implement candidate traversal
- Add impact classifications
- Add confidence engine
- Add evidence validation
- Add dependency paths
- Add ambiguity penalties
- Add provenance labels
- Persist analysis versions

Epic G: Impact review UI

- Create impact tree
- Add grouping by requirement
- Add grouping by context
- Add grouping by likelihood
- Add filters
- Add evidence panel
- Add accept action
- Add reject action
- Add manual-impact action
- Add approval workflow
- Add graph view

Epic H: Agent export

- Define implementation-context schema
- Export JSON
- Export Markdown
- Add clipboard command
- Add agent-readable response
- Document Claude Code workflow
- Document Cursor workflow

Epic I: Git review

- Parse working-tree diff
- Identify changed files
- Identify changed symbols
- Rebuild affected graph fragments
- Compare predicted components
- Detect missing changes
- Detect unexpected changes
- Detect new edges
- Detect removed edges
- Add requirement-coverage estimates
- Add review UI
- Export review report

Epic J: MCP

- Create MCP server
- Define tool schemas
- Add workspace status tool
- Add specification submission tool
- Add impact-analysis tool
- Add analysis-approval tool
- Add export tool
- Add review tool
- Add architecture-query tool
- Add evidence-explanation tool

Epic K: Privacy and security

- Add privacy modes
- Add SecretStorage
- Add prompt preview
- Add source-range minimization
- Add secret redaction
- Add .env exclusion
- Add prompt-injection protection
- Add external-call audit log
- Add telemetry opt-in
- Add local-only mode

⸻

46. First Implementation Milestone

The first milestone should prove the core value without using a full graph UI.

Milestone objective

Given a TypeScript repository and a Markdown specification, the CLI produces an evidence-backed list of likely affected components.

Example command:

impactgraph analyze feature.md

Example output:

Requirement R1
Deals become invisible after 90 days.
Required:

- DealVisibilityPolicy
- DealQueryService
- Deal database model
  Likely:
- DealSearchIndexer
- Deal API tests
  Possible:
- Reporting queries
  Open questions:
- Is the 90-day period based on creation or publication?
- Should existing deals be migrated?
  Evidence:
- src/deals/domain/DealVisibilityPolicy.ts
- src/deals/application/DealQueryService.ts
- prisma/schema.prisma

Milestone acceptance criteria

- TypeScript project indexing works.
- Specification parsing works.
- Concepts map to repository symbols.
- Candidate impacts are graph-derived.
- AI output references only valid graph nodes.
- Results include evidence.
- Results are exportable as JSON.
- A sample repository demonstrates at least one relevant dependency that is not explicitly named in the specification.

⸻

47. Claude Code Build Instructions

Claude Code should follow these rules while implementing ImpactGraph:

1. Treat this document as the current product source of truth.
2. Do not implement all phases at once.
3. Begin with the first implementation milestone.
4. Produce an implementation plan before changing files.
5. Keep the core engine independent from VS Code.
6. Keep model-provider logic behind an interface.
7. Do not require an external AI provider for repository indexing.
8. Validate all model output with schemas.
9. Do not allow AI-generated graph nodes that do not exist in the repository graph.
10. Persist repository facts separately from AI inferences.
11. Write tests for every graph transformation.
12. Use fixture repositories for integration tests.
13. Avoid microservices.
14. Avoid Neo4j for the MVP.
15. Use SQLite for the local index.
16. Use versioned configuration formats.
17. Do not execute repository code during analysis.
18. Keep privacy mode explicit.
19. Do not build autonomous code implementation into the MVP.
20. Ask the user before making a product decision that contradicts this specification.

⸻

48. Definition of Product Success

ImpactGraph succeeds when a developer can give an AI agent a specification, inspect a trustworthy architectural impact model before coding, approve the intended direction, and later verify that the resulting implementation matches that approved model.

The product is not successful merely because it produces a graph.

It is successful when it reliably answers:

What will this feature affect?

Why will it affect those areas?

What architectural decisions must be made?

Did the final implementation match the approved plan?

Addendum: AI-Managed Zero-Configuration Architecture

1. Zero-Configuration Product Requirement

ImpactGraph must provide useful architecture and impact analysis without requiring the developer to manually configure:

- Programming languages
- Frameworks
- Runtime environments
- Repository structure
- Applications
- Services
- Bounded contexts
- Architectural layers
- Source roots
- Test roots
- Infrastructure directories
- Database technologies
- Messaging technologies
- Deployment targets
- Generated-code paths
- Naming conventions
- Domain terminology
- Component ownership
- Architecture rules

The default onboarding experience must be:

Open repository
↓
AI inspects repository
↓
ImpactGraph indexes deterministic facts
↓
AI generates project configuration
↓
ImpactGraph validates the configuration
↓
Repository is ready for analysis

The user should not be required to create or fine-tune configuration files before running the first impact analysis.

⸻

2. AI as Configuration Operator

The developer’s configured AI agent must be able to manage the complete ImpactGraph configuration lifecycle.

This includes:

- Detecting missing configuration
- Creating initial configuration
- Updating configuration after repository changes
- Adding newly detected languages
- Adding newly detected frameworks
- Updating application boundaries
- Updating source and test paths
- Adding infrastructure detection rules
- Adding domain aliases
- Correcting component classifications
- Creating architecture rules
- Updating ignored paths
- Removing stale configuration
- Explaining every configuration change
- Validating configuration after modification
- Rolling back invalid configuration

The agent must use structured ImpactGraph tools rather than editing configuration blindly wherever possible.

⸻

3. No-Touch Onboarding

A developer must be able to install ImpactGraph and ask their coding agent:

Initialize ImpactGraph for this repository.

The agent should then:

1. Inspect the workspace.
2. Ask ImpactGraph for repository detection results.
3. Detect the technology stack.
4. Identify ambiguous project areas.
5. Generate the initial configuration.
6. Submit the configuration to ImpactGraph.
7. Run configuration validation.
8. Run the first repository index.
9. Inspect warnings.
10. Correct configuration automatically where possible.
11. Present a concise initialization summary to the user.

The user should only be interrupted when a materially ambiguous decision cannot safely be inferred.

Examples of questions that may justify interruption:

- Two directories appear to represent separate services but share the same deployment.
- One term refers to two unrelated business concepts.
- Generated code cannot be reliably distinguished from maintained code.
- Multiple databases appear to own the same data model.
- The repository contains conflicting architecture documentation.

Minor uncertainty must not block onboarding.

⸻

4. Detection-First Configuration

Configuration must be generated from repository evidence.

Potential evidence sources include:

- File extensions
- Package manifests
- Lock files
- Build files
- Framework dependencies
- Import patterns
- Decorators and annotations
- Entry points
- Directory conventions
- Docker files
- Terraform resources
- CI workflows
- Database migration tools
- API schemas
- Environment-variable references
- Git history
- Code ownership files
- Existing architecture documentation
- Existing agent instructions
- Existing project configuration
- Runtime and deployment manifests

Every generated configuration field should retain its evidence and confidence where practical.

Example:

applications:
api:
path: apps/api
language: typescript
framework: nestjs
confidence: 0.98
detectedFrom: - apps/api/package.json - apps/api/src/main.ts - "@nestjs/core dependency"

Confidence and evidence may be stored internally rather than committed to the human-readable configuration file.

⸻

5. Configuration Sources and Priority

ImpactGraph must merge configuration from multiple sources using a clear precedence model.

Recommended priority:

1. Explicit human-confirmed configuration
2. Explicit agent-approved configuration
3. Repository-native metadata
4. Deterministic framework detection
5. AI-inferred configuration
6. Default conventions

Higher-priority configuration must not be silently overwritten by lower-priority inference.

Human-confirmed values remain authoritative until:

- The user changes them
- The user explicitly delegates ownership to the AI
- The configured files or components no longer exist

⸻

6. Agent Ownership Modes

Each workspace must support configurable automation levels.

6.1 Autonomous

The agent may create and update ImpactGraph configuration without requesting approval for routine changes.

The agent must:

- Validate changes
- Record an audit entry
- Avoid overriding human-confirmed decisions
- Report material changes after applying them

This should be the recommended mode for individual developers.

6.2 Review before apply

The agent proposes a configuration patch and waits for developer approval.

This may be preferred by tech leads or regulated teams.

6.3 Manual

The agent may explain and propose changes but cannot modify configuration.

The default product experience should make autonomous configuration easy, while still allowing teams to choose stricter modes.

⸻

7. Structured Configuration Operations

The MCP and agent interface must expose configuration tools.

Required tools:

impactgraph.detect_stack
impactgraph.detect_repository_structure
impactgraph.get_configuration
impactgraph.generate_configuration
impactgraph.validate_configuration
impactgraph.preview_configuration_change
impactgraph.apply_configuration_change
impactgraph.rollback_configuration_change
impactgraph.refresh_configuration
impactgraph.explain_configuration
impactgraph.get_configuration_warnings
impactgraph.confirm_configuration_value
impactgraph.remove_stale_configuration

Configuration writes must use structured operations.

Example:

{
"operations": [
{
"type": "add-language",
"language": "python",
"paths": ["services/recommendation/**"],
"reason": "Detected pyproject.toml and FastAPI imports."
},
{
"type": "add-framework",
"framework": "fastapi",
"application": "recommendation-service",
"confidence": 0.96
}
]
}

The agent should not have to directly rewrite YAML text for ordinary configuration changes.

⸻

8. AI-Generated Detection Rules

Users and agents must be able to extend detection for custom or unsupported stacks.

For example, the agent may discover that:

- A proprietary framework uses specific decorators.
- Services are registered through a custom container.
- Pub/Sub topics are declared through an internal wrapper.
- Database access goes through a company-specific abstraction.
- A custom folder convention represents bounded contexts.
- Terraform resources are wrapped in internal modules.

The agent must be able to define repository-specific detection rules.

Example:

customDetection:

- id: internal-pubsub-consumer
  language: typescript
  match:
  imports: - "@company/messaging"
  decorators: - "Subscribe"
  produces:
  nodeType: subscriber
  topicArgument: 0

Custom rules must:

- Be versioned
- Be validated
- Be explainable
- Be testable against repository fixtures
- Be removable
- Be clearly distinguished from built-in adapters

⸻

9. Self-Improving Project Model

When the user or agent corrects an analysis, ImpactGraph should update project knowledge automatically.

Examples:

User rejects:
“BillingService is affected.”
ImpactGraph learns:
The shared PremiumCustomer type does not imply Billing ownership.
User confirms:
“This internal wrapper publishes to Pub/Sub.”
ImpactGraph learns:
Calls through the wrapper should create PUBLISHES relationships.
Review detects:
Migration files always accompany schema changes.
ImpactGraph proposes:
Add a repository architecture rule requiring migrations.

The system may propose or apply configuration changes based on feedback, depending on the configured agent ownership mode.

⸻

10. Automatic Configuration Maintenance

ImpactGraph must detect configuration drift.

Examples:

- A new application is added.
- A package moves to another directory.
- NestJS is replaced with Fastify.
- A Python service is introduced.
- A Pub/Sub subscription is renamed.
- Terraform modules are reorganized.
- A component no longer exists.
- A domain alias becomes ambiguous.
- An architecture rule references deleted paths.

After indexing, ImpactGraph should produce configuration maintenance actions:

Added:

- Python recommendation service
- FastAPI framework detection
  Updated:
- Search service path moved from apps/search to services/search
  Removed:
- Obsolete legacy-worker component
  Needs review:
- Both Deal and Opportunity now appear as separate domain concepts

In autonomous mode, safe changes should be applied automatically.

⸻

11. Safe Versus Material Configuration Changes

ImpactGraph should classify proposed configuration changes.

Safe changes

May be applied automatically in autonomous mode:

- Adding a clearly detected language
- Adding a clearly detected framework
- Adding a source root
- Adding a test root
- Ignoring generated output
- Removing references to deleted files
- Updating paths after an unambiguous move
- Adding deterministic infrastructure resources
- Adding exact aliases found in existing documentation

Material changes

May require explicit approval depending on user settings:

- Merging bounded contexts
- Splitting applications
- Reassigning domain ownership
- Changing architecture rules
- Declaring a module as shared
- Changing privacy mode
- Enabling external code transmission
- Removing human-confirmed mappings
- Treating two business concepts as synonyms
- Changing service boundaries
- Altering accepted dependency directions

The distinction must be configurable.

⸻

12. Configuration Audit History

Every AI-generated configuration change must record:

- Timestamp
- Agent identity when available
- Model/provider when available
- Previous value
- New value
- Reason
- Evidence
- Confidence
- Validation result
- Whether the change was automatic or approved
- Repository snapshot
- Rollback identifier

Example:

Added FastAPI framework
Reason:

- fastapi dependency found in pyproject.toml
- FastAPI() instantiated in app/main.py
- APIRouter used in 8 modules
  Confidence: 99%
  Applied automatically
  Repository: 4f8a29c

The audit history can remain local for the MVP.

⸻

13. Configuration Validation

AI-generated configuration must be validated before use.

Validation includes:

- Schema validation
- Path existence
- Glob validity
- Language-adapter availability
- Framework-adapter availability
- Duplicate identifiers
- Conflicting context mappings
- Circular ownership declarations
- Invalid architecture rules
- References to missing resources
- Unsupported custom detection syntax
- Excessively broad match patterns
- Privacy-policy conflicts

An invalid configuration must never replace the last valid configuration.

⸻

14. Configuration Rollback

The user or agent must be able to run:

ImpactGraph: Undo Last Configuration Change
ImpactGraph: Open Configuration History
ImpactGraph: Restore Configuration Version

Corresponding CLI commands:

impactgraph config history
impactgraph config diff
impactgraph config rollback
impactgraph config restore <version>

Corresponding agent tools:

impactgraph.get_configuration_history
impactgraph.rollback_configuration_change
impactgraph.restore_configuration_version

⸻

15. Natural-Language Configuration

The user must be able to configure the project through natural language.

Examples:

Treat everything under src/domain as domain code.
Our events package is only a transport wrapper, not a bounded context.
Deal and Opportunity mean the same thing in this repository.
The old-service folder is legacy and should not affect new feature analysis.
Any Terraform change to a Cloud Run service should include deployment review.

The configured AI agent should translate these instructions into validated structured configuration changes.

⸻

16. Repository-Specific Stack Fine-Tuning

The phrase “fine-tuning the stack” should not mean model training.

It means that the AI can adapt ImpactGraph to repository-specific patterns by creating:

- Aliases
- Detection rules
- Path mappings
- Framework extensions
- Component classifiers
- Architecture rules
- Ignore rules
- Ownership mappings
- Evidence extractors
- Wrapper recognizers

The developer should not need to manually write these rules.

The AI should infer and maintain them from:

- Repository inspection
- User explanations
- Analysis corrections
- Review outcomes
- Existing documentation
- Repeated implementation patterns

⸻

17. External-Agent Workflow

An external agent such as Claude Code should be able to perform:

1. Retrieve or receive the task.
2. Clarify the task with the user.
3. Produce the specification.
4. Check ImpactGraph workspace status.
5. Initialize ImpactGraph if required.
6. Detect and configure the repository automatically.
7. Validate and index the repository.
8. Submit the specification.
9. Generate the impact model.
10. Present material ambiguities to the user.
11. Update the specification.
12. Regenerate the impact model.
13. Receive approval.
14. Export implementation context.
15. Implement the feature.
16. Run implementation review.
17. Correct missing or divergent changes.
18. Present final discrepancies to the user.

The ideal user request should be as simple as:

Take this Jira ticket, clarify it with me, design the solution,
show me the architectural impact, and implement it after I approve.

The user should not also have to say:

Configure ImpactGraph for Python.
Add FastAPI.
Find my Terraform folder.
Define the services.
Map the modules.

That work belongs to the agent and ImpactGraph.

⸻

18. Revised Configuration Principle

The previous requirement:

Users must be able to manually correct architecture configuration.

must remain true, but it is secondary to the following requirement:

The configured AI agent must be able to discover, create, validate, apply, and maintain all repository-specific configuration so that manual configuration is not required for normal use.

Manual configuration exists for:

- Oversight
- Correction
- Advanced control
- Auditability
- Teams that restrict autonomous changes

It must not be necessary to obtain useful results.

⸻

19. Revised MVP Acceptance Criteria

In addition to the existing MVP criteria:

1. A user can initialize a supported repository without manually editing configuration files.
2. An external agent can detect the repository stack through structured ImpactGraph tools.
3. The agent can generate and apply valid project configuration.
4. The generated configuration is validated before indexing.
5. The system explains detected languages, frameworks, applications, and infrastructure.
6. The user can inspect and override any generated value.
7. Human-confirmed values are not silently overwritten.
8. Configuration changes have an audit trail.
9. Invalid configuration can be rolled back.
10. Repository changes trigger configuration-drift detection.
11. A supported custom framework pattern can be added through an AI-generated detection rule.
12. The user can run the first specification analysis without manually fine-tuning the stack.

⸻

20. Product Experience Standard

ImpactGraph should feel like an intelligent architectural subsystem used by the developer’s chosen agent, not like another configuration-heavy developer tool.

The expected experience is:

Developer:
Analyze this feature.
Agent:
I detected a TypeScript monorepo with NestJS, FastAPI,
Cloud Run, Pub/Sub and Terraform. I configured and indexed
the workspace automatically.
Here are the requirements, open questions and expected
architectural impacts.

Not:

Please create config.yml.
Please label your source folders.
Please choose your framework.
Please map all bounded contexts.
Please define your infrastructure.

The success standard is that most developers never need to open .impactgraph/config.yml, while advanced users and tech leads retain full control over it.

Addendum: AI Clarification Engine and Multi-Stack Intelligence (v1)

1. Product Principle

ImpactGraph is not an impact graph generator.

It is an architectural reasoning system.

Its responsibility is to understand the repository, understand the specification, identify architectural ambiguity, interview the developer (or coding agent) only when necessary, and produce an approved architectural model before implementation begins.

The impact graph is one representation of that reasoning process, not the primary product.

⸻

2. Clarification Engine

The Clarification Engine is a first-class engine of the platform.

Its goals are to:

- Complete incomplete specifications.
- Reduce implementation risk.
- Increase confidence in architectural predictions.
- Discover hidden requirements.
- Surface architectural trade-offs.
- Produce an implementation-ready specification.
- Learn repository-specific architectural knowledge over time.

⸻

3. Clarification Philosophy

ImpactGraph must follow this rule:

Infer everything supported by evidence. Ask only when ambiguity materially changes the architecture.

The engine must never ask generic questions simply because information is missing.

Instead, it should compare multiple valid architectural interpretations.

If those interpretations lead to essentially the same implementation, no clarification is required.

If they produce meaningfully different impact graphs, the engine should generate targeted clarification questions.

⸻

4. Clarification Workflow

Specification
↓
Requirement Extraction
↓
Repository Analysis
↓
Generate Architectural Interpretations
↓
Compare Impact Graphs
↓
Identify Material Ambiguities
↓
Interview User or Agent
↓
Update Specification
↓
Generate Approved Impact Graph

The approved specification becomes the source of truth for implementation.

⸻

5. Cost-Aware Question Generation

Every clarification question should have an estimated architectural impact.

Examples of impact factors include:

- Number of affected components
- Number of affected bounded contexts
- Database changes
- Migration requirements
- Infrastructure changes
- API contract changes
- Event contract changes
- Terraform changes
- Deployment implications
- Test impact
- Security implications

Questions with higher architectural impact should be prioritized.

⸻

6. Question Severity

Questions should be classified as:

Blocking

Implementation should not begin without an answer.

Examples:

- Data ownership
- Migration strategy
- Source of truth
- Event ownership
- Security model

Important

Implementation can continue, but confidence is reduced.

Examples:

- Background job strategy
- Search indexing behavior
- Monitoring requirements
- Caching strategy

Minor

Answers improve precision but do not materially change the architecture.

Examples:

- Naming conventions
- Documentation expectations
- Minor performance preferences

⸻

7. Repository-Aware Questions

Questions must use repository knowledge.

Instead of asking:

“Do you need a migration?”

ImpactGraph should ask:

“I found that every previous Prisma schema change in this repository introduced a migration. Should this feature also migrate existing records?”

Instead of asking:

“Should this publish an event?”

It should ask:

“This repository publishes DealUpdated after every visibility change. Should this feature continue that behavior?”

Questions should demonstrate repository awareness.

⸻

8. Architecture Simulation

Whenever possible, ImpactGraph should generate multiple architectural interpretations instead of requesting abstract explanations.

Example:

Option A

Visibility calculated during queries.

Option B

Visibility calculated by scheduled job.

Option C

Visibility stored as persisted state.

Each option should display:

- Impact graph
- Components affected
- Infrastructure changes
- Performance implications
- Operational implications
- Risks
- Trade-offs

The developer should be able to select or modify an option instead of answering open-ended questions.

⸻

9. Architectural Decision Records

Every resolved clarification becomes a persistent Architectural Decision Record (ADR).

Each ADR should contain:

- Question
- Decision
- Reason
- Repository snapshot
- Related requirements
- Related components
- Related contexts
- Timestamp
- Author (user or agent)
- Confidence
- Whether the decision was manually confirmed

ADR knowledge should reduce repeated questions in future analyses.

⸻

10. Specification Completeness

ImpactGraph should continuously estimate how ready a specification is for implementation.

Example metrics:

- Requirement completeness
- Remaining ambiguities
- Repository confidence
- Architectural confidence
- Implementation readiness

Example output:

Implementation Readiness

91%

Blocking Questions: 0

Important Questions: 2

Minor Questions: 4

Recommended Action:

Answer event ownership before implementation.

⸻

11. Repository Learning

ImpactGraph should continuously improve its understanding of the project.

Learning sources include:

- User corrections
- Accepted impact analyses
- Review outcomes
- Architectural decisions
- Existing documentation
- Existing implementation patterns
- Git history
- Configuration changes

This knowledge should be stored as repository knowledge, not as model fine-tuning.

⸻

12. Multi-Stack Intelligence (v1)

Multi-language support is a core requirement of the first public version.

The architecture must treat language support as adapter-based while maintaining one shared repository knowledge graph.

Initial v1 support includes:

Languages:

- TypeScript
- JavaScript
- Python
- Java
- HTML
- Astro

Frameworks and platforms:

- NestJS
- Express
- FastAPI
- Spring
- Astro
- Terraform
- Google Cloud Platform
- Cloud Run
- Pub/Sub

Repository analysis must support repositories containing multiple languages simultaneously.

Example:

apps/web
→ Astro
apps/api
→ FastAPI
services/worker
→ Spring
infra/
→ Terraform
shared/
→ TypeScript

The repository should be analyzed as one architectural system rather than isolated language projects.

⸻

13. Cross-Stack Impact Analysis

The engine must detect architectural relationships across language boundaries.

Examples include:

Astro → FastAPI

Spring → Pub/Sub

FastAPI → Cloud Run

Terraform → Cloud Run

Terraform → Pub/Sub

FastAPI → PostgreSQL

Spring → Pub/Sub consumer

Astro → REST API

The resulting graph must represent system architecture rather than programming languages.

⸻

14. Language-Neutral Knowledge Graph

All analysis engines must operate on the same abstract graph.

Language adapters are responsible only for producing repository facts.

After graph construction, the Clarification Engine, Impact Engine, Review Engine, and Agent Integration Engine must be completely language independent.

This allows new languages and frameworks to be added without redesigning the reasoning engines.

⸻

15. Updated Core Engines

ImpactGraph v1 consists of four primary engines:

1. Repository Intelligence Engine
   - Repository discovery
   - Language detection
   - Framework detection
   - Architecture discovery
   - Knowledge graph construction
2. Clarification Engine
   - Requirement completion
   - Architectural interviewing
   - Alternative generation
   - Decision recording
   - Implementation readiness assessment
3. Impact & Review Engine
   - Impact prediction
   - Architectural comparison
   - Working-tree review
   - Requirement coverage
   - Drift detection
4. Agent Integration Engine
   - AI-provider abstraction
   - MCP tools
   - Configuration management
   - Implementation-context export
   - Review automation

Each engine depends on the shared Repository Knowledge Graph, ensuring consistent reasoning across analysis, clarification, implementation, and review.

⸻

16. Updated v1 Acceptance Criteria

In addition to all previous acceptance criteria, v1 must demonstrate:

- Automatic clarification of ambiguous specifications.
- Repository-aware clarification questions.
- Architectural alternative generation for material ambiguities.
- Persistent Architectural Decision Records.
- Implementation readiness scoring.
- Simultaneous analysis of repositories containing Astro, Python/FastAPI, Java/Spring, TypeScript/JavaScript, Terraform, and Google Cloud infrastructure.
- Cross-language architectural relationship detection.
- Cross-stack impact prediction.
- Cross-stack implementation review.
- Shared repository knowledge graph used consistently by all engines.
