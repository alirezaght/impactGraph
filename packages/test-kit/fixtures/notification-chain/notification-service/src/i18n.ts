import de from '../locales/de.json';
import en from '../locales/en.json';

const bundles: Record<string, Record<string, unknown>> = { de, en };

const lookup = (bundle: Record<string, unknown>, key: string): string | undefined => {
  let current: unknown = bundle;
  for (const segment of key.split('.')) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' ? current : undefined;
};

export const t = (key: string, locale = 'en'): string => lookup(bundles[locale] ?? {}, key) ?? key;
