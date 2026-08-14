import { describe, expect, it } from 'vitest';

import { itemsOf } from './spec-items.js';

import type { SpecSection } from './spec-sections.js';

// Field feedback: bullets written as `•` or `–` were not items, so a structured list silently
// contributed nothing and the spec was misread as unstructured prose.

const section = (role: SpecSection['role'], lines: readonly string[]): SpecSection => ({
  heading: 'Requirements',
  role,
  level: 2,
  lines,
  bodyStartOffset: 0,
});

describe('itemsOf — bullet marker tolerance', () => {
  it('extracts • bullets as items', () => {
    const items = itemsOf(
      section('requirements', ['• The export includes headers.', '• The count is accurate.']),
    );
    expect(items.map((item) => item.text)).toEqual([
      'The export includes headers.',
      'The count is accurate.',
    ]);
    expect(items.every((item) => item.origin === 'bullet-item')).toBe(true);
  });

  it('extracts – and — bullets as items', () => {
    const items = itemsOf(
      section('acceptance-criteria', ['– The list excludes archived deals.', '— Works offline.']),
    );
    expect(items.map((item) => item.origin)).toEqual([
      'acceptance-criterion',
      'acceptance-criterion',
    ]);
  });

  it('joins a wrapped • item into one statement', () => {
    const items = itemsOf(
      section('requirements', [
        '• The renderer must interpolate the buyer name',
        '  into the subject.',
      ]),
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe('The renderer must interpolate the buyer name into the subject.');
  });

  it('keeps task-list detection working alongside the new markers', () => {
    const items = itemsOf(
      section('tasks', ['- [ ] Add the outbox record.', '• Publish the topic.']),
    );
    expect(items.map((item) => item.origin)).toEqual(['task-item', 'task-item']);
  });

  it('treats • exactly like - for the same content', () => {
    const dash = itemsOf(section('requirements', ['- R2: The push route must project the event.']));
    const dot = itemsOf(section('requirements', ['• R2: The push route must project the event.']));
    expect(dot).toEqual(dash);
    expect(dot).toHaveLength(1);
  });
});
