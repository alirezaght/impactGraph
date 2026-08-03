import { analyzeDiffWithIndexer } from '../diff/analyze-diff.js';
import { addFileFact } from '../file-node.js';
import { FragmentBuilder } from '../fragment-builder.js';
import { sharedTreeSitterParsers } from '../tree-sitter/parsers.js';

import { readJsonDocument } from './json-document.js';
import { directoryOf } from './terraform-addresses.js';
import { readTerraformDocument } from './terraform-blocks.js';
import { emitTerraformFile } from './terraform-graph.js';
import { readTerraformJsonDocument } from './terraform-json.js';

import type { TerraformDocument } from './terraform-blocks.js';
import type { TerraformEmitState } from './terraform-graph.js';
import type { TreeSitterParsers } from '../tree-sitter/parsers.js';
import type {
  AnalysisContext,
  DetectionResult,
  GitDiff,
  GraphChangeSet,
  GraphFragment,
  IndexingContext,
  LanguageAdapter,
  RepositoryContext,
  RepositoryFile,
} from '../types.js';

// Story 16.1 — the Terraform language adapter (PRD §30, §15.2; ADR-0014). HCL goes in through the
// `terraform` tree-sitter grammar, PRD §12 infrastructure vocabulary comes out, and the CLI is
// never invoked: no `terraform init`, no `plan`, no provider download, no expression evaluation
// (PRD §35). An interpolation the adapter cannot resolve becomes a warning, never a guessed value.
//
// Scope: strictly per file. Terraform identity is per *directory* — `var.region` in `main.tf` is
// declared in `variables.tf`, and `module "x" { source = "./modules/x" }` names blocks in another
// directory entirely — but the indexer parses one file at a time so every result is cacheable by
// content hash (PRD §32). Cross-file relationships therefore leave here as facts on the `CallFact`
// channel and become edges in the `terraform` framework adapter, which sees the assembled graph.

// `.tf.json` and `.tfvars.json` are Terraform's own JSON syntax — the same language, a different
// spelling — and are claimed here rather than left to the fallback adapter (epic-16). The registry
// matches the longest extension suffix first, so `package.json` still reaches nobody.
const EXTENSIONS = ['.tf', '.tfvars', '.tf.json', '.tfvars.json'] as const;

const claims = (relativePath: string): boolean =>
  EXTENSIONS.some((extension) => relativePath.toLowerCase().endsWith(extension));

const isJsonSyntax = (relativePath: string): boolean =>
  relativePath.toLowerCase().endsWith('.json');

const isValuesFile = (relativePath: string): boolean =>
  /\.tfvars(\.json)?$/.test(relativePath.toLowerCase());

const isConfigFile = (path: string): boolean => path.endsWith('.tf') || path.endsWith('.tf.json');

const detectionReason = (configs: boolean, values: boolean): string => {
  if (configs) {
    return 'Terraform configuration (.tf/.tf.json) present';
  }
  return values
    ? 'Terraform variable files (.tfvars) present without any .tf configuration'
    : 'no Terraform configuration found';
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

class TerraformAdapter implements LanguageAdapter {
  public readonly id = 'terraform';
  public readonly supportedExtensions: readonly string[] = EXTENSIONS;
  private readonly parsers: TreeSitterParsers;

  public constructor(parsers: TreeSitterParsers) {
    // Constructed eagerly at composition time; the WASM runtime is not touched until the first
    // parse, so adapter construction stays free of the activation budget (PRD §33).
    this.parsers = parsers;
  }

  public detectProject(context: RepositoryContext): Promise<DetectionResult> {
    const lower = context.filePaths.map((path) => path.toLowerCase());
    const configs = lower.some(isConfigFile);
    const values = lower.some(isValuesFile);
    return Promise.resolve({
      detected: configs || values,
      reason: detectionReason(configs, values),
    });
  }

  public async indexFiles(
    files: readonly RepositoryFile[],
    context: IndexingContext,
  ): Promise<GraphFragment> {
    const builder = new FragmentBuilder(this.id);
    for (const file of files) {
      await this.indexOne(builder, file, context);
    }
    return builder.build();
  }

  /** One pathological file costs one file, never the run (PRD §32, §34, §42.5). */
  private async indexOne(
    builder: FragmentBuilder,
    file: RepositoryFile,
    context: IndexingContext,
  ): Promise<void> {
    addFileFact(builder, file, context);
    if (!claims(file.relativePath)) {
      // The registry dispatches by extension, but a caller may hand over anything. Reading
      // non-HCL content with the Terraform grammar would manufacture facts, so it stops here.
      builder.warn(file.relativePath, 'not a Terraform file — indexed at file level only');
      return;
    }
    const document = await (isJsonSyntax(file.relativePath)
      ? this.readJson(builder, file)
      : this.readHcl(builder, file));
    if (document === undefined) {
      return;
    }
    const state: TerraformEmitState = {
      builder,
      context,
      filePath: file.relativePath,
      directory: directoryOf(file.relativePath),
    };
    // Top-level `name = value` assignments are what a `.tfvars` file IS. In a `.tf` file the same
    // shape is invalid Terraform, so it is left as an unread oddity rather than turned into a
    // variable binding that the CLI would reject.
    emitTerraformFile(state, {
      blocks: document.blocks,
      assignments: isValuesFile(file.relativePath) ? document.assignments : [],
    });
  }

  private async readHcl(
    builder: FragmentBuilder,
    file: RepositoryFile,
  ): Promise<TerraformDocument | undefined> {
    let result;
    try {
      result = await this.parsers.withSyntaxTree('terraform', file.content, readTerraformDocument);
    } catch (error) {
      builder.warn(file.relativePath, `terraform parse failed, file-level: ${messageOf(error)}`);
      return undefined;
    }
    for (const warning of result.warnings) {
      builder.warn(file.relativePath, warning);
    }
    if (result.value === undefined) {
      builder.warn(file.relativePath, 'terraform parse produced no tree — file level only');
    }
    return result.value;
  }

  /**
   * Terraform's JSON syntax (epic-16), read through the `json` tree-sitter grammar that already
   * ships in the installed bundle. The HCL grammar cannot read it — it is JSON, not HCL — and
   * `JSON.parse` reports no line or column, which would leave every fact with evidence that
   * cannot be opened. A malformed or non-object document degrades to a warning and the file keeps
   * its file-level facts (PRD §34); see `json-document.ts` for why error recovery is refused here
   * rather than read through, as the HCL path does.
   */
  private async readJson(
    builder: FragmentBuilder,
    file: RepositoryFile,
  ): Promise<TerraformDocument | undefined> {
    let result;
    try {
      result = await this.parsers.withSyntaxTree('json', file.content, readJsonDocument);
    } catch (error) {
      builder.warn(file.relativePath, `terraform JSON parse failed: ${messageOf(error)}`);
      return undefined;
    }
    const document = result.value;
    if (document?.kind !== 'object') {
      const detail = result.warnings.join('; ');
      builder.warn(
        file.relativePath,
        'terraform JSON syntax must be one well-formed top-level object — file level only' +
          (detail === '' ? '' : ` (${detail})`),
      );
      return undefined;
    }
    return readTerraformJsonDocument(document);
  }

  /** Symbol-level diff analysis (PRD §24, §30) reusing this adapter's own indexer. */
  public analyzeDiff(diff: GitDiff, context: AnalysisContext): Promise<GraphChangeSet> {
    return analyzeDiffWithIndexer(diff, context, {
      adapterId: this.id,
      supportedExtensions: this.supportedExtensions,
      indexFiles: (files, indexingContext) => this.indexFiles(files, indexingContext),
    });
  }
}

/** `parsers` is injectable so a bundled host can supply its own grammar bytes (ADR-0008). */
export const createTerraformAdapter = (
  parsers: TreeSitterParsers = sharedTreeSitterParsers(),
): LanguageAdapter => new TerraformAdapter(parsers);
