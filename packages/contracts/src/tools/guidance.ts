/**
 * Server-level workflow guidance, sent in the MCP `initialize` response (`instructions`).
 *
 * The tools work in any order, but a partial index produces a partial answer that LOOKS complete —
 * so the expected workflow is stated once, here, instead of being left for the agent to infer.
 * ImpactGraph detects insufficient coverage itself; the agent's job is to follow `requiredActions`,
 * never to guess whether the graph is complete.
 */
export const MCP_SERVER_INSTRUCTIONS = `ImpactGraph builds an evidence-backed impact model of a specification against a locally indexed repository workspace. Follow this workflow:

1. Validate workspace coverage: call get_workspace_status. Check that the workspace is initialized and indexed, that every registered repository (\`repositories:\` in .impactgraph/config.yml) is indexed, and whether candidateRepositories lists discovered-but-unregistered repositories. Candidates are never indexed automatically — ask the user to confirm and register them.
2. Index relevant repositories: call index_workspace. It indexes the workspace root and every registered, present, enabled repository into one knowledge graph. Register additional repositories (inside the workspace root) before indexing when the feature spans them.
3. Verify central concepts resolve: use find_components for the specification's key services, contracts and components. If the central concepts resolve to nothing, the relevant repositories are probably not indexed — fix coverage before analyzing.
4. Run the analysis: submit_specification, then analyze_impact. Read workspaceCoverage and requiredActions first: when workspaceCoverage.status is 'insufficient-coverage', the readiness score is withheld and the impacts are NOT a complete answer — follow the requiredActions (index or register repositories, confirm candidates, refresh a stale index) and re-run, instead of presenting a partial result.
5. Present limitations when complete coverage is impossible: report which repositories were indexed, which were missing or unavailable, and which requirements or concepts depend on them (workspaceCoverage.repositories, affectedRequirementIds, affectedConcepts, impactQuery.limitations). A 'report-limited-scope' action means: stop and tell the user the analysis is scoped to the indexed repositories.

Never treat an analysis with insufficient coverage as the best available answer, and never approve an analysis without explicit human confirmation.`;
