import {
  Node,
  Project,
  SyntaxKind,
  type NewExpression,
  type ObjectLiteralElementLike,
  type SourceFile,
} from 'ts-morph'
import { joinOr, type Provider, type ProviderConfig } from './providers.js'

/**
 * Constructor-call half of the patcher: decides, per `new Client(...)`, whether
 * the call can be rewritten to the Spanlens factory without letting a provider
 * credential or upstream baseURL through, and builds the replacement text.
 *
 * The rule is conservative on purpose. Only an inline object literal whose
 * every member has a statically known name is rewritten automatically. A
 * variable, a spread, a computed key, or anything else we cannot read is left
 * untouched and reported as a manual edit, because rewriting it blindly would
 * either skip the proxy (leftover baseURL) or send the provider key to
 * Spanlens (leftover apiKey).
 */

export interface ManualEdit {
  provider: Provider
  /** 1-based line of the untouched call in the file as the wizard leaves it. */
  line: number
  /** Exact text of the call as it stands. */
  original: string
  /** What the call should become once `unknownSources` are cleaned up. */
  suggested: string
  /** Expressions the wizard could not inspect (`providerOptions`, `...opts`, `[key]`). */
  unknownSources: readonly string[]
  /** Option names that must not reach the factory. */
  mustNotSet: readonly string[]
  /** Import line the user still has to add, or null when the file already has it. */
  factoryImport: string | null
  reason: string
}

export type CallPlan =
  | { kind: 'auto'; node: NewExpression; replacement: string }
  | { kind: 'manual'; node: NewExpression; edit: Omit<ManualEdit, 'line' | 'factoryImport'> }

export type StripResult =
  | { kind: 'ok'; text: string }
  | { kind: 'unsafe'; text: string; unknown: string[] }

export function findNewCalls(sf: SourceFile, localName: string): NewExpression[] {
  return sf
    .getDescendantsOfKind(SyntaxKind.NewExpression)
    .filter((node) => node.getExpression().getText() === localName)
}

export function planCall(node: NewExpression, provider: Provider, cfg: ProviderConfig): CallPlan {
  const args = node.getArguments()
  const factory = cfg.factoryName

  // Gemini takes a positional apiKey only; createGemini() reads SPANLENS_API_KEY.
  if (cfg.argShape === 'string' || args.length === 0) {
    return { kind: 'auto', node, replacement: `${factory}()` }
  }

  const manual = (suggested: string, unknownSources: string[], reason: string): CallPlan => ({
    kind: 'manual',
    node,
    edit: {
      provider,
      original: node.getText(),
      suggested,
      unknownSources,
      mustNotSet: cfg.credentialProps,
      reason,
    },
  })

  const argsText = args.map((a) => a.getText()).join(', ')
  if (args.length > 1) {
    return manual(`${factory}(${argsText})`, [], 'The constructor has more than one argument, so the wizard left it alone.')
  }

  const first = args[0]!
  if (!Node.isObjectLiteralExpression(first)) {
    return manual(
      `${factory}(${argsText})`,
      [argsText],
      `The options come from \`${argsText}\`, which the wizard cannot inspect.`,
    )
  }

  const stripped = stripCredentialProps(first.getText(), cfg.credentialProps)
  if (stripped.kind === 'unsafe') {
    const listed = stripped.unknown.map((u) => `\`${u}\``).join(', ')
    return manual(
      `${factory}(${stripped.text})`,
      stripped.unknown,
      `The options include ${listed}, which the wizard cannot inspect.`,
    )
  }
  return { kind: 'auto', node, replacement: `${factory}(${stripped.text})` }
}

/**
 * Remove the credential props from an object literal's text. Other members,
 * comments, and trailing commas are preserved. Members whose name cannot be
 * known statically (spread, non-literal computed key) make the result unsafe.
 */
export function stripCredentialProps(objText: string, props: readonly string[]): StripResult {
  const project = new Project({ useInMemoryFileSystem: true })
  const sf = project.createSourceFile('options.ts', `const _ = ${objText}`)
  const init = sf.getVariableStatements()[0]?.getDeclarations()[0]?.getInitializer()
  if (!init || !Node.isObjectLiteralExpression(init)) {
    return { kind: 'unsafe', text: objText, unknown: [objText] }
  }

  const unknown: string[] = []
  const toRemove: ObjectLiteralElementLike[] = []
  for (const member of init.getProperties()) {
    if (Node.isSpreadAssignment(member)) {
      unknown.push(member.getText())
      continue
    }
    const nameNode = member.getNameNode()
    const name = staticName(nameNode)
    if (name === null) {
      unknown.push(nameNode.getText())
      continue
    }
    if (props.includes(name)) toRemove.push(member)
  }
  for (const member of toRemove.reverse()) member.remove()

  const trimmed = init.getText().trim()
  const text = /^\{\s*\}$/.test(trimmed) ? '' : trimmed
  return unknown.length > 0 ? { kind: 'unsafe', text, unknown } : { kind: 'ok', text }
}

/** Static property name of an object literal member, or null if it is computed at runtime. */
function staticName(nameNode: Node): string | null {
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

/** Human-readable instructions for one call the wizard left untouched. */
export function formatManualEdit(filepath: string, edit: ManualEdit): string[] {
  const lines: string[] = [`[${edit.provider}] ${filepath}:${edit.line}  ${edit.reason}`]
  if (edit.factoryImport) lines.push(`  + ${edit.factoryImport}`)
  lines.push(...prefixLines('  - ', edit.original), ...prefixLines('  + ', edit.suggested))
  if (edit.unknownSources.length > 0 && edit.mustNotSet.length > 0) {
    const names = joinOr(edit.mustNotSet)
    const computed = edit.unknownSources.filter((s) => s.startsWith('['))
    const values = edit.unknownSources.filter((s) => !s.startsWith('[')).map((s) => s.replace(/^\.\.\./, ''))
    if (values.length > 0) {
      lines.push(`  Before you make this change, ${quoteAll(values)} must not set ${names}.`)
    }
    if (computed.length > 0) {
      lines.push(`  Before you make this change, the computed key ${quoteAll(computed)} must not be ${names}.`)
    }
    lines.push(
      '  A provider key left there would be sent to Spanlens, and a leftover baseURL would send requests straight to the provider.',
    )
  }
  return lines
}

function quoteAll(items: readonly string[]): string {
  return items.map((s) => `\`${s}\``).join(' and ')
}

function prefixLines(prefix: string, text: string): string[] {
  return text.split(/\r?\n/).map((line) => `${prefix}${line}`)
}
