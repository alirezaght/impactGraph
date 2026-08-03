# Threat Model: <feature / subsystem — or "workspace-wide review">

_Grounding: PRD §35 (security requirements), §42.5 (security tests), §9 (privacy modes);
docs/engineering/privacy-and-security.md. Reviewed by ai-inference-privacy + product-architecture;
findings become backlog items or blockers, never silent acceptance._

- **Scope:** <what is and is not covered by this model>
- **Author / date:** <name> / <YYYY-MM-DD>

## Asset inventory

| Asset                                         | Where it lives                                           | Sensitivity                          |
| --------------------------------------------- | -------------------------------------------------------- | ------------------------------------ |
| User source code                              | analyzed repository, snippets in prompts/evidence ranges | high                                 |
| Specifications                                | JSON artifacts, MCP payloads                             | high (business intent)               |
| Secrets / API keys                            | VS Code SecretStorage only (PRD §35)                     | critical                             |
| `.impactgraph/` config + audit history (§Z12) | committed YAML / local artifacts                         | medium                               |
| SQLite index + JSON artifacts                 | workspace storage                                        | medium–high (mirrors code structure) |
| <add change-specific assets>                  | <...>                                                    | <...>                                |

## Trust boundaries

| Boundary                                       | Crossing mechanism                                | Validation                                            |
| ---------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| Extension host ↔ indexing worker/child process | IPC                                               | typed messages, schemaVersion                         |
| Extension ↔ webview                            | postMessage (contracts/webview)                   | Zod both ends, strict CSP, no remote resources        |
| Core ↔ AI provider                             | ModelProvider port (ADR-0010)                     | redaction out, Zod + node-reference validation in     |
| MCP client ↔ mcp-server                        | MCP tools (contracts/tools)                       | Zod, confirmation for state-modifying tools (PRD §35) |
| Repository content ↔ everything                | parsing only — never executed                     | untrusted-data handling (PRD §42.5)                   |
| Git CLI ↔ packages/git                         | argv arrays, never shell interpolation (ADR-0007) | <...>                                                 |

## Attack surfaces and threats

_For each: attacker goal, entry path, affected asset._

1. **Malicious repository content (PRD §42.5):** hostile file names, crafted ASTs, huge/deep
   structures → parser DoS or fact corruption. <specifics for this change>
2. **Prompt injection in comments/docs/specs:** repository or spec text instructs the model to
   exfiltrate or fabricate impacts marked as fact. <specifics>
3. **Path traversal / symlinks:** index escapes the workspace, reads `~/.ssh` etc. <specifics>
4. **Oversized files:** memory exhaustion in worker; extension host must stay unaffected. <specifics>
5. **Malicious MCP input:** hostile tool payloads — oversized, schema-abusing, state-modifying
   without confirmation, or attempting to flip privacy mode. <specifics>
6. **Hostile model output:** invalid schema, nonexistent node references, authority laundering
   (inference presented as fact — PRD §43.6). <specifics>
7. **Secret leakage:** secrets in prompts, artifacts, logs, or exported reports. <specifics>
8. <change-specific threat> — _TBD_

## Mitigations

| Threat # | Mitigation                                                                                                                    | Enforced by           | Tested in                         |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------- |
| 1        | parse-never-execute; parser failure isolation (PRD §34)                                                                       | <module>              | analyzers: malformed-repo fixture |
| 2        | untrusted-data prompt framing; evidence + node-reference validation; downgrade not promote                                    | packages/ai-inference | <test name>                       |
| 3        | path normalization + workspace-root containment; symlink policy <resolve/skip>                                                | <module>              | <test>                            |
| 4        | file-size cap <n> MB → filesystem-level evidence only                                                                         | <module>              | <test>                            |
| 5        | Zod + size limits on all tool inputs; confirmation on state-modifying tools; privacy mode never changeable by tool call alone | apps/mcp-server       | contract tests                    |
| 6        | `generateStructuredOutput` schema validation; snapshot-scoped node checks                                                     | packages/ai-inference | <test>                            |
| 7        | redaction module, `.env` exclusion, SecretStorage-only, log policy                                                            | <modules>             | unit: redaction suite             |

## Residual risks

_Accepted, with owner — an empty list is almost certainly wrong._

| Risk                                                             | Why accepted | Owner  | Revisit trigger |
| ---------------------------------------------------------------- | ------------ | ------ | --------------- |
| <e.g. redaction is pattern-based; novel secret formats can pass> | <...>        | <name> | <...>           |

## Review date

- Reviewed: <YYYY-MM-DD> by <names/agents>
- Next review due: <YYYY-MM-DD or trigger: new adapter, new MCP tool, new provider, first external report>
