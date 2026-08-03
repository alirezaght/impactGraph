// Text helpers for the HTML/SVG graph export. Everything here is locale-independent on purpose:
// `toLocaleString` would make the output depend on the machine's locale and break the golden.

const XML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape for both HTML text/attribute content and SVG. Applied to every interpolated value. */
export const escapeXml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => XML_ESCAPES[character] ?? character);

/** `3340` → `3,340`. Hand-rolled so the grouping never varies with the host locale. */
export const formatCount = (value: number): string => {
  const digits = Math.trunc(Math.abs(value)).toString();
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end));
  }
  return `${value < 0 ? '-' : ''}${groups.join(',')}`;
};

/** Clip to a character budget with an ellipsis — SVG text does not wrap or ellipsize itself. */
export const clip = (value: string, maxChars: number): string =>
  value.length <= maxChars ? value : `${value.slice(0, Math.max(1, maxChars - 1))}…`;

export const plural = (count: number, singular: string): string =>
  `${formatCount(count)} ${singular}${count === 1 ? '' : 's'}`;
