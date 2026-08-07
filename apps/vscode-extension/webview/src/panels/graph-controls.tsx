import { STRUCTURE_VIEWS } from '../graph/proposed.js';

import type { GraphFilters, GroupBy } from '../graph/filters.js';
import type { StructureView } from '../graph/proposed.js';
import type { JSX } from 'react';

// §18.4 controls: search, filter by impact type / confidence / likelihood / inferred-only /
// direct-vs-indirect / hide-unchanged, and the grouping switch. Every control is a labelled form
// element, so keyboard and screen-reader users reach the same capabilities (§37).

interface Props {
  readonly filters: GraphFilters;
  readonly impactTypes: readonly string[];
  /** ADR-0015: bases present in the data. Empty = the analysis reported none = no facet. */
  readonly evidenceTypes: readonly string[];
  readonly onChange: (filters: GraphFilters) => void;
}

const LIKELIHOODS = ['required', 'likely', 'possible', 'unlikely'] as const;
const GROUPINGS: readonly { value: GroupBy; label: string }[] = [
  { value: 'context', label: 'Context' },
  { value: 'application', label: 'Application' },
  { value: 'requirement', label: 'Requirement' },
  { value: 'impact-type', label: 'Impact type' },
  { value: 'likelihood', label: 'Likelihood' },
  { value: 'knowledge', label: 'Knowledge category' },
];

const toggle = (values: readonly string[], value: string): string[] =>
  values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];

const CheckboxSet = ({
  legend,
  idPrefix,
  options,
  selected,
  onToggle,
}: {
  readonly legend: string;
  readonly idPrefix: string;
  readonly options: readonly string[];
  readonly selected: readonly string[];
  readonly onToggle: (value: string) => void;
}): JSX.Element => (
  <fieldset>
    <legend>{legend}</legend>
    {options.map((option) => (
      <label key={option} htmlFor={`${idPrefix}-${option}`}>
        <input
          id={`${idPrefix}-${option}`}
          type="checkbox"
          checked={selected.includes(option)}
          onChange={() => {
            onToggle(option);
          }}
        />
        {option}
      </label>
    ))}
  </fieldset>
);

const Toggle = ({
  id,
  label,
  checked,
  onToggle,
}: {
  readonly id: string;
  readonly label: string;
  readonly checked: boolean;
  readonly onToggle: () => void;
}): JSX.Element => (
  <label htmlFor={id}>
    <input id={id} type="checkbox" checked={checked} onChange={onToggle} />
    {label}
  </label>
);

const SearchAndScale = ({
  filters,
  onChange,
}: Pick<Props, 'filters' | 'onChange'>): JSX.Element => (
  <>
    <label htmlFor="graph-search">Search nodes</label>
    <input
      id="graph-search"
      type="search"
      value={filters.search}
      onChange={(event) => {
        onChange({ ...filters, search: event.target.value });
      }}
    />
    <label htmlFor="graph-confidence">Minimum confidence: {filters.minConfidence.toFixed(2)}</label>
    <input
      id="graph-confidence"
      type="range"
      min={0}
      max={1}
      step={0.05}
      value={filters.minConfidence}
      onChange={(event) => {
        onChange({ ...filters, minConfidence: Number(event.target.value) });
      }}
    />
  </>
);

const Selectors = ({ filters, onChange }: Pick<Props, 'filters' | 'onChange'>): JSX.Element => (
  <>
    <label htmlFor="graph-directness">Directness</label>
    <select
      id="graph-directness"
      value={filters.directness}
      onChange={(event) => {
        onChange({ ...filters, directness: event.target.value as GraphFilters['directness'] });
      }}
    >
      <option value="all">Direct and indirect</option>
      <option value="direct">Direct only</option>
      <option value="indirect">Indirect only</option>
    </select>
    {/* §18.4 current-vs-proposed. Defaults to both so the two halves can be diffed, never merged. */}
    <label htmlFor="graph-structure">Current vs proposed structure</label>
    <select
      id="graph-structure"
      value={filters.structure}
      onChange={(event) => {
        onChange({ ...filters, structure: event.target.value as StructureView });
      }}
    >
      {STRUCTURE_VIEWS.map((view) => (
        <option key={view.value} value={view.value}>
          {view.label}
        </option>
      ))}
    </select>
    <label htmlFor="graph-grouping">Group by</label>
    <select
      id="graph-grouping"
      value={filters.groupBy}
      onChange={(event) => {
        onChange({ ...filters, groupBy: event.target.value as GroupBy });
      }}
    >
      {GROUPINGS.map((grouping) => (
        <option key={grouping.value} value={grouping.value}>
          {grouping.label}
        </option>
      ))}
    </select>
  </>
);

export const GraphControls = ({
  filters,
  impactTypes,
  evidenceTypes,
  onChange,
}: Props): JSX.Element => (
  <form className="graph-controls" aria-label="Graph filters and grouping">
    <SearchAndScale filters={filters} onChange={onChange} />
    <Selectors filters={filters} onChange={onChange} />
    <CheckboxSet
      legend="Likelihood"
      idPrefix="likelihood"
      options={LIKELIHOODS}
      selected={filters.likelihoods}
      onToggle={(value) => {
        onChange({ ...filters, likelihoods: toggle(filters.likelihoods, value) });
      }}
    />
    <CheckboxSet
      legend="Impact type"
      idPrefix="impact-type"
      options={impactTypes}
      selected={filters.impactTypes}
      onToggle={(value) => {
        onChange({ ...filters, impactTypes: toggle(filters.impactTypes, value) });
      }}
    />
    {/* ADR-0015 evidence-basis facet: WHY an impact was selected, from the closed vocabulary.
        Only the bases present in the data are offered; none checked = all shown. */}
    {evidenceTypes.length === 0 ? null : (
      <CheckboxSet
        legend="Evidence basis"
        idPrefix="evidence-basis"
        options={evidenceTypes}
        selected={filters.evidenceTypes}
        onToggle={(value) => {
          onChange({ ...filters, evidenceTypes: toggle(filters.evidenceTypes, value) });
        }}
      />
    )}
    <Toggle
      id="graph-inferred-only"
      label="Show AI-inferred impacts only"
      checked={filters.inferredOnly}
      onToggle={() => {
        onChange({ ...filters, inferredOnly: !filters.inferredOnly });
      }}
    />
    <Toggle
      id="graph-hide-unchanged"
      label="Hide unchanged architecture (dependency-path hops)"
      checked={filters.hideUnchanged}
      onToggle={() => {
        onChange({ ...filters, hideUnchanged: !filters.hideUnchanged });
      }}
    />
  </form>
);
