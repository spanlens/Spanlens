import { Node, SyntaxKind, type NewExpression, type SourceFile } from 'ts-morph'
import type { ProviderConfig } from './providers.js'

/**
 * Finds `new Client(...)` calls whose class comes from the provider package
 * through a form the wizard does not rewrite: CommonJS `require()`, a dynamic
 * `import()`, a namespace import, or `import { default as X }`. They are
 * reported as manual edits so the wizard never ends with "setup complete"
 * while those clients still call the provider directly.
 *
 * Only bindings that provably come from the provider package count. An
 * `OpenAI` class from `@langchain/openai` or `llamaindex` is not ours, and
 * neither is another class of the same package such as `AzureOpenAI`.
 */

export interface UnsupportedCall {
  node: NewExpression
  /** How the client reached the file, for example `require('openai')`. */
  source: string
  /** True when the binding comes from CommonJS `require()`. */
  commonJs: boolean
}

interface Binding {
  source: string
  commonJs: boolean
}

interface Bindings {
  /** Local names bound to the client class itself. */
  clients: Map<string, Binding>
  /** Local names bound to the whole module (`import * as m`, `const m = require(...)`). */
  modules: Map<string, Binding>
}

export function findUnsupportedCalls(
  sf: SourceFile,
  cfg: ProviderConfig,
  supportedLocalName: string | null,
): UnsupportedCall[] {
  const bindings = collectBindings(sf, cfg)
  bindings.clients.delete(supportedLocalName ?? '')
  const exported = clientExportNames(cfg)

  return sf.getDescendantsOfKind(SyntaxKind.NewExpression).flatMap((node): UnsupportedCall[] => {
    const callee = node.getExpression()
    const direct = Node.isIdentifier(callee) ? bindings.clients.get(callee.getText()) : undefined
    const viaModule =
      Node.isPropertyAccessExpression(callee) &&
      Node.isIdentifier(callee.getExpression()) &&
      exported.has(callee.getName())
        ? bindings.modules.get(callee.getExpression().getText())
        : undefined
    const binding = direct ?? viaModule
    return binding ? [{ node, ...binding }] : []
  })
}

/** Export names under which the package exposes the client class. */
function clientExportNames(cfg: ProviderConfig): Set<string> {
  return new Set(cfg.importStyle === 'default' ? [cfg.originalName, 'default'] : [cfg.originalName])
}

function collectBindings(sf: SourceFile, cfg: ProviderConfig): Bindings {
  const clients = new Map<string, Binding>()
  const modules = new Map<string, Binding>()
  const exported = clientExportNames(cfg)
  const mod = cfg.importedFrom

  for (const decl of sf.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue() !== mod || decl.isTypeOnly()) continue
    const namespace = decl.getNamespaceImport()
    if (namespace) {
      modules.set(namespace.getText(), { source: `import * as ${namespace.getText()} from '${mod}'`, commonJs: false })
    }
    for (const spec of decl.getNamedImports()) {
      if (spec.isTypeOnly() || spec.getName() !== 'default' || !exported.has('default')) continue
      const local = spec.getAliasNode()?.getText() ?? spec.getName()
      clients.set(local, { source: `import { default as ${local} } from '${mod}'`, commonJs: false })
    }
  }

  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer()
    const loaded = init ? moduleLoad(init, mod) : null
    if (!loaded) continue
    const binding: Binding = { source: `${loaded.call}('${mod}')`, commonJs: loaded.call === 'require' }
    const nameNode = decl.getNameNode()

    if (Node.isIdentifier(nameNode)) {
      if (loaded.member === null) {
        modules.set(nameNode.getText(), binding)
        // `const OpenAI = require('openai')`: the CommonJS entry is the class itself.
        if (cfg.importStyle === 'default' && loaded.call === 'require') clients.set(nameNode.getText(), binding)
      } else if (exported.has(loaded.member)) {
        clients.set(nameNode.getText(), binding)
      }
    } else if (Node.isObjectBindingPattern(nameNode) && loaded.member === null) {
      for (const element of nameNode.getElements()) {
        const imported = element.getPropertyNameNode()?.getText() ?? element.getName()
        if (exported.has(imported)) clients.set(element.getName(), binding)
      }
    }
  }

  return { clients, modules }
}

/**
 * Recognise `require('m')`, `import('m')`, `await import('m')`, optionally
 * followed by one member access (`require('m').default`).
 */
function moduleLoad(expr: Node, mod: string): { call: 'require' | 'import'; member: string | null } | null {
  let node = unwrap(expr)
  let member: string | null = null
  if (Node.isPropertyAccessExpression(node)) {
    member = node.getName()
    node = unwrap(node.getExpression())
  }
  if (!Node.isCallExpression(node)) return null
  const [arg] = node.getArguments()
  if (!arg || !Node.isStringLiteral(arg) || arg.getLiteralValue() !== mod) return null
  const callee = node.getExpression()
  if (callee.getKind() === SyntaxKind.ImportKeyword) return { call: 'import', member }
  if (Node.isIdentifier(callee) && callee.getText() === 'require') return { call: 'require', member }
  return null
}

function unwrap(node: Node): Node {
  let current = node
  while (
    Node.isAwaitExpression(current) ||
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isNonNullExpression(current)
  ) {
    current = current.getExpression()
  }
  return current
}
