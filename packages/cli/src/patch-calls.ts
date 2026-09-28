import { Node, SyntaxKind, type NewExpression, type SourceFile } from 'ts-morph'
import { joinOr, type Provider, type ProviderConfig } from './providers.js'
import { sanitizeOptions } from './patch-options.js'

/**
 * Constructor-call half of the patcher: decides, per `new Client(...)`, whether
 * the call can be rewritten to the Spanlens factory without letting a provider
 * credential or upstream baseURL through, and builds the replacement text.
 *
 * The rule is conservative on purpose. Only an inline object literal whose
 * every member has a statically known name is rewritten automatically, and
 * only after patch-options.ts has cleared the options that can carry a
 * credential one level down (`defaultHeaders`, `defaultQuery`, `fetch`,
 * `fetchOptions`). A variable, a spread, a computed key, or anything else we
 * cannot read is left untouched and reported as a manual edit, because
 * rewriting it blindly would either skip the proxy (leftover baseURL) or send
 * the provider key to Spanlens (leftover apiKey or Authorization header).
 */

export interface ManualEdit {
  provider: Provider
  /** 1-based line of the untouched call in the file as the wizard leaves it. */
  line: number
  /** Exact text of the call as it stands. */
  original: string
  /**
   * What the call should become once `unknownSources` and `cautions` are
   * dealt with, or null when the call must not be switched to this factory.
   */
  suggested: string | null
  /** Expressions the wizard could not inspect (`providerOptions`, `...opts`, `[key]`). */
  unknownSources: readonly string[]
  /** Option names that must not reach the factory. */
  mustNotSet: readonly string[]
  /** Checks the user has to make before the change, one sentence each. */
  cautions: readonly string[]
  /** Import line the user still has to add, or null when the file already has it. */
  factoryImport: string | null
  reason: string
}

export type CallPlan =
  /** `removed` lists nested option entries (credential headers) dropped from the call. */
  | { kind: 'auto'; node: NewExpression; replacement: string; removed: string[] }
  | { kind: 'manual'; node: NewExpression; edit: Omit<ManualEdit, 'line' | 'factoryImport'> }

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
    return { kind: 'auto', node, replacement: `${factory}()`, removed: [] }
  }

  const manual = (
    suggested: string | null,
    unknownSources: string[],
    reason: string,
    cautions: readonly string[] = [],
  ): CallPlan => ({
    kind: 'manual',
    node,
    edit: {
      provider,
      original: node.getText(),
      suggested,
      unknownSources,
      mustNotSet: cfg.credentialProps,
      cautions,
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

  const result = sanitizeOptions(first.getText(), {
    credentialProps: cfg.credentialProps,
    detectAzure: provider === 'openai',
  })
  switch (result.kind) {
    case 'ok':
      return { kind: 'auto', node, replacement: `${factory}(${result.text})`, removed: result.removed }
    case 'unsafe': {
      const listed = result.unknown.map((u) => `\`${u}\``).join(', ')
      return manual(
        `${factory}(${result.text})`,
        result.unknown,
        `The options include ${listed}, which the wizard cannot inspect.`,
      )
    }
    case 'review':
      return manual(`${factory}(${result.text})`, [], result.reason, result.cautions)
    case 'unsupported':
      return manual(null, [], result.reason, result.cautions)
  }
}

/** Human-readable instructions for one call the wizard left untouched. */
export function formatManualEdit(filepath: string, edit: ManualEdit): string[] {
  const lines: string[] = [`[${edit.provider}] ${filepath}:${edit.line}  ${edit.reason}`]
  if (edit.suggested === null) {
    lines.push(...prefixLines('    ', edit.original))
  } else {
    if (edit.factoryImport) lines.push(`  + ${edit.factoryImport}`)
    lines.push(...prefixLines('  - ', edit.original), ...prefixLines('  + ', edit.suggested))
  }
  lines.push(...edit.cautions.map((caution) => `  ${caution}`))
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
