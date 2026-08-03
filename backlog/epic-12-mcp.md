# Epic 12 — MCP Server & Agent Tools

**Goal:** Expose the full workflow (status → spec → analysis → approval → export → review) as MCP tools with stable contracts, so any MCP-enabled agent can drive ImpactGraph.
**Spec:** §21, §29.4, Epic J (§45), §44 Phase 7
**Phase:** 7 · **Depends on:** Epics 04–06, 10, 11

---

## Story 12.1 — MCP server & tool contracts

**Acceptance criteria**

- [x] `apps/mcp-server` runs against the same core engine (no logic duplication with CLI). _(the workflow pipelines were extracted into `packages/workspace-engine`; CLI and MCP server are both thin shells over it)_
- [x] Tool schemas defined for all §21 tools: initialize_workspace, get_workspace_status, index_workspace, submit_specification, get_specification, extract_requirements, get_open_questions, analyze_impact, get_impact_analysis, update_impact_decision, approve_analysis, export_implementation_context, review_implementation, get_review_report, query_architecture, explain_node, explain_edge, find_components. _(`contracts/src/tools/tools.ts`; 36 JSON Schemas committed under `schemas/tools/`)_
- [x] Contracts are versioned/stable (§29.4); responses are agent-readable structured data. _(tool payloads reuse the exact versioned CLI document schemas where they overlap — one schema per shape; results carry `structuredContent` + JSON text)_

**Tasks**

- [x] Scaffold MCP server with tool registry + schema validation. _(hand-rolled newline-delimited JSON-RPC over stdio — no new runtime dependency; swapping in the official MCP SDK later replaces one file, `server.ts`)_
- [x] Implement read-only tools (status, get_*, query, explain, find).
- [x] Contract snapshot tests per tool. _(roster/strictness/confirmation tests in `contracts/src/tools/tools.test.ts`; generated schemas diffed by the schema-compat lane)_

## Story 12.2 — Workflow tools (spec → analysis → approval → export → review)

**Acceptance criteria**

- [x] The full §21.1 agent workflow is executable via tools alone, on a fixture repo. _(`apps/mcp-server/src/registry.test.ts` runs init→index→submit→questions→analyze→decide→approve→export→implement→review→report)_
- [x] State-modifying tools require appropriate confirmation; ImpactGraph never silently approves an analysis or implementation (§21.1, §35). _(`approve_analysis` requires `confirmedByUser: true` in the CONTRACT — an unconfirmed call fails input validation; mutating tools say so in their descriptions)_
- [x] Authorization boundaries documented and enforced (§29.4). _(tool descriptions state mutation; the server cannot verify the human out-of-band — the confirmation assertion is the documented boundary. Steps 1–2/6/8/11 of §21.1 belong to the agent, not ImpactGraph)_

**Tasks**

- [x] Implement submit/analyze/decide/approve/export/review tools over core engines.
- [x] Implement confirmation policy for mutating tools.
- [x] End-to-end agent-simulation test executing the 13-step §21.1 workflow.

## Story 12.3 — Explanation & architecture-query tools

**Acceptance criteria**

- [x] `query_architecture` supports the queries agents need (find components, contexts, dependencies of X, dependents of X). _(query_architecture = composition summary; find_components = name/path search; dependencies/dependents of X = explain_node's outgoing/incoming edges. A richer query language stays open)_
- [x] `explain_node` / `explain_edge` return evidence, provenance, and confidence factors — mirroring the evidence panel (§18.5). _(provenance + derived knowledgeCategory + confidence signals + resolved evidence sources + snapshot/run ids)_

**Tasks**

- [x] Implement query language / parameter shape over the graph query API. _(parameter-shape tools; no free-form query language yet — deliberate)_
- [x] Implement explanation serializers. _(`workspace-engine/src/queries.ts`)_
- [x] Tests: explanations include evidence for facts vs. inferences distinctly (§3). _(contract test rejects explanations without knowledgeCategory; e2e asserts deterministic category for static-analysis facts)_
