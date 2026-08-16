import { describe, expect, it } from 'vitest';

import { extractConfigDeclarations } from './extract-config-declarations.js';

describe('extractConfigDeclarations', () => {
  it('reads a Python environ.get whose default resolves to a same-file class attribute', () => {
    const content = [
      'import json',
      'import os',
      '',
      'class Settings:',
      '    SENDGRID_TEMPLATE_IDS_JSON = "{}"',
      '',
      '    def sendgrid_template_ids(self) -> dict:',
      '        raw = os.environ.get("SENDGRID_TEMPLATE_IDS_JSON", self.SENDGRID_TEMPLATE_IDS_JSON)',
      '        return json.loads(raw)',
    ].join('\n');
    const declarations = extractConfigDeclarations({
      name: 'SENDGRID_TEMPLATE_IDS_JSON',
      filePath: 'services/newsletter-service/settings.py',
      content,
      evidenceIds: ['ev-1'],
    });
    expect(declarations).toHaveLength(1);
    expect(declarations[0]?.defaultLiteral).toBe('"{}"');
    expect(declarations[0]?.toleratesAbsence).toBe(true);
  });

  it('reads a literal environ.get default directly', () => {
    const declarations = extractConfigDeclarations({
      name: 'RETRY_LIMIT',
      filePath: 'app.py',
      content: 'limit = os.environ.get("RETRY_LIMIT", "5")',
      evidenceIds: [],
    });
    expect(declarations[0]?.defaultLiteral).toBe('"5"');
    expect(declarations[0]?.toleratesAbsence).toBe(true);
  });

  it('treats a bracket read as required', () => {
    const declarations = extractConfigDeclarations({
      name: 'DATABASE_URL',
      filePath: 'app.py',
      content: 'url = os.environ["DATABASE_URL"]',
      evidenceIds: [],
    });
    expect(declarations).toHaveLength(1);
    expect(declarations[0]?.defaultLiteral).toBeUndefined();
    expect(declarations[0]?.toleratesAbsence).toBeUndefined();
  });

  it('reads a TypeScript process.env fallback', () => {
    const declarations = extractConfigDeclarations({
      name: 'NEWSLETTER_SERVICE_URL',
      filePath: 'apps/admin/src/newsletter-client.ts',
      content: "const base = process.env.NEWSLETTER_SERVICE_URL ?? '';",
      evidenceIds: [],
    });
    expect(declarations[0]?.defaultLiteral).toBe("''");
    expect(declarations[0]?.toleratesAbsence).toBe(true);
  });

  it('says nothing about shapes it cannot read', () => {
    const declarations = extractConfigDeclarations({
      name: 'DYNAMIC_KEY',
      filePath: 'app.py',
      content: 'value = resolve_config(build_key("DYNAMIC_KEY"))',
      evidenceIds: [],
    });
    expect(declarations).toHaveLength(0);
  });

  it('emits one declaration per file, preferring the read shape over the bare assignment', () => {
    const content = ['LIMIT = "10"', 'value = os.environ.get("LIMIT", LIMIT)'].join('\n');
    const declarations = extractConfigDeclarations({
      name: 'LIMIT',
      filePath: 'settings.py',
      content,
      evidenceIds: [],
    });
    expect(declarations).toHaveLength(1);
    expect(declarations[0]?.toleratesAbsence).toBe(true);
    expect(declarations[0]?.defaultLiteral).toBe('"10"');
  });
});
