#!/usr/bin/env bash
# Refuse a commit that adds a `supabase/migrations/*` file whose name
# does not match Supabase's required `YYYYMMDDHHMMSS_<snake>.sql`
# pattern. Supabase orders migrations by filename; a mistyped prefix
# slots the new file out of order and tips production.
set -e

added=$(git diff --cached --name-only --diff-filter=A \
  | grep -E '^supabase/migrations/' || true)

if [ -z "$added" ]; then
  exit 0
fi

bad=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  name=$(basename "$f")
  if ! echo "$name" | grep -qE '^[0-9]{14}_[a-z0-9_]+\.sql$'; then
    bad="${bad}  ${name}
"
  fi
done <<EOF
$added
EOF

if [ -z "$bad" ]; then
  exit 0
fi

cat >&2 <<EOF

[lefthook/migration-naming] Migration filename invalid.

Expected pattern:
  YYYYMMDDHHMMSS_lowercase_snake.sql

Offending file(s):
${bad}
Generate a fresh timestamp with:
  date -u +%Y%m%d%H%M%S
EOF

exit 1
