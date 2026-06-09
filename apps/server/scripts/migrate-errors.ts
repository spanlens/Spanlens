#!/usr/bin/env node
/**
 * migrate-errors.ts — Sprint 8 codemod
 *
 * Rewrites the legacy ad-hoc error pattern
 *   return c.json({ error: 'message' }, 401)
 * to the standard Sprint 7 envelope pattern
 *   throw new ApiError('UNAUTHORIZED', 'message')
 *
 * The replacement is fed to the global onError handler in app.ts which
 * serialises every ApiError as { error: { code, message, requestId } }
 * (the contract surfaced to the SDK via SpanlensApiError typed throw).
 *
 * Usage
 *   tsx apps/server/scripts/migrate-errors.ts <file> [<file> ...]
 *
 *   The script does NOT walk a directory; it transforms only the files
 *   listed on argv so each Sprint 8 PR can target a controlled subset
 *   (see 06-development-plan.md v1.27+ for the PR partition).
 *
 * Behaviour
 *   - Edits files in place. Run on a clean working tree so `git diff`
 *     shows exactly what changed.
 *   - Inserts `import { ApiError } from '../lib/errors.js'` (relative
 *     path computed per file) if not already present.
 *   - Prints a per-file summary: transformed / skipped / ambiguous.
 *   - Ambiguous sites (non-literal message, unusual shape) get a
 *     `// TODO(sprint-8): manual migration` comment and stay as-is.
 *     Run with --report to list these without writing files.
 *
 * Mapping
 *   The legacy pattern's HTTP status maps directly to a catalog code.
 *   For 400 the message is sniffed for a few well-known phrases so the
 *   more specific VALIDATION_FAILED / INVALID_JSON_BODY / NO_PROVIDER_KEY
 *   codes win over the generic BAD_REQUEST fallback.
 *
 *   401         -> UNAUTHORIZED
 *   403         -> FORBIDDEN
 *   404         -> NOT_FOUND
 *   409         -> CONFLICT
 *   429         -> RATE_LIMIT
 *   400 + body sniff
 *     "invalid json" / "invalid body"       -> INVALID_JSON_BODY
 *     "no active * provider key"            -> NO_PROVIDER_KEY
 *     "is required" / "must be" / etc       -> VALIDATION_FAILED
 *     otherwise                              -> BAD_REQUEST
 *   500         -> INTERNAL_ERROR
 *   502         -> UPSTREAM_FAILED
 *   503         -> DECRYPT_FAILED if msg matches; else INTERNAL_ERROR
 *   504         -> UPSTREAM_TIMEOUT
 *   other       -> manual TODO
 *
 *   Non-literal messages (e.g. `c.json({ error: err.message }, 500)`)
 *   pass through to TODO so an operator confirms the message intent.
 *
 *   `c.json({ error: '...', details: {...} }, n)` keeps the details
 *   payload by switching to `ApiError.from(...)`.
 *
 * Not handled (left for manual cleanup)
 *   - Multi-line c.json calls. The regex is single-line; multi-line
 *     calls stay untouched + get a TODO so review is forced.
 *   - Shapes that aren't `{ error: ... }` (e.g. `{ message: ... }`).
 *     These are rare and the codemod refuses to guess.
 */

import { readFileSync, writeFileSync } from 'node:fs'

// ─── argv ──────────────────────────────────────────────────────
const args = process.argv.slice(2)
const reportOnly = args.includes('--report')
const files = args.filter((a) => !a.startsWith('--'))

if (files.length === 0) {
  console.error('Usage: tsx apps/server/scripts/migrate-errors.ts [--report] <file> [...]')
  process.exit(1)
}

// ─── status -> ERROR_CODE mapping ──────────────────────────────
type Mapping =
  | { code: string; bumpToFrom?: boolean }
  | { manual: true; reason: string }

function mapStatusAndMessage(status: number, message: string): Mapping {
  const lower = message.toLowerCase()
  switch (status) {
    case 401:
      return { code: 'UNAUTHORIZED' }
    case 403:
      // PUBLIC_KEY_WRITE_FORBIDDEN is set by requireFullScope middleware
      // before any handler runs, so handler-level 403s are all FORBIDDEN.
      return { code: 'FORBIDDEN' }
    case 404:
      return { code: 'NOT_FOUND' }
    case 409:
      return { code: 'CONFLICT' }
    case 429:
      return { code: 'RATE_LIMIT' }
    case 500:
      return { code: 'INTERNAL_ERROR' }
    case 502:
      return { code: 'UPSTREAM_FAILED' }
    case 503:
      if (lower.includes('decrypt')) return { code: 'DECRYPT_FAILED' }
      return { code: 'INTERNAL_ERROR' }
    case 504:
      return { code: 'UPSTREAM_TIMEOUT' }
    case 400:
      if (lower.includes('invalid json') || lower.includes('invalid body')) {
        return { code: 'INVALID_JSON_BODY' }
      }
      if (lower.includes('no active') && lower.includes('provider key')) {
        return { code: 'NO_PROVIDER_KEY' }
      }
      if (
        lower.includes('is required') ||
        lower.includes('must be') ||
        lower.includes('must contain') ||
        lower.includes('must include') ||
        lower.includes('cannot be empty') ||
        lower.includes('expected ') ||
        lower.includes('too short') ||
        lower.includes('too long') ||
        lower.includes('too large') ||
        lower.includes('too many') ||
        lower.startsWith('invalid ') ||
        lower.includes('exceeds ') ||
        lower.includes(' length')
      ) {
        return { code: 'VALIDATION_FAILED' }
      }
      return { code: 'BAD_REQUEST' }
    default:
      return { manual: true, reason: `unmapped status ${status}` }
  }
}

// ─── escape single quotes when re-emitting the message literal ─
function jsString(message: string): string {
  // Re-quote with single quotes to match codebase convention. Embedded
  // single quotes become \'. Backslashes are escaped first to avoid
  // double-processing.
  return `'${message.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

// ─── relative import path resolver ─────────────────────────────
/**
 * Returns the relative import specifier for `lib/errors.js` from the
 * given source file. Computes depth from the apps/server/src/ root
 * rather than relying on absolute path resolution (which broke when
 * the script's cwd happened to be apps/server — `apps/server/lib/errors.js`
 * is not a real path).
 *
 * Examples
 *   src/api/feedback.ts            -> '../lib/errors.js'
 *   src/middleware/authJwt.ts      -> '../lib/errors.js'
 *   src/api/admin/modelPrices.ts   -> '../../lib/errors.js'
 *   apps/server/src/api/foo.ts     -> '../lib/errors.js'  (same)
 */
function relativeErrorsImport(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/')
  const idx = norm.indexOf('apps/server/src/')
  const rel = idx >= 0
    ? norm.slice(idx + 'apps/server/src/'.length)
    : norm.replace(/^src\//, '')
  // depth = number of '/' in the slice. 'api/feedback.ts' has 1, so we
  // emit '../'. 'api/admin/modelPrices.ts' has 2, so '../../'.
  const depth = (rel.match(/\//g) ?? []).length
  return `${'../'.repeat(depth)}lib/errors.js`
}

// ─── regexes ───────────────────────────────────────────────────
// SIMPLE_PATTERN matches `return c.json({ error: 'literal' }, NNN)`
// with a string-literal message. Status maps directly to a catalog
// code via mapStatusAndMessage.
const SIMPLE_PATTERN = /return\s+c\.json\(\s*\{\s*error:\s*('([^'\\]|\\.)*'|"([^"\\]|\\.)*")\s*\}\s*,\s*(\d{3})\s*\)/g

// EXPRESSION_PATTERN matches `return c.json({ error: <expr> }, NNN)`
// where `<expr>` is any single-line expression that does NOT contain
// `{` or `}` — covers template literals, identifiers, member access,
// and ?? fallbacks. Examples:
//   return c.json({ error: msg }, 500)
//   return c.json({ error: parsed.error }, 400)
//   return c.json({ error: err.message }, 500)
//   return c.json({ error: `Cannot cancel row in status=${row.status}` }, 409)
//   return c.json({ error: enqueued.error ?? 'Failed to queue' }, 500)
//
// Bails out on:
//   - Object expressions (would contain { })
//   - Multi-line forms (regex is single-line by default)
//   - Anything where the codemod cannot pick a sensible message string
//
// Status-driven mapping is used because the message is not inspectable
// (it's a runtime value); 400 always becomes VALIDATION_FAILED for this
// pattern since "variable 400 message" overwhelmingly comes from zod
// or hand-rolled validators surfacing the failing field name. Callers
// who actually want BAD_REQUEST can switch the code by hand later.
// First-char rule excludes whitespace AND quotes so the regex cannot
// backtrack out of `\s*` to swallow a leading space (which would have
// let `error: 'literal', detail: x }` slip through with the comma in
// the captured expression). Body rule forbids `,` and `{}` so multi-
// field objects (`error: 'a', detail: b`) never match — those need
// the codemod to emit `ApiError.from(code, { details: { ... } })` by
// hand, not be auto-transformed.
const EXPRESSION_PATTERN = /return\s+c\.json\(\s*\{\s*error:\s*([^\s,{}'"`][^,{}]*?)\s*\}\s*,\s*(\d{3})\s*\)/g

// TEMPLATE_PATTERN matches template literals specifically — backtick
// strings whose body can contain `${...}` substitutions. v2's
// EXPRESSION_PATTERN's `[^,{}]` body rule rejects the `{` inside
// `${var}` so this needs its own pass. Allowed substitution shapes:
//   - simple identifier or member access: `${row.status as string}`
//   - balanced single-pair: `${expr}` where expr has no `}`
// Nested objects inside `${}` still bail out — those stay multi-line
// manual cleanup.
const TEMPLATE_PATTERN = /return\s+c\.json\(\s*\{\s*error:\s*(`(?:[^`\\]|\\.|\$\{[^{}]*\})*`)\s*\}\s*,\s*(\d{3})\s*\)/g

// ─── per-file transform ────────────────────────────────────────
interface FileResult {
  file: string
  transformed: number
  manual: number
  skipped: number
  totalLegacy: number
  manualSites: Array<{ line: number; reason: string; snippet: string }>
}

function transformFile(filePath: string): FileResult {
  const original = readFileSync(filePath, 'utf-8')
  let content = original
  const result: FileResult = {
    file: filePath,
    transformed: 0,
    manual: 0,
    skipped: 0,
    totalLegacy: 0,
    manualSites: [],
  }

  // Count all legacy patterns first (including non-matching ones, for
  // accurate "totalLegacy" reporting). The simple count regex matches
  // even multi-line shapes by virtue of being looser than SIMPLE_PATTERN.
  const allLegacy = original.match(/c\.json\(\s*\{[^}]*error:/g) ?? []
  result.totalLegacy = allLegacy.length

  content = content.replace(SIMPLE_PATTERN, (match, quotedMessage, _a, _b, statusStr) => {
    const status = Number(statusStr)
    const message = quotedMessage.slice(1, -1) // strip quotes
    const decoded = message.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    const mapping = mapStatusAndMessage(status, decoded)

    if ('manual' in mapping) {
      result.manual++
      result.manualSites.push({
        line: lineNumberOf(content, match),
        reason: mapping.reason,
        snippet: match,
      })
      return `// TODO(sprint-8): manual migration (${mapping.reason})\n    ${match}`
    }

    result.transformed++
    return `throw new ApiError('${mapping.code}', ${jsString(decoded)})`
  })

  // Template-literal pass — same status-driven mapping as the
  // expression pass but only matches backtick strings with `${}`
  // substitutions (which v2 EXPRESSION_PATTERN can't catch because
  // its body rule forbids the `{` in `${`).
  content = content.replace(TEMPLATE_PATTERN, (match, template, statusStr) => {
    const status = Number(statusStr)
    const code = (() => {
      switch (status) {
        case 400: return 'VALIDATION_FAILED'
        case 401: return 'UNAUTHORIZED'
        case 403: return 'FORBIDDEN'
        case 404: return 'NOT_FOUND'
        case 409: return 'CONFLICT'
        case 410: return 'NOT_FOUND'
        case 429: return 'RATE_LIMIT'
        case 500: return 'INTERNAL_ERROR'
        case 502: return 'UPSTREAM_FAILED'
        case 503: return 'INTERNAL_ERROR'
        case 504: return 'UPSTREAM_TIMEOUT'
        default: return null
      }
    })()
    if (!code) {
      result.manual++
      result.manualSites.push({
        line: lineNumberOf(content, match),
        reason: `unmapped status ${status}`,
        snippet: match,
      })
      return `// TODO(sprint-8): manual migration (unmapped status ${status})\n    ${match}`
    }
    result.transformed++
    return `throw new ApiError('${code}', ${template})`
  })

  // Second pass: variable / template-literal message expressions.
  // Status-driven mapping only (we can't inspect the runtime message),
  // with 400 defaulting to VALIDATION_FAILED — see EXPRESSION_PATTERN
  // comment. The replacement preserves the original expression verbatim
  // so backticks, ??, optional chaining, etc. all carry through.
  content = content.replace(EXPRESSION_PATTERN, (match, expr, statusStr) => {
    const status = Number(statusStr)
    const code = (() => {
      switch (status) {
        case 400: return 'VALIDATION_FAILED'
        case 401: return 'UNAUTHORIZED'
        case 403: return 'FORBIDDEN'
        case 404: return 'NOT_FOUND'
        case 409: return 'CONFLICT'
        case 429: return 'RATE_LIMIT'
        case 500: return 'INTERNAL_ERROR'
        case 502: return 'UPSTREAM_FAILED'
        case 503: return 'INTERNAL_ERROR'
        case 504: return 'UPSTREAM_TIMEOUT'
        default: return null
      }
    })()
    if (!code) {
      result.manual++
      result.manualSites.push({
        line: lineNumberOf(content, match),
        reason: `unmapped status ${status}`,
        snippet: match,
      })
      return `// TODO(sprint-8): manual migration (unmapped status ${status})\n    ${match}`
    }
    result.transformed++
    return `throw new ApiError('${code}', ${expr.trim()})`
  })

  // Insert ApiError import if any throw was emitted and not already
  // imported. Multi-line imports are common in this codebase
  //   import {
  //     foo,
  //     bar,
  //   } from './x.js'
  // so a single-line `^import .+$` regex matches the FIRST line of a
  // multi-line block and inserting after it lands inside the brace —
  // a syntax error. Instead, find the end of the contiguous import
  // block at the top of the file: the first non-import, non-blank,
  // non-comment line marks where source code begins; insert just
  // before it (or at the end of the last line before it). For files
  // that have only single-line imports the behaviour is identical to
  // the old logic.
  if (result.transformed > 0 && !content.match(/from\s+['"][^'"]*lib\/errors(\.js)?['"]/)) {
    const importPath = relativeErrorsImport(filePath)
    const lines = content.split('\n')

    // Walk top-down keeping track of whether we're inside a multi-line
    // import. Stop at the first line that is OUTSIDE any import and is
    // not blank/comment.
    let braceDepth = 0
    let insertAfterLine = -1
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()
      if (braceDepth > 0) {
        braceDepth += (line.match(/\{/g) ?? []).length
        braceDepth -= (line.match(/\}/g) ?? []).length
        insertAfterLine = i
        continue
      }
      if (trimmed.startsWith('import ')) {
        braceDepth += (line.match(/\{/g) ?? []).length
        braceDepth -= (line.match(/\}/g) ?? []).length
        insertAfterLine = i
        continue
      }
      if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        // Blank or comment line between imports. Keep going to capture
        // imports that follow a comment.
        continue
      }
      // First real code line. Stop.
      break
    }

    if (insertAfterLine < 0) {
      // No imports at all (unlikely). Prepend.
      content = `import { ApiError } from '${importPath}'\n${content}`
    } else {
      lines.splice(insertAfterLine + 1, 0, `import { ApiError } from '${importPath}'`)
      content = lines.join('\n')
    }
  }

  // Detect remaining legacy patterns that the simple regex did not
  // catch (multi-line, non-literal messages, exotic shapes). Each
  // becomes a manual entry so the operator confirms.
  const stillLegacy = (content.match(/c\.json\(\s*\{[^}]*error:/g) ?? []).length
  const remainingTodo = stillLegacy - countAlreadyTodod(content)
  result.skipped = Math.max(0, remainingTodo)

  if (!reportOnly && content !== original) {
    writeFileSync(filePath, content, 'utf-8')
  }

  return result
}

function lineNumberOf(content: string, snippet: string): number {
  const idx = content.indexOf(snippet)
  if (idx < 0) return 0
  return content.slice(0, idx).split('\n').length
}

function countAlreadyTodod(content: string): number {
  return (content.match(/TODO\(sprint-8\)/g) ?? []).length
}

// ─── main ──────────────────────────────────────────────────────
let totalTransformed = 0
let totalManual = 0
let totalSkipped = 0
let totalLegacy = 0

for (const file of files) {
  const result = transformFile(file)
  totalTransformed += result.transformed
  totalManual += result.manual
  totalSkipped += result.skipped
  totalLegacy += result.totalLegacy

  if (result.transformed === 0 && result.manual === 0 && result.skipped === 0) {
    console.log(`  ${file}: no legacy patterns`)
    continue
  }

  console.log(
    `  ${file}: ${result.transformed} transformed, ${result.manual} manual, ${result.skipped} multi-line/exotic (${result.totalLegacy} legacy total)`,
  )
  for (const site of result.manualSites.slice(0, 3)) {
    console.log(`      L${site.line} [${site.reason}]: ${site.snippet.slice(0, 80)}`)
  }
}

console.log(
  `\nTotal across ${files.length} files: ${totalTransformed} transformed, ${totalManual} manual TODOs, ${totalSkipped} multi-line/exotic (${totalLegacy} legacy starting count)`,
)
console.log(reportOnly ? '\n(--report mode: no files written)' : '\nDone. Run typecheck + tests, then commit.')
