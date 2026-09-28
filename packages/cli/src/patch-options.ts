import {
  Node,
  Project,
  type ObjectLiteralElementLike,
  type ObjectLiteralExpression,
} from 'ts-morph'

/**
 * Decides what happens to the options object of a `new Client({...})` call
 * before it is handed to the Spanlens factory. Two layers:
 *
 *   1. Top-level options that carry a provider credential or the upstream
 *      address (`apiKey`, `baseURL`, ...) are removed.
 *   2. Options that can carry a credential one level down are checked.
 *      openai and @anthropic-ai/sdk merge `defaultHeaders` after their own
 *      auth header, so an `Authorization` left there overrides the Spanlens
 *      key and sends the provider key to Spanlens. The Spanlens proxy only
 *      strips its own auth headers, so a gateway credential such as
 *      `Helicone-Auth` would also travel on to the provider.
 *
 * Credential and gateway entries of an inline `defaultHeaders` /
 * `defaultQuery` literal are removed. Anything the wizard cannot read in full
 * (a variable, a spread, a custom `fetch`, `fetchOptions.headers`) sends the
 * call to a manual edit instead of being passed through.
 */

export type StripResult =
  | { kind: 'ok'; text: string }
  | { kind: 'unsafe'; text: string; unknown: string[] }

export type SanitizeResult =
  /** Safe to pass to the factory. `removed` lists nested entries that were dropped. */
  | { kind: 'ok'; text: string; removed: string[] }
  /** Top-level members whose name is not known statically (spread, computed key). */
  | { kind: 'unsafe'; text: string; unknown: string[] }
  /** Readable, but something must be checked by hand before the switch. */
  | { kind: 'review'; text: string; reason: string; cautions: string[] }
  /** Must not be switched to this factory at all. */
  | { kind: 'unsupported'; reason: string; cautions: string[] }

export interface SanitizeContext {
  /** Top-level options that must never reach the factory. */
  credentialProps: readonly string[]
  /** Detect Azure OpenAI clients, which the OpenAI factory must not take over. */
  detectAzure: boolean
}

interface Issue {
  reason: string
  caution: string
}

const HEADER_CAUTION =
  'Remove any Authorization, x-api-key, api-key, or gateway header (such as Helicone-Auth or x-portkey-*) from it first, because requests now reach Spanlens before the provider.'
const QUERY_CAUTION =
  'Remove any key, token, or signature parameter from it first, because requests now reach Spanlens before the provider.'

/** Remove only the top-level credential props. Kept for callers that need nothing else. */
export function stripCredentialProps(objText: string, props: readonly string[]): StripResult {
  const init = parseObject(objText)
  if (!init) return { kind: 'unsafe', text: objText, unknown: [objText] }
  const unknown = removeTopLevel(init, props)
  const text = render(init)
  return unknown.length > 0 ? { kind: 'unsafe', text, unknown } : { kind: 'ok', text }
}

export function sanitizeOptions(objText: string, ctx: SanitizeContext): SanitizeResult {
  const init = parseObject(objText)
  if (!init) return { kind: 'unsafe', text: objText, unknown: [objText] }

  const azure = ctx.detectAzure ? azureSignal(init) : null
  if (azure) {
    return {
      kind: 'unsupported',
      reason: `This client looks like Azure OpenAI (${azure}), and createOpenAI() would send its requests to OpenAI instead.`,
      cautions: [
        'Spanlens proxies Azure OpenAI at /proxy/azure on your Spanlens server. See https://www.spanlens.io/docs/proxy for the client settings.',
      ],
    }
  }

  const unknown = removeTopLevel(init, ctx.credentialProps)
  if (unknown.length > 0) return { kind: 'unsafe', text: render(init), unknown }

  const removed: string[] = []
  const issues: Issue[] = []
  for (const member of [...init.getProperties()]) {
    const name = memberName(member)
    if (name === 'defaultHeaders' || name === 'defaultQuery') {
      scrubMap(member, name, removed, issues)
    } else if (name === 'fetch') {
      issues.push({
        reason: 'The options pass a custom `fetch`, which can add its own credentials or send requests to another host.',
        caution: 'Make sure your `fetch` sets no Authorization, x-api-key, or gateway header and keeps the request URL as it is.',
      })
    } else if (name === 'fetchOptions') {
      checkFetchOptions(member, issues)
    }
  }

  const text = render(init)
  if (issues.length === 0) return { kind: 'ok', text, removed }
  return {
    kind: 'review',
    text,
    reason: issues.map((i) => i.reason).join(' '),
    cautions: [...new Set(issues.map((i) => i.caution))],
  }
}

/**
 * A header or query parameter name that carries a credential, or belongs to
 * an LLM gateway (whose headers can hold a provider key or a gateway config).
 */
export function isCredentialName(name: string): boolean {
  const lower = name.trim().toLowerCase()
  if (GATEWAY_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true
  return CREDENTIAL_WORD.test(lower) || API_KEY_WORD.test(lower)
}

const GATEWAY_PREFIXES = ['helicone-', 'x-portkey-', 'cf-aig-']
const CREDENTIAL_WORD =
  /(^|[-_])(auth|authorization|cookie|token|secret|password|passwd|credential|credentials|signature|sig|key)([-_]|$)/
const API_KEY_WORD = /api[-_]?key|access[-_]?key/
// `auth(?!or)`: an "Author" header value is not a credential.
const CREDENTIAL_VALUE = /api[-_]?key|apikey|auth(?!or)|token|secret|password|passwd|bearer|\bsk-[a-z0-9]|\baiza/i

function scrubMap(
  member: ObjectLiteralElementLike,
  option: 'defaultHeaders' | 'defaultQuery',
  removed: string[],
  issues: Issue[],
): void {
  const label = option === 'defaultHeaders' ? 'header' : 'query parameter'
  const caution = option === 'defaultHeaders' ? HEADER_CAUTION : QUERY_CAUTION
  const value = memberValue(member)
  if (!value || !Node.isObjectLiteralExpression(value)) {
    const source = value?.getText() ?? member.getText()
    issues.push({ reason: `\`${option}\` comes from \`${source}\`, which the wizard cannot inspect.`, caution })
    return
  }

  const toRemove: ObjectLiteralElementLike[] = []
  for (const entry of value.getProperties()) {
    const entryName = memberName(entry)
    const entryValue = memberValue(entry)
    if (entryName === null || !entryValue) {
      issues.push({ reason: `\`${option}\` includes \`${entry.getText()}\`, which the wizard cannot inspect.`, caution })
    } else if (isCredentialName(entryName)) {
      toRemove.push(entry)
      removed.push(`${option} "${entryName}"`)
    } else if (CREDENTIAL_VALUE.test(entryValue.getText())) {
      issues.push({
        reason: `The \`${entryName}\` ${label} in \`${option}\` is set from \`${entryValue.getText()}\`, which looks like a credential.`,
        caution,
      })
    }
  }
  for (const entry of toRemove.reverse()) entry.remove()
  if (value.getProperties().length === 0) member.remove()
}

function checkFetchOptions(member: ObjectLiteralElementLike, issues: Issue[]): void {
  const caution = `Make sure \`fetchOptions\` sets no headers that carry a provider or gateway key.`
  const value = memberValue(member)
  if (!value || !Node.isObjectLiteralExpression(value)) {
    const source = value?.getText() ?? member.getText()
    issues.push({ reason: `\`fetchOptions\` comes from \`${source}\`, which the wizard cannot inspect.`, caution })
    return
  }
  for (const entry of value.getProperties()) {
    const name = memberName(entry)
    if (name === null || name === 'headers') {
      issues.push({ reason: `\`fetchOptions\` sets \`${entry.getText()}\`, which can carry a provider or gateway key.`, caution })
      return
    }
  }
}

/** Why a client looks like Azure OpenAI, or null. Only statically readable members are checked. */
function azureSignal(init: ObjectLiteralExpression): string | null {
  for (const member of init.getProperties()) {
    const name = memberName(member)
    const value = memberValue(member)
    if (!value) continue
    if (name === 'baseURL' && /azure/i.test(value.getText())) return 'its baseURL points at Azure'
    if ((name === 'defaultHeaders' || name === 'defaultQuery') && Node.isObjectLiteralExpression(value)) {
      const keys = value.getProperties().map((entry) => memberName(entry)?.toLowerCase())
      if (name === 'defaultHeaders' && keys.includes('api-key')) return 'it sends an `api-key` header'
      if (name === 'defaultQuery' && keys.includes('api-version')) return 'it sets `api-version`'
    }
  }
  return null
}

/** Remove the credential props; return members whose name cannot be known statically. */
function removeTopLevel(init: ObjectLiteralExpression, props: readonly string[]): string[] {
  const unknown: string[] = []
  const toRemove: ObjectLiteralElementLike[] = []
  for (const member of init.getProperties()) {
    if (Node.isSpreadAssignment(member)) {
      unknown.push(member.getText())
      continue
    }
    const name = memberName(member)
    if (name === null) {
      unknown.push(member.getNameNode().getText())
      continue
    }
    if (props.includes(name)) toRemove.push(member)
  }
  for (const member of toRemove.reverse()) member.remove()
  return unknown
}

function parseObject(objText: string): ObjectLiteralExpression | null {
  const project = new Project({ useInMemoryFileSystem: true })
  const sf = project.createSourceFile('options.ts', `const _ = ${objText}`)
  const init = sf.getVariableStatements()[0]?.getDeclarations()[0]?.getInitializer()
  return init && Node.isObjectLiteralExpression(init) ? init : null
}

function render(init: ObjectLiteralExpression): string {
  const trimmed = init.getText().trim()
  return /^\{\s*\}$/.test(trimmed) ? '' : trimmed
}

/** Static name of an object literal member, or null for a spread or a runtime-computed key. */
export function memberName(member: ObjectLiteralElementLike): string | null {
  if (Node.isSpreadAssignment(member)) return null
  const nameNode = member.getNameNode()
  if (Node.isIdentifier(nameNode) || Node.isPrivateIdentifier(nameNode)) return nameNode.getText()
  if (Node.isStringLiteral(nameNode) || Node.isNoSubstitutionTemplateLiteral(nameNode)) {
    return nameNode.getLiteralValue()
  }
  if (Node.isNumericLiteral(nameNode)) return nameNode.getText()
  if (Node.isComputedPropertyName(nameNode)) {
    const expr = nameNode.getExpression()
    if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) {
      return expr.getLiteralValue()
    }
  }
  return null
}

/** The value expression of `name: value` or shorthand `name`, or null for methods and accessors. */
function memberValue(member: ObjectLiteralElementLike): Node | null {
  if (Node.isPropertyAssignment(member)) return member.getInitializer() ?? null
  if (Node.isShorthandPropertyAssignment(member)) return member.getNameNode()
  return null
}
