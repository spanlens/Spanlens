/**
 * A tiny in-memory stand-in for the supabase-js query builder, covering only
 * the fluent shapes the auth/org/member routes use:
 *
 *   from(t).select(cols, { count, head }?).eq().order().limit().maybeSingle()
 *   from(t).insert(row).select(cols).single()      (or awaited directly)
 *   from(t).update(patch).eq().eq().select().single()
 *   from(t).delete().eq().eq()
 *
 * It follows the real client's contract where it matters for tests: failures
 * RESOLVE with `{ data: null, error }` (supabase-js never rejects), a
 * `maybeSingle()` that matches 2+ rows resolves with an error, and `single()`
 * requires exactly one row. Rows are plain objects; state lives in `tables`
 * so a test can seed and inspect it directly.
 */

type Row = Record<string, unknown>
type Op = 'select' | 'insert' | 'update' | 'delete'

export interface QueryResult {
  data: unknown
  error: { message: string } | null
  count?: number | null
}

export interface InMemoryDb {
  tables: Record<string, Row[]>
  from: (table: string) => QueryBuilder
  reset: () => void
}

let rowSeq = 0

/** Monotonic ISO timestamp so `order('created_at')` is deterministic. */
function nextCreatedAt(): string {
  rowSeq += 1
  return new Date(Date.UTC(2026, 0, 1, 0, 0, rowSeq)).toISOString()
}

const TABLE_DEFAULTS: Record<string, () => Row> = {
  organizations: () => ({ plan: 'free', updated_at: nextCreatedAt() }),
}

class QueryBuilder implements PromiseLike<QueryResult> {
  private op: Op = 'select'
  private payload: Row | Row[] | null = null
  private readonly filters: Array<[string, unknown]> = []
  private orderBy: { col: string; ascending: boolean } | null = null
  private limitN: number | null = null
  private countOnly = false

  constructor(
    private readonly db: InMemoryDb,
    private readonly table: string,
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }): this {
    // After insert/update, select() only asks for the affected rows back.
    if (opts?.head) this.countOnly = true
    return this
  }

  insert(payload: Row | Row[]): this {
    this.op = 'insert'
    this.payload = payload
    return this
  }

  update(patch: Row): this {
    this.op = 'update'
    this.payload = patch
    return this
  }

  delete(): this {
    this.op = 'delete'
    return this
  }

  eq(col: string, val: unknown): this {
    this.filters.push([col, val])
    return this
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderBy = { col, ascending: opts?.ascending ?? true }
    return this
  }

  limit(n: number): this {
    this.limitN = n
    return this
  }

  async maybeSingle(): Promise<QueryResult> {
    const res = this.execute()
    if (res.error) return res
    const rows = res.data as Row[]
    if (rows.length > 1) return { data: null, error: { message: 'multiple rows returned' } }
    return { data: rows[0] ?? null, error: null }
  }

  async single(): Promise<QueryResult> {
    const res = this.execute()
    if (res.error) return res
    const rows = res.data as Row[]
    if (rows.length !== 1) return { data: null, error: { message: `expected 1 row, got ${rows.length}` } }
    return { data: rows[0], error: null }
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }

  private matches(row: Row): boolean {
    return this.filters.every(([col, val]) => row[col] === val)
  }

  private rows(): Row[] {
    return this.db.tables[this.table] ?? []
  }

  private execute(): QueryResult {
    switch (this.op) {
      case 'insert':
        return this.runInsert()
      case 'update':
        return this.runUpdate()
      case 'delete':
        return this.runDelete()
      default:
        return this.runSelect()
    }
  }

  private runSelect(): QueryResult {
    let rows = this.rows().filter((r) => this.matches(r))
    if (this.countOnly) return { data: null, error: null, count: rows.length }
    if (this.orderBy) {
      const { col, ascending } = this.orderBy
      rows = [...rows].sort((a, b) => {
        const cmp = String(a[col]).localeCompare(String(b[col]))
        return ascending ? cmp : -cmp
      })
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN)
    return { data: rows.map((r) => ({ ...r })), error: null }
  }

  private runInsert(): QueryResult {
    const input = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}]
    const defaults = TABLE_DEFAULTS[this.table]
    const created = input.map((r) => ({
      id: crypto.randomUUID(),
      created_at: nextCreatedAt(),
      ...(defaults ? defaults() : {}),
      ...r,
    }))
    this.db.tables[this.table] = [...this.rows(), ...created]
    return { data: created.map((r) => ({ ...r })), error: null }
  }

  private runUpdate(): QueryResult {
    const patch = (this.payload ?? {}) as Row
    const updated: Row[] = []
    this.db.tables[this.table] = this.rows().map((r) => {
      if (!this.matches(r)) return r
      const next = { ...r, ...patch }
      updated.push(next)
      return next
    })
    return { data: updated.map((r) => ({ ...r })), error: null }
  }

  private runDelete(): QueryResult {
    const removed = this.rows().filter((r) => this.matches(r))
    this.db.tables[this.table] = this.rows().filter((r) => !this.matches(r))
    return { data: removed, error: null }
  }
}

export function createInMemoryDb(): InMemoryDb {
  const db: InMemoryDb = {
    tables: {},
    from: (table: string) => new QueryBuilder(db, table),
    reset: () => {
      db.tables = {}
      rowSeq = 0
    },
  }
  return db
}
