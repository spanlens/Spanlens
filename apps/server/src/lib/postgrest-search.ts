/**
 * Escaping helpers for user-supplied search terms that end up inside a
 * PostgREST `.or()` filter string (supabase-js `query.or('name.ilike.…')`).
 *
 * Two escaping layers stack:
 *
 *  1. SQL LIKE level — `%` and `_` are pattern metacharacters (and `\` is
 *     the escape character), so each is backslash-escaped to match literally.
 *     Without this, searching "trace_a" also matches "traceXa".
 *
 *  2. PostgREST or-filter level — `(`, `)` and `,` delimit the or() logic
 *     tree. An unquoted value containing them makes PostgREST fail to parse
 *     the whole filter (surfaces as a 500 on the traces list). PostgREST's
 *     documented fix is to double-quote the value; inside a quoted value,
 *     `"` and `\` are themselves escaped with a backslash.
 *
 * Order matters: LIKE-escape first, then quote-escape, so the backslashes
 * injected for LIKE survive PostgREST's quoted-string unescaping and reach
 * the SQL layer intact.
 */
export function ilikeOrPattern(term: string): string {
  const likeEscaped = term.replace(/[\\%_]/g, '\\$&')
  const quoteEscaped = `%${likeEscaped}%`.replace(/[\\"]/g, '\\$&')
  return `"${quoteEscaped}"`
}
