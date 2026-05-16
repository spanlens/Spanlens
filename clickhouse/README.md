# ClickHouse migrations

This directory contains the schema for Spanlens's ClickHouse instance.
Only the `requests` table lives here; everything else stays in Supabase
(see [docs/plans/clickhouse-migration.md](../docs/plans/clickhouse-migration.md)).

## Layout

```
clickhouse/
  migrations/
    001_create_requests.sql       ← schema files, applied in filename order
  apply.ts                        ← idempotent runner (CREATE IF NOT EXISTS only)
```

## Running migrations

From the repo root:

```bash
pnpm ch:migrate
```

Reads `CLICKHOUSE_*` environment variables from your shell (or `apps/server/.env`)
and applies every `.sql` file in `migrations/` in lexicographic order.

Migrations must be **idempotent and roll-forward only**:
- `CREATE TABLE IF NOT EXISTS` — yes
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — yes
- `DROP TABLE` — **never** (CLAUDE.md policy)
- `TRUNCATE` — **never**

## Local development

```bash
docker compose up clickhouse        # start container (one-time)
pnpm ch:migrate                     # apply schema
```

The container persists data in a named volume, so the schema survives restarts.
To wipe everything (destructive!): `docker compose down -v` then re-run migrate.

## Production

Set `CLICKHOUSE_URL` etc. to your managed cluster (ClickHouse Cloud, Aiven, or
self-hosted) and run `pnpm ch:migrate` once during deploy.
