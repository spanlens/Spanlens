/**
 * Thrown by `pgStream` (lib/postgres.ts) when every streaming-cursor slot on
 * this instance is already in use.
 *
 * A cursor paced by its consumer holds a connection for as long as the
 * download takes, so cursors get their own small pool rather than competing
 * with request logging and dashboard reads for the shared one. When that pool
 * is full the stream fails at once instead of queueing for a connection:
 * queueing would only turn into a checkout timeout ten seconds later, and a
 * route can answer "try again shortly" right away.
 *
 * Kept in its own dependency-free module so route code can recognise the
 * error without importing lib/postgres.ts, which ESLint keeps inside lib/.
 */
export class PgStreamBusyError extends Error {
  constructor(readonly limit: number) {
    super(`All ${limit} streaming cursor slot(s) on this instance are in use`)
    this.name = 'PgStreamBusyError'
  }
}

/**
 * Name-based as well as `instanceof`, so a test double or a second copy of
 * this module (a mocked import graph) is still recognised.
 */
export function isPgStreamBusyError(value: unknown): value is PgStreamBusyError {
  return value instanceof Error && value.name === 'PgStreamBusyError'
}
