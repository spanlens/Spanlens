import { sha256Hex } from './crypto.js'

/**
 * Deterministic A/B traffic routing for prompt experiments.
 *
 * Given a trace ID (or any stable request identifier) and an experiment ID,
 * derives a consistent bucket (0–99) via SHA-256 and compares it against the
 * experiment's traffic_split threshold.
 *
 * - bucket < trafficSplit → route to version_a
 * - bucket ≥ trafficSplit → route to version_b
 *
 * The same traceId always routes to the same version within a given experiment,
 * ensuring consistent behaviour across retries and multi-step agents.
 *
 * If traceId is null/empty we fall back to a random UUID so traffic is still
 * split approximately correctly but without per-request consistency.
 */
export async function routeExperimentTraffic(
  traceId: string | null | undefined,
  experimentId: string,
  trafficSplit: number, // % routed to version_a (1–99)
): Promise<'a' | 'b'> {
  const seed = traceId
    ? `${traceId}:${experimentId}`
    : `${crypto.randomUUID()}:${experimentId}`

  const hex = await sha256Hex(seed)
  // Use first 8 hex chars (32-bit value) for bucket
  const bucket = parseInt(hex.slice(0, 8), 16) % 100

  return bucket < trafficSplit ? 'a' : 'b'
}
