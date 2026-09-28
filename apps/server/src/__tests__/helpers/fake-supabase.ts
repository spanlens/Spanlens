/**
 * In-memory stand-in for the subset of supabase-js / PostgREST the billing
 * code uses. Built for the 2026-09-28 billing audit fixes, where the bugs were
 * all about what happens when a write FAILS or RACES, so the fake keeps the
 * two properties hand-rolled chain mocks usually drop:
 *
 *   1. Failures resolve, they do not reject. supabase-js answers a failed
 *      query with `{ data: null, error }` (postgrest-js shouldThrowOnError is
 *      false by default). A mock that rejects hides code that ignores
 *      `{ error }`, which is the defect class being fixed.
 *   2. Unique constraints are enforced (23505), including partial ones, so
 *      "insert first, treat duplicate as already done" logic and CAS updates
 *      behave the way they would against Postgres.
 *
 * It is not a SQL engine. Filters cover eq / neq / in / is / not-is / gt /
 * gte / lt / lte and the `or()` shape `col.is.null,col.lt."<iso>"`. Embedded
 * selects are supported for configured many-to-one relations.
 */

import { randomUUID } from 'node:crypto'

export type Row = Record<string, unknown>
export interface DbError { message: string; code?: string }
export interface DbResult<T = unknown> { data: T; error: DbError | null }

type Op = 'select' | 'insert' | 'update'

export interface UniqueConstraint {
  columns: string[]
  /** Only rows matching this participate (partial unique index). */
  where?: (row: Row) => boolean
  /** Postgres default: NULLs are distinct. Set true for NULLS NOT DISTINCT. */
  nullsNotDistinct?: boolean
}

export interface Relation {
  /** Column on this table holding the foreign key. */
  localKey: string
  foreignTable: string
  foreignKey: string
}

export interface TableConfig {
  defaults?: () => Row
  unique?: UniqueConstraint[]
  relations?: Record<string, Relation>
}

type Filter = (row: Row) => boolean

function toComparable(v: unknown): number | string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(t) ? t : v
  }
  return String(v)
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return a == b
  const ca = toComparable(a)
  const cb = toComparable(b)
  return ca === cb
}

function compare(a: unknown, b: unknown): number | null {
  const ca = toComparable(a)
  const cb = toComparable(b)
  if (ca === null || cb === null) return null
  if (ca < cb) return -1
  if (ca > cb) return 1
  return 0
}

function parseOrClause(clause: string): Filter {
  const parts = clause.split(',').map((p) => p.trim())
  const filters = parts.map((part): Filter => {
    const [col, op, ...rest] = part.split('.')
    const raw = rest.join('.').replace(/^"|"$/g, '')
    if (!col || !op) throw new Error(`fake-supabase: cannot parse or() clause "${part}"`)
    if (op === 'is' && raw === 'null') return (r) => r[col] === null || r[col] === undefined
    if (op === 'lt') return (r) => (compare(r[col], raw) ?? 1) < 0
    if (op === 'lte') return (r) => (compare(r[col], raw) ?? 1) <= 0
    if (op === 'gt') return (r) => (compare(r[col], raw) ?? -1) > 0
    if (op === 'eq') return (r) => sameValue(r[col], raw)
    throw new Error(`fake-supabase: unsupported or() operator "${op}"`)
  })
  return (row) => filters.some((f) => f(row))
}

export class FakeSupabase {
  readonly tables = new Map<string, Row[]>()
  private readonly config = new Map<string, TableConfig>()
  private readonly failures: Array<{ table: string; op: Op; error: DbError; remaining: number }> = []
  readonly rpcHandlers = new Map<string, (params: Record<string, unknown>) => DbResult | Promise<DbResult>>()
  readonly rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = []
  readonly writes: Array<{ table: string; op: 'insert' | 'update'; values: Row }> = []

  configure(table: string, config: TableConfig): this {
    this.config.set(table, config)
    return this
  }

  seed(table: string, rows: Row[]): this {
    const defaults = this.config.get(table)?.defaults
    this.tables.set(table, [
      ...(this.tables.get(table) ?? []),
      ...rows.map((r) => ({ id: randomUUID(), ...(defaults ? defaults() : {}), ...r })),
    ])
    return this
  }

  rows(table: string): Row[] {
    return this.tables.get(table) ?? []
  }

  /** The next `times` operations of this kind on this table resolve with `error`. */
  failNext(table: string, op: Op, error: DbError, times = 1): this {
    this.failures.push({ table, op, error, remaining: times })
    return this
  }

  onRpc(fn: string, handler: (params: Record<string, unknown>) => DbResult | Promise<DbResult>): this {
    this.rpcHandlers.set(fn, handler)
    return this
  }

  takeFailure(table: string, op: Op): DbError | null {
    const f = this.failures.find((x) => x.table === table && x.op === op && x.remaining > 0)
    if (!f) return null
    f.remaining -= 1
    return f.error
  }

  violatesUnique(table: string, candidate: Row, ignore?: Row): boolean {
    const constraints = this.config.get(table)?.unique ?? []
    return constraints.some((uc) => {
      if (uc.where && !uc.where(candidate)) return false
      const hasNull = uc.columns.some((c) => candidate[c] === null || candidate[c] === undefined)
      if (hasNull && !uc.nullsNotDistinct) return false
      return this.rows(table).some((existing) => {
        if (existing === ignore) return false
        if (uc.where && !uc.where(existing)) return false
        return uc.columns.every((c) => sameValue(existing[c], candidate[c]))
      })
    })
  }

  embed(table: string, row: Row, select: string): Row {
    const relations = this.config.get(table)?.relations ?? {}
    const out: Row = { ...row }
    for (const [name, rel] of Object.entries(relations)) {
      if (!select.includes(`${name}(`)) continue
      const target = this.rows(rel.foreignTable).find((r) => sameValue(r[rel.foreignKey], row[rel.localKey]))
      out[name] = target ? { ...target } : null
    }
    return out
  }

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table)
  }

  async rpc(fn: string, params: Record<string, unknown>): Promise<DbResult> {
    this.rpcCalls.push({ fn, params })
    const handler = this.rpcHandlers.get(fn)
    if (!handler) return { data: null, error: { message: `function ${fn} does not exist`, code: '42883' } }
    return handler(params)
  }

  defaultsFor(table: string): Row {
    const d = this.config.get(table)?.defaults
    return d ? d() : {}
  }
}

class QueryBuilder implements PromiseLike<DbResult> {
  private op: Op = 'select'
  private readonly filters: Filter[] = []
  private selectCols: string | null = null
  private payload: Row | null = null
  private orderBy: { col: string; ascending: boolean } | null = null
  private limitN: number | null = null
  private mode: 'many' | 'single' | 'maybeSingle' = 'many'

  constructor(private readonly db: FakeSupabase, private readonly table: string) {}

  select(cols = '*'): this {
    this.selectCols = cols
    return this
  }
  insert(values: Row): this {
    this.op = 'insert'
    this.payload = values
    return this
  }
  update(values: Row): this {
    this.op = 'update'
    this.payload = values
    return this
  }
  eq(col: string, val: unknown): this {
    this.filters.push((r) => sameValue(r[col], val))
    return this
  }
  neq(col: string, val: unknown): this {
    this.filters.push((r) => !sameValue(r[col], val))
    return this
  }
  in(col: string, vals: unknown[]): this {
    this.filters.push((r) => vals.some((v) => sameValue(r[col], v)))
    return this
  }
  is(col: string, val: null): this {
    this.filters.push((r) => (val === null ? r[col] === null || r[col] === undefined : r[col] === val))
    return this
  }
  not(col: string, op: string, val: unknown): this {
    if (op !== 'is' || val !== null) throw new Error('fake-supabase: only not(col, "is", null) is supported')
    this.filters.push((r) => r[col] !== null && r[col] !== undefined)
    return this
  }
  gt(col: string, val: unknown): this {
    this.filters.push((r) => (compare(r[col], val) ?? -1) > 0)
    return this
  }
  gte(col: string, val: unknown): this {
    this.filters.push((r) => (compare(r[col], val) ?? -1) >= 0)
    return this
  }
  lt(col: string, val: unknown): this {
    this.filters.push((r) => (compare(r[col], val) ?? 1) < 0)
    return this
  }
  lte(col: string, val: unknown): this {
    this.filters.push((r) => (compare(r[col], val) ?? 1) <= 0)
    return this
  }
  or(clause: string): this {
    this.filters.push(parseOrClause(clause))
    return this
  }
  order(col: string, opts: { ascending?: boolean } = {}): this {
    this.orderBy = { col, ascending: opts.ascending ?? true }
    return this
  }
  limit(n: number): this {
    this.limitN = n
    return this
  }
  returns<T>(): PromiseLike<DbResult<T>> {
    return this as unknown as PromiseLike<DbResult<T>>
  }
  single(): this {
    this.mode = 'single'
    return this
  }
  maybeSingle(): this {
    this.mode = 'maybeSingle'
    return this
  }

  then<R1 = DbResult, R2 = never>(
    onFulfilled?: ((value: DbResult) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve()
      .then(() => this.execute())
      .then(onFulfilled, onRejected)
  }

  private matching(): Row[] {
    return this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r)))
  }

  private shape(rows: Row[]): DbResult {
    const cols = this.selectCols ?? '*'
    const embedded = rows.map((r) => this.db.embed(this.table, r, cols))
    if (this.mode === 'many') return { data: embedded, error: null }
    if (embedded.length > 1) {
      return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } }
    }
    if (embedded.length === 0 && this.mode === 'single') {
      return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } }
    }
    return { data: embedded[0] ?? null, error: null }
  }

  private execute(): DbResult {
    const failure = this.db.takeFailure(this.table, this.op)
    if (failure) return { data: null, error: failure }
    if (this.op === 'insert') return this.executeInsert()
    if (this.op === 'update') return this.executeUpdate()
    let rows = this.matching()
    if (this.orderBy) {
      const { col, ascending } = this.orderBy
      rows = [...rows].sort((a, b) => (compare(a[col], b[col]) ?? 0) * (ascending ? 1 : -1))
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN)
    return this.shape(rows)
  }

  private executeInsert(): DbResult {
    const row: Row = {
      id: randomUUID(),
      created_at: new Date().toISOString(),
      ...this.db.defaultsFor(this.table),
      ...this.payload,
    }
    if (this.db.violatesUnique(this.table, row)) {
      return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } }
    }
    this.db.tables.set(this.table, [...this.db.rows(this.table), row])
    this.db.writes.push({ table: this.table, op: 'insert', values: { ...this.payload } })
    return this.selectCols === null ? { data: null, error: null } : this.shape([row])
  }

  private executeUpdate(): DbResult {
    const updated = new Map(this.matching().map((t) => [t, { ...t, ...this.payload }] as const))
    for (const [original, next] of updated) {
      if (this.db.violatesUnique(this.table, next, original)) {
        return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } }
      }
    }
    this.db.tables.set(this.table, this.db.rows(this.table).map((r) => updated.get(r) ?? r))
    if (updated.size > 0) this.db.writes.push({ table: this.table, op: 'update', values: { ...this.payload } })
    return this.selectCols === null ? { data: null, error: null } : this.shape([...updated.values()])
  }
}
