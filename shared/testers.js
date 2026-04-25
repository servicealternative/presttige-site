/**
 * TODO (follow-up when source lands):
 * - add tester guard to the missing Stripe checkout session-creation lambda
 * - add tester guard to the missing Stripe Connect split routing logic
 * - visual dark-page follow-up audit (deferred from commit
 *   `feat(visual): migrate remaining funnel pages to ivory + tighten typography`):
 *   - /privacy/index.html
 *   - /terms/index.html
 *   - /cookies/index.html
 *   - /confirm.html
 *   - /cancel.html
 *   - /success.html
 *
 * Active production lambdas in this repository are Python and currently import
 * `shared/testers.py`. This JS mirror is reserved for future Node-based server
 * handlers so the tester list remains centralized under `/shared`.
 */

export const TESTER_EMAILS = ['antoniompereira@me.com'];

export const isTesterEmail = (email = '') =>
  TESTER_EMAILS.includes(String(email).toLowerCase().trim());
