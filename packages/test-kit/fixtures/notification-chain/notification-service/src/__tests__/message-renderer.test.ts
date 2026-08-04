import { renderMessage } from '../message-renderer.js';

// Test coupling the trials said went unreported: a wording change breaks this assertion.
export const testRendersSellerName = (): void => {
  const rendered = renderMessage({ sellerName: 'Acme GmbH' });
  if (!rendered.includes('Acme GmbH')) {
    throw new Error('the seller name must appear in the body');
  }
};
