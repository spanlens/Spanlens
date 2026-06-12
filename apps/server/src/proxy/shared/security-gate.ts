/**
 * Pre-flight security scan shared by all 4 proxy handlers.
 *
 * `scanAll` returns every flag (injection + PII); only injection flags
 * trigger the 422 block, and only when the project has opted in via
 * `isBlockingEnabled`. PII-only flags never block — they may be legitimate
 * customer data and the customer's own `withLogBody('none')` policy
 * controls whether they get logged at all.
 *
 * Returns the full flag set so the caller can pass it through to
 * logRequestAsync as `preComputedRequestFlags` and avoid a second scan
 * in the logger.
 */

import { ApiError } from '../../lib/errors.js'
import { scanAll, type SecurityFlag } from '../../lib/security-scan.js'
import { isBlockingEnabled } from '../utils.js'

export async function runSecurityGate(
  reqBodyJson: Record<string, unknown> | null,
  projectId: string,
): Promise<SecurityFlag[]> {
  const requestFlags = scanAll(reqBodyJson)
  const hasInjection = requestFlags.some((f) => f.type === 'injection')
  if (hasInjection && (await isBlockingEnabled(projectId))) {
    throw new ApiError(
      'INJECTION_BLOCKED',
      'Request blocked by Spanlens security policy: prompt injection detected.',
    )
  }
  return requestFlags
}
