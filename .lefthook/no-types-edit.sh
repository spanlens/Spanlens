#!/usr/bin/env bash
# Warn when `supabase/types.ts` is in the staged set but no new
# migration accompanies it. types.ts is generated; a manual edit
# desyncs from the committed migration set and silently breaks
# `tsc --noEmit` on the next gen-types run.
#
# Warning only (exit 0) — sometimes you legitimately need to commit
# a regenerated types.ts after pulling someone else's migration. Block
# would be too aggressive. The author reads the message and decides.
set -e

types_modified=$(git diff --cached --name-only \
  | grep '^supabase/types.ts$' || true)
migration_added=$(git diff --cached --name-only --diff-filter=A \
  | grep -E '^supabase/migrations/[0-9]+_.+\.sql$' || true)

if [ -z "$types_modified" ] || [ -n "$migration_added" ]; then
  exit 0
fi

cat >&2 <<EOF

[lefthook/no-types-edit] WARN — supabase/types.ts changed without a new
migration file in the same commit.

If the diff is the output of:
  supabase gen types --lang typescript --local 2>/dev/null > supabase/types.ts
…on the latest schema, this is OK.

If you hand-edited the file, revert it and regenerate:
  supabase gen types --lang typescript --local 2>/dev/null > supabase/types.ts

EOF

# Warning only — do not block.
exit 0
