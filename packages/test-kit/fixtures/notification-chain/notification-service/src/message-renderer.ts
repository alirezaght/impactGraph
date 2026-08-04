import { t } from './i18n.js';

// The rendering path the trial's specification was actually about. The subject line comes from a
// locale bundle, so a change to the wording is a change to `locales/*.json` — an artifact that is
// not code and was previously invisible to the analysis.
export const renderMessage = (payload: Record<string, unknown>): string => {
  const subject = t('nda.signature_request.subject');
  const body = t('nda.signature_request.body');
  return `${subject}\n${body.replace('{sellerName}', String(payload['sellerName'] ?? ''))}`;
};
