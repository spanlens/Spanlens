#!/bin/sh
# Runtime env-var injection for the pre-built spanlens-web image.
#
# Next.js bakes NEXT_PUBLIC_* variables into the client bundle statically at
# build time — they cannot be changed via runtime env without patching the
# compiled output. This script replaces known placeholder strings in the
# built .js files before starting the server, so a single pre-built image
# works with any Supabase project.
#
# Required env vars:
#   NEXT_PUBLIC_SUPABASE_URL       e.g. https://abc.supabase.co
#   NEXT_PUBLIC_SUPABASE_ANON_KEY  your project's anon (public) key
set -e

# Validate required variables
: "${NEXT_PUBLIC_SUPABASE_URL:?ERROR: NEXT_PUBLIC_SUPABASE_URL is required}"
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?ERROR: NEXT_PUBLIC_SUPABASE_ANON_KEY is required}"

# Patch the compiled Next.js output. We use | as the sed delimiter because
# Supabase URLs and JWT keys never contain the pipe character.
# Only scan the Next.js build output — skip node_modules and other dirs.
find /app/apps/web/.next -name "*.js" -type f | while IFS= read -r file; do
  sed -i \
    -e "s|__PLACEHOLDER_SUPABASE_URL__|${NEXT_PUBLIC_SUPABASE_URL}|g" \
    -e "s|__PLACEHOLDER_SUPABASE_ANON_KEY__|${NEXT_PUBLIC_SUPABASE_ANON_KEY}|g" \
    "$file"
done

exec node server.js
