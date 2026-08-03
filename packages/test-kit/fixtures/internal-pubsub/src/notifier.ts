import { publishTo } from '@company/messaging';

// Module-level registration through the internal wrapper (the §Z8 example pattern).
publishTo('deal-notifications', { kind: 'updated' });

export const notifierReady = true;
