#!/usr/bin/env bash
# Refuse a commit that modifies or deletes an already-tracked
# `supabase/migrations/<ts>_<desc>.sql` file. The remote migration
# history is keyed by file hash; editing a merged migration desyncs
# every other dev's local DB and the deploy-server.yml migrate job.
set -e

modified=$(git diff --cached --name-only --diff-filter=MD \
  | grep -E '^supabase/migrations/[0-9]+_.+\.sql$' || true)

if [ -z "$modified" ]; then
  exit 0
fi

cat >&2 <<EOF

[lefthook/no-migration-edits] Refusing commit.

Modifying or deleting an already-tracked migration is forbidden
(CLAUDE.md / "DB 작업 규칙"). The remote migration history depends
on the file hash staying stable.

Offending file(s):
$(echo "$modified" | sed 's/^/  /')

Fix: create a NEW migration with a fresh timestamp instead:
  ts=\$(date -u +%Y%m%d%H%M%S)
  cp <bad-edit>.sql supabase/migrations/\${ts}_<desc>.sql

If you are intentionally editing pre-merge local work and accept the
risk, bypass once with:
  git commit --no-verify
EOF

exit 1
