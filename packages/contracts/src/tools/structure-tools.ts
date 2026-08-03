import { z } from 'zod';

import { componentMarkerSchema } from '../config/corrections.js';
import { configPrecedenceLevelSchema } from '../config/overlay.js';
import { customDetectionRuleSchema } from '../config/rules-config.js';

// §Z7 structure discovery + §Z8 rule testing — split from tools.ts/config-tools.ts by
// responsibility (LOC policy). Both tools are strictly read-only: they project the current
// deterministic graph or run a candidate rule in memory. Neither writes configuration.

const emptyInputSchema = z.object({}).strict();

/** One discovered package, projected from `package` nodes and their CONTAINS/CONFIGURES/EXPOSES edges. */
const packageStructureSchema = z
  .object({
    nodeId: z.string().min(1),
    name: z.string().min(1),
    /** Directory owning the manifest ('' for the repository root). */
    directory: z.string(),
    manifestPath: z.string().min(1).optional(),
    /** Conventional source roots present on disk (`directory` nodes, static-analysis). */
    sourceRoots: z.array(z.string().min(1)),
    testRoots: z.array(z.string().min(1)),
    /** Files with a CONFIGURES edge onto this package (tsconfig, Dockerfile, vite.config…). */
    buildConfigFiles: z.array(z.string().min(1)),
    /** Manifest-declared entry points that exist — the EXPOSES targets. */
    entryPoints: z.array(z.string().min(1)),
    fileCount: z.number().int().min(0),
    /**
     * §16/§Z5 read-time overlay (additive v1). `name` stays the deterministic graph name;
     * `effectiveName` reflects a committed rename, and role/context/markers the corrections that
     * apply to the package directory. Each carries the precedence level that produced it.
     */
    effectiveName: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    context: z.string().min(1).optional(),
    /** §16 committed ownership — descriptive only, never inferred, never gates anything. */
    owner: z.string().min(1).max(200).optional(),
    markers: z.array(componentMarkerSchema).optional(),
    correctionLevels: z.array(configPrecedenceLevelSchema).optional(),
  })
  .strict();

const emittedNodeSchema = z
  .object({
    id: z.string().min(1),
    category: z.string().min(1),
    type: z.string().min(1),
    name: z.string().min(1),
    path: z.string().min(1).optional(),
    provenance: z.string().min(1),
  })
  .strict();

const emittedEdgeSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    sourceId: z.string().min(1),
    targetId: z.string().min(1),
    provenance: z.string().min(1),
  })
  .strict();

export const STRUCTURE_TOOL_CONTRACTS = {
  detect_repository_structure: {
    description:
      'Deterministic, read-only summary of the repository layout projected from the CURRENT indexed graph (§15.1/§Z4): workspaces, packages, conventional source/test roots, build-configuration files (CONFIGURES edges) and manifest entry points (EXPOSES edges). Nothing is inferred and no configuration is written.',
    input: emptyInputSchema,
    output: z
      .object({
        snapshotId: z.string().min(1),
        workspaces: z.array(z.string().min(1)),
        packages: z.array(packageStructureSchema),
        totals: z
          .object({
            packages: z.number().int().min(0),
            sourceRoots: z.number().int().min(0),
            testRoots: z.number().int().min(0),
            buildConfigFiles: z.number().int().min(0),
            entryPoints: z.number().int().min(0),
          })
          .strict(),
      })
      .strict(),
  },
  test_detection_rule: {
    description:
      'Dry-run a §Z8 custom detection rule against one code snippet (or one repository-relative file) and report whether it matches and exactly which nodes/edges it would emit. The rule is NOT persisted and the graph is NOT modified — use apply_configuration_change with add-rule once the rule behaves as intended.',
    input: z
      .object({
        rule: customDetectionRuleSchema,
        /** Inline source to run the rule against. Exactly one of snippet/path is required. */
        snippet: z.string().min(1).max(20000).optional(),
        /** Repository-relative file to read instead of an inline snippet. */
        path: z.string().min(1).max(400).optional(),
        /** Virtual path reported for an inline snippet (default `snippet.ts`). */
        fileName: z.string().min(1).max(200).optional(),
      })
      .strict()
      .refine((input) => (input.snippet === undefined) !== (input.path === undefined), {
        message: 'provide exactly one of snippet or path',
      }),
    output: z
      .object({
        ruleId: z.string().min(1),
        filePath: z.string().min(1),
        matched: z.boolean(),
        detectionReason: z.string().min(1),
        wouldEmitNodes: z.array(emittedNodeSchema),
        wouldEmitEdges: z.array(emittedEdgeSchema),
        /** Per-match problems (e.g. no string argument at the configured position). */
        warnings: z.array(z.string().min(1)),
        /** Always false: this tool never writes the rule or the produced facts. */
        persisted: z.literal(false),
      })
      .strict(),
  },
} as const;
