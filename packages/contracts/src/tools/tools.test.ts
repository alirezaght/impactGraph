import { describe, expect, it } from 'vitest';

import { MCP_TOOL_CONTRACTS, MCP_TOOL_NAMES } from './tools.js';

describe('MCP tool contracts (Story 12.1, PRD §21/§29.4/§35)', () => {
  it('covers exactly the §21 tool roster', () => {
    expect([...MCP_TOOL_NAMES].sort()).toEqual(
      [
        'initialize_workspace',
        'get_workspace_status',
        'index_workspace',
        'submit_specification',
        'get_specification',
        'extract_requirements',
        'get_open_questions',
        'answer_open_question',
        'analyze_impact',
        // Item 9 of the trial follow-up: analyze_impact returns a bounded summary, and this is
        // the paginated detail page it points at.
        'list_impacts',
        // Item 12: record what an implementation actually touched and measure the prediction.
        'record_actual_impact',
        'get_impact_analysis',
        'update_impact_decision',
        'approve_analysis',
        'export_implementation_context',
        'review_implementation',
        'get_review_report',
        'query_architecture',
        'explain_node',
        'explain_edge',
        'find_components',
        // ADR-0017 — the governance and runtime layers, readable directly because a reviewer told
        // a plan is BLOCKED needs to open the rule that blocked it.
        'list_constraints',
        // The explicit red-team view: the FULL persisted finding list behind the bounded
        // analyze_impact summary, with what was checked. Analysis red-teams unconditionally;
        // this is where the complete case lives.
        'list_preflight_findings',
        'query_runtime_path',
        // Structural reference queries over existing index data — born from a session where
        // "who implements X / who calls Y / where else is this SQL fragment" needed grep.
        'find_references',
        'search_literals',
        'preview_configuration_change',
        'apply_configuration_change',
        'rollback_configuration_change',
        'restore_configuration_version',
        'detect_stack',
        'generate_configuration',
        'apply_natural_language_instruction',
        'get_configuration_warnings',
        'get_configuration_history',
        'select_architectural_option',
        'accept_review_deviation',
        'detect_repository_structure',
        'get_configuration',
        'validate_configuration',
        'explain_configuration',
        'refresh_configuration',
        'confirm_configuration_value',
        'apply_component_correction',
        'remove_stale_configuration',
        'test_detection_rule',
        'export_graph_html',
      ].sort(),
    );
  });

  it('every tool has a description and strict-ish input validation', () => {
    for (const name of MCP_TOOL_NAMES) {
      const contract = MCP_TOOL_CONTRACTS[name];
      expect(contract.description.length, name).toBeGreaterThan(10);
      // unknown keys on inputs are rejected — external payloads parse strictly
      const polluted = contract.input.safeParse({ __proto__polluted: true, unknownKey: 1 });
      expect(polluted.success, `${name} must reject unknown input keys`).toBe(false);
    }
  });

  it('approve_analysis encodes the §35 confirmation semantics in the contract', () => {
    const { input } = MCP_TOOL_CONTRACTS.approve_analysis;
    expect(input.safeParse({ analysisId: 'a-1', confirmedByUser: true }).success).toBe(true);
    expect(input.safeParse({ analysisId: 'a-1' }).success).toBe(false);
    expect(input.safeParse({ analysisId: 'a-1', confirmedByUser: false }).success).toBe(false);
  });

  it('the decision tools encode §35 confirmation semantics in the contract', () => {
    const select = MCP_TOOL_CONTRACTS.select_architectural_option.input;
    expect(
      select.safeParse({ analysisId: 'a-1', optionId: 'option:x', confirmedByUser: true }).success,
    ).toBe(true);
    expect(select.safeParse({ analysisId: 'a-1', optionId: 'option:x' }).success).toBe(false);

    const accept = MCP_TOOL_CONTRACTS.accept_review_deviation.input;
    expect(
      accept.safeParse({ nodeId: 'sym:x', reason: 'intentional', confirmedByUser: true }).success,
    ).toBe(true);
    expect(accept.safeParse({ nodeId: 'sym:x', reason: 'intentional' }).success).toBe(false);
    // only genuine discrepancies (§24.1) are acceptable — 'matched' is not a deviation
    expect(
      accept.safeParse({
        nodeId: 'sym:x',
        category: 'matched',
        reason: 'x',
        confirmedByUser: true,
      }).success,
    ).toBe(false);
  });

  it('the §Z5/§Z10 maintenance tools encode §35 confirmation semantics in the contract', () => {
    const confirm = MCP_TOOL_CONTRACTS.confirm_configuration_value.input;
    const value = { subjectKind: 'alias' as const, subject: 'deal', reason: 'reviewed by hand' };
    expect(confirm.safeParse({ ...value, confirmedByUser: true }).success).toBe(true);
    expect(confirm.safeParse(value).success).toBe(false);
    expect(confirm.safeParse({ ...value, confirmedByUser: false }).success).toBe(false);
    // the subject vocabulary is closed — an unknown kind cannot be confirmed
    expect(
      confirm.safeParse({ ...value, subjectKind: 'anything', confirmedByUser: true }).success,
    ).toBe(false);

    const remove = MCP_TOOL_CONTRACTS.remove_stale_configuration.input;
    expect(remove.safeParse({ confirmedByUser: true }).success).toBe(true);
    expect(remove.safeParse({}).success).toBe(false);
  });

  it('apply_component_correction requires confirmation and only accepts §16 corrections', () => {
    const { input, output } = MCP_TOOL_CONTRACTS.apply_component_correction;
    const correction = {
      kind: 'set-component-role' as const,
      path: 'src/deals/**',
      role: 'domain',
      reason: 'domain layer',
    };
    expect(input.safeParse({ correction, confirmedByUser: true }).success).toBe(true);
    expect(input.safeParse({ correction }).success).toBe(false);
    // a non-correction operation must go through apply_configuration_change, not this tool
    expect(
      input.safeParse({
        correction: { kind: 'add-ignore', glob: 'dist/**', reason: 'build output' },
        confirmedByUser: true,
      }).success,
    ).toBe(false);
    // the tool only ever writes human-confirmed records (§Z5 level 1)
    expect(
      output.safeParse({
        rollbackId: 'cfg-1',
        file: 'architecture.yml',
        kind: 'set-component-role',
        source: 'agent-approved',
      }).success,
    ).toBe(false);
  });

  it('test_detection_rule requires exactly one source and never reports a persisted rule', () => {
    const { input, output } = MCP_TOOL_CONTRACTS.test_detection_rule;
    const rule = {
      id: 'pubsub',
      language: 'typescript' as const,
      match: { imports: ['@company/messaging'], decorators: ['Subscribe'] },
      produces: { nodeCategory: 'integration', nodeType: 'subscription' },
    };
    expect(input.safeParse({ rule, snippet: 'export const x = 1;' }).success).toBe(true);
    expect(input.safeParse({ rule, path: 'src/a.ts' }).success).toBe(true);
    // neither, or both, is ambiguous — the contract rejects it before the handler runs
    expect(input.safeParse({ rule }).success).toBe(false);
    expect(input.safeParse({ rule, snippet: 'x', path: 'src/a.ts' }).success).toBe(false);
    // §Z13: an import matcher with a wildcard is too broad to dry-run
    expect(
      input.safeParse({
        rule: { ...rule, match: { imports: ['@company/*'], decorators: ['Subscribe'] } },
        snippet: 'x',
      }).success,
    ).toBe(false);

    const dryRun = {
      ruleId: 'pubsub',
      filePath: 'snippet.ts',
      matched: false,
      detectionReason: 'no custom detection rule matched',
      wouldEmitNodes: [],
      wouldEmitEdges: [],
      warnings: [],
      persisted: false,
    };
    expect(output.safeParse(dryRun).success).toBe(true);
    expect(output.safeParse({ ...dryRun, persisted: true }).success).toBe(false);
  });

  it('update_impact_decision only accepts the closed decision taxonomy', () => {
    const { input } = MCP_TOOL_CONTRACTS.update_impact_decision;
    const base = { analysisId: 'a-1', requirementId: 'req-1', nodeId: 'sym:x' };
    expect(input.safeParse({ ...base, decision: 'rejected' }).success).toBe(true);
    expect(input.safeParse({ ...base, decision: 'maybe' }).success).toBe(false);
  });

  it('explanation outputs always carry provenance AND derived knowledge category (§3)', () => {
    const knowledge = {
      provenance: 'static-analysis',
      knowledgeCategory: 'deterministic',
      confidence: 1,
      confidenceSignals: [{ type: 'direct-observation', contribution: 1 }],
      evidence: [{ id: 'ev-1', source: 'src/a.ts' }],
      repositorySnapshotId: 'snap-1',
      analysisRunId: 'run-1',
    };
    const node = {
      nodeId: 'sym:a',
      name: 'A',
      category: 'application',
      type: 'service',
      knowledge,
      incomingEdges: [],
      outgoingEdges: [],
    };
    expect(MCP_TOOL_CONTRACTS.explain_node.output.safeParse(node).success).toBe(true);
    const { knowledgeCategory, ...withoutCategory } = knowledge;
    void knowledgeCategory;
    expect(
      MCP_TOOL_CONTRACTS.explain_node.output.safeParse({ ...node, knowledge: withoutCategory })
        .success,
    ).toBe(false);
  });

  it('review tools reuse the exact CLI review schema — no diverging near-duplicate', () => {
    expect(MCP_TOOL_CONTRACTS.review_implementation.output).toBe(
      MCP_TOOL_CONTRACTS.get_review_report.output,
    );
  });
});

describe('review baseline inputs (PRD §24/§40.3)', () => {
  it('review tools encode the unapproved-baseline opt-in like the §35 confirmation idiom', () => {
    for (const name of ['review_implementation', 'get_review_report'] as const) {
      const { input } = MCP_TOOL_CONTRACTS[name];
      // additive: the v1 shapes keep parsing
      expect(input.safeParse({}).success, name).toBe(true);
      expect(input.safeParse({ target: 'working-tree' }).success, name).toBe(true);
      // the opt-in is stated, never defaulted — only the literal `true` parses
      expect(
        input.safeParse({ analysisId: 'a-1', allowUnapprovedBaseline: true }).success,
        name,
      ).toBe(true);
      expect(input.safeParse({ allowUnapprovedBaseline: false }).success, name).toBe(false);
      expect(input.safeParse({ analysisId: '' }).success, name).toBe(false);
    }
  });
});
