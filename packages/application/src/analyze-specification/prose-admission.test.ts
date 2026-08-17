import { describe, expect, it } from 'vitest';

import { admissionConfidence, admitProse, classifyStatement } from './prose-admission.js';
import { splitSections } from './spec-sections.js';

// The per-statement requirement classifier (ratified direction change): interpret ordinary
// structured technical prose, admitting normative statements and EXPOSING uncertainty instead of
// inventing requirements. Every rule here is deterministic and explainable.

describe('classifyStatement — admission', () => {
  it('admits normative modality', () => {
    expect(classifyStatement('The engine must stop assigning high confidence.')).toBe(
      'requirement',
    );
    expect(classifyStatement('Structural evidence should outrank lexical evidence.')).toBe(
      'requirement',
    );
    expect(classifyStatement('The exporter shall include the breakdown.')).toBe('requirement');
    expect(classifyStatement('The index needs to refresh after every commit.')).toBe('requirement');
    expect(classifyStatement('Every write is required to be atomic.')).toBe('requirement');
  });

  it('admits imperative head verbs', () => {
    expect(classifyStatement('Add an index to the deals table.')).toBe('requirement');
    expect(classifyStatement('Cap the retry count at five.')).toBe('requirement');
    expect(classifyStatement('Rename the legacy exporter module.')).toBe('requirement');
  });

  it('admits "will" statements at reduced confidence', () => {
    expect(classifyStatement('The scheduler will skip disabled tenants.')).toBe('requirement');
    expect(admissionConfidence('The scheduler will skip disabled tenants.')).toBeLessThan(
      admissionConfidence('The scheduler must skip disabled tenants.'),
    );
  });

  it('a strong modal outranks a rationale clause in the same sentence', () => {
    expect(
      classifyStatement('The engine must stop ranking lexical matches first because it misleads.'),
    ).toBe('requirement');
  });
});

describe('classifyStatement — demotion', () => {
  it('demotes present-state narration', () => {
    expect(
      classifyStatement('Path resolution today anchors spec paths at the workspace root.'),
    ).toBe('non-requirement');
    expect(classifyStatement('The importer currently retries forever.')).toBe('non-requirement');
  });

  it('demotes past-tense narration and rationale', () => {
    expect(classifyStatement('This has been a support burden since March.')).toBe(
      'non-requirement',
    );
    expect(classifyStatement('The matcher was originally built for one repository.')).toBe(
      'non-requirement',
    );
    expect(classifyStatement('For example, the exporter fails on empty graphs.')).toBe(
      'non-requirement',
    );
  });

  it('demotes questions and meta-document narration', () => {
    expect(classifyStatement('Is the cache shared between tenants?')).toBe('non-requirement');
    expect(classifyStatement('This document will describe the rollout.')).toBe('non-requirement');
  });
});

describe('classifyStatement — uncertainty', () => {
  it('leaves plain declaratives uncertain instead of inventing a requirement', () => {
    expect(classifyStatement('The banner appears after login.')).toBe('uncertain');
    expect(classifyStatement('Ranking changes apply to the HTML export as well.')).toBe(
      'uncertain',
    );
  });
});

describe('admitProse — section roles', () => {
  it('holds background/context sections to the strong-modal bar, without question spam', () => {
    const admission = admitProse(
      splitSections(
        '## Background\n\nThe legacy-path-resolver handles all lookups. The cache misses often.\nThe fallback must remain available offline.\n',
      ),
    );
    expect(admission.requirements.map((draft) => draft.statement)).toEqual([
      'The fallback must remain available offline.',
    ]);
    expect(admission.questions).toEqual([]);
    expect(admission.uncertainCount).toBe(0);
  });

  it('routes uncertain goal statements to open questions AND ambiguous notes', () => {
    const admission = admitProse(splitSections('## Goals\n\nThe banner appears after login.\n'));
    expect(admission.requirements).toEqual([]);
    expect(admission.uncertainCount).toBe(1);
    expect(admission.questions[0]?.question).toContain('The banner appears after login.');
    expect(admission.questions[0]?.severity).toBe('minor');
    expect(admission.notes.some((note) => note.kind === 'ambiguous')).toBe(true);
  });

  it('never admits non-goal or open-question statements', () => {
    const admission = admitProse(
      splitSections(
        '## Non-goals\n\nSMS delivery must wait.\n\n## Open questions\n\nThe queue must be sized.\n',
      ),
    );
    expect(admission.requirements).toEqual([]);
    expect(admission.questions).toEqual([]);
  });

  it('stamps admitted statements with prose-modal origin and a confidence', () => {
    const admission = admitProse(
      splitSections('## Goals\n\nThe `DealService` must filter expired deals.\n'),
    );
    expect(admission.requirements[0]?.origin).toBe('prose-modal');
    expect(admission.requirements[0]?.extractionConfidence).toBeGreaterThan(0);
    expect(admission.requirements[0]?.concepts).toContain('DealService');
  });
});
