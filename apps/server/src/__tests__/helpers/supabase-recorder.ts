/**
 * Recording stand-in for `supabaseAdmin`, for router tests that need to see
 * WHAT the handler asked the database, not just what it got back.
 *
 * It follows the supabase-js contract that matters most for these tests:
 * a failed query RESOLVES to `{ data: null, error }`, it never rejects. A mock
 * that throws instead would hide every "forgot to check `error`" bug, which is
 * exactly the class of defect the membership fixes were about.
 *
 * Usage (the factory import keeps one shared instance across the mock and the
 * test body):
 *
 *   vi.mock('../lib/db.js', async () => {
 *     const { recorder } = await import('./helpers/supabase-recorder.js')
 *     return { supabaseAdmin: recorder.client, supabaseClient: recorder.client }
 *   })
 *   import { recorder } from './helpers/supabase-recorder.js'
 *
 * Every `from(table)` chain is recorded as a list of `{ method, args }`, and
 * its awaited result is the next value queued for that table (default
 * `{ data: null, error: null }`). `rpc(fn, args)` works the same way per
 * function name.
 */

import { vi } from 'vitest'

export interface DbResult {
  data: unknown
  error: unknown
  count?: number | null
}

export interface RecordedOp {
  method: string
  args: unknown[]
}

export interface RecordedQuery {
  table: string
  ops: RecordedOp[]
}

export interface RecordedRpc {
  fn: string
  args: unknown
}

const EMPTY: DbResult = { data: null, error: null }

function createRecorder() {
  const queries: RecordedQuery[] = []
  const rpcCalls: RecordedRpc[] = []
  const tableQueues = new Map<string, DbResult[]>()
  const rpcQueues = new Map<string, DbResult[]>()

  function shift(queues: Map<string, DbResult[]>, key: string): DbResult {
    return queues.get(key)?.shift() ?? EMPTY
  }

  function makeBuilder(table: string): unknown {
    const query: RecordedQuery = { table, ops: [] }
    queries.push(query)
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            return (resolve: (v: DbResult) => unknown, reject?: (e: unknown) => unknown) =>
              Promise.resolve(shift(tableQueues, table)).then(resolve, reject)
          }
          return (...args: unknown[]) => {
            query.ops.push({ method: String(prop), args })
            return proxy
          }
        },
      },
    )
    return proxy
  }

  const listUsers = vi.fn(async () => ({ data: { users: [] as unknown[] }, error: null }))

  const client = {
    from: (table: string) => makeBuilder(table),
    rpc: async (fn: string, args?: unknown) => {
      rpcCalls.push({ fn, args })
      return shift(rpcQueues, fn)
    },
    auth: { admin: { listUsers } },
  }

  return {
    client,
    queries,
    rpcCalls,
    listUsers,
    /** Queue results for the next awaited `from(table)` chains, in order. */
    queue(table: string, ...results: DbResult[]): void {
      tableQueues.set(table, [...(tableQueues.get(table) ?? []), ...results])
    },
    /** Queue results for the next `rpc(fn)` calls, in order. */
    queueRpc(fn: string, ...results: DbResult[]): void {
      rpcQueues.set(fn, [...(rpcQueues.get(fn) ?? []), ...results])
    },
    /** Recorded chains against one table. */
    queriesFor(table: string): RecordedQuery[] {
      return queries.filter((q) => q.table === table)
    },
    reset(): void {
      queries.length = 0
      rpcCalls.length = 0
      tableQueues.clear()
      rpcQueues.clear()
      listUsers.mockClear()
    },
  }
}

export const recorder = createRecorder()

/** True when the chain used `method` at least once. */
export function usedMethod(query: RecordedQuery, method: string): boolean {
  return query.ops.some((op) => op.method === method)
}
