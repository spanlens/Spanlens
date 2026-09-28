import {
  Node,
  SyntaxKind,
  type Identifier,
  type ImportDeclaration,
  type ImportSpecifier,
  type SourceFile,
} from 'ts-morph'
import type { ProviderConfig } from './providers.js'

/**
 * Import half of the patcher. The provider import is only ever touched as
 * much as the rest of the file allows:
 *
 *   - still referenced (type alias, `OpenAI.Chat...` namespace type,
 *     `instanceof OpenAI`, a call we could not rewrite, re-export) → keep it
 *   - unreferenced but the declaration has other bindings
 *     (`import OpenAI, { APIError } from 'openai'`) → drop only our binding
 *   - unreferenced and alone → replace the declaration with the factory import
 *
 * The factory import is added next to the provider import in every case,
 * mirroring the file's quote and semicolon style.
 */

export interface FoundImport {
  decl: ImportDeclaration
  localName: string
  /** Which binding of `decl` is the client: the default import or a named specifier. */
  binding: 'default' | 'named'
}

export type ImportChange =
  | { kind: 'replaced' }
  | { kind: 'binding-removed'; kept: string[] }
  | { kind: 'kept' }

export interface ImportRewrite {
  change: ImportChange
  factoryImportAdded: boolean
}

/**
 * The top-level import that binds the client class. openai and
 * @anthropic-ai/sdk export the client both as the default export and under
 * its own name (`import { OpenAI } from 'openai'`), so both forms count; the
 * default import wins when a file has both.
 */
export function findProviderImport(sf: SourceFile, cfg: ProviderConfig): FoundImport | null {
  const decls = sf
    .getImportDeclarations()
    // `import type OpenAI from 'openai'` cannot be constructed with `new`.
    .filter((decl) => decl.getModuleSpecifierValue() === cfg.importedFrom && !decl.isTypeOnly())

  if (cfg.importStyle === 'default') {
    for (const decl of decls) {
      const defaultImport = decl.getDefaultImport()
      if (defaultImport) return { decl, localName: defaultImport.getText(), binding: 'default' }
    }
  }

  for (const decl of decls) {
    const spec = findClientSpecifier(decl, cfg)
    if (spec) return { decl, localName: localNameOf(spec), binding: 'named' }
  }
  return null
}

function findClientSpecifier(decl: ImportDeclaration, cfg: ProviderConfig): ImportSpecifier | undefined {
  return decl.getNamedImports().find((spec) => spec.getName() === cfg.originalName && !spec.isTypeOnly())
}

function localNameOf(spec: ImportSpecifier): string {
  return spec.getAliasNode()?.getText() ?? spec.getName()
}

/** The import line to add, in the same quote and semicolon style as `like`. */
export function factoryImportText(cfg: ProviderConfig, like: ImportDeclaration | null): string {
  const quote = like?.getModuleSpecifier().getText().startsWith('"') ? '"' : "'"
  const semi = like?.getText().trimEnd().endsWith(';') ? ';' : ''
  return `import { ${cfg.factoryName} } from ${quote}${cfg.spanlensSdk}${quote}${semi}`
}

export function hasFactoryImport(sf: SourceFile, cfg: ProviderConfig): boolean {
  return sf.getImportDeclarations().some(
    (decl) =>
      decl.getModuleSpecifierValue() === cfg.spanlensSdk &&
      !decl.isTypeOnly() &&
      decl
        .getNamedImports()
        .some((spec) => spec.getName() === cfg.factoryName && !spec.getAliasNode() && !spec.isTypeOnly()),
  )
}

/**
 * Rewrite the provider import after the constructor calls have been replaced.
 * Must run on the post-call-rewrite tree so references are counted exactly.
 */
export function rewriteProviderImport(sf: SourceFile, found: FoundImport, cfg: ProviderConfig): ImportRewrite {
  const { decl, localName } = found
  const needsFactory = !hasFactoryImport(sf, cfg)
  const importText = factoryImportText(cfg, decl)

  if (countReferences(sf, localName, decl) > 0) {
    if (needsFactory) insertAfter(sf, decl, importText)
    return { change: { kind: 'kept' }, factoryImportAdded: needsFactory }
  }

  const kept = otherBindings(found)
  if (kept.length === 0) {
    if (needsFactory) decl.replaceWithText(importText)
    else decl.remove()
    return { change: { kind: 'replaced' }, factoryImportAdded: needsFactory }
  }

  if (needsFactory) insertAfter(sf, decl, importText)
  removeOwnBinding(found)
  return { change: { kind: 'binding-removed', kept }, factoryImportAdded: needsFactory }
}

/**
 * Count identifiers that refer to `localName`, outside the import itself.
 * Deliberately over-counts (a shadowing local of the same name counts): the
 * cost of keeping an import we could have dropped is nil, the cost of
 * dropping one that is still used is a broken build.
 */
export function countReferences(sf: SourceFile, localName: string, exclude: ImportDeclaration): number {
  const start = exclude.getStart()
  const end = exclude.getEnd()
  return sf
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .filter((id) => id.getText() === localName)
    .filter((id) => id.getStart() < start || id.getStart() >= end)
    .filter((id) => !isMemberName(id)).length
}

/** True when the identifier is a property/member name rather than a reference. */
function isMemberName(id: Identifier): boolean {
  const parent = id.getParent()
  if (!parent) return false
  if (Node.isPropertyAccessExpression(parent)) return parent.getNameNode() === id
  if (Node.isQualifiedName(parent)) return parent.getRight() === id
  if (Node.isBindingElement(parent)) return parent.getPropertyNameNode() === id
  if (Node.isExportSpecifier(parent)) return parent.getAliasNode() === id
  if (
    Node.isPropertyAssignment(parent) ||
    Node.isPropertyDeclaration(parent) ||
    Node.isPropertySignature(parent) ||
    Node.isMethodDeclaration(parent) ||
    Node.isMethodSignature(parent) ||
    Node.isGetAccessorDeclaration(parent) ||
    Node.isSetAccessorDeclaration(parent) ||
    Node.isEnumMember(parent) ||
    Node.isJsxAttribute(parent)
  ) {
    return parent.getNameNode() === id
  }
  return false
}

/** Names of the bindings in the declaration other than the provider client itself. */
function otherBindings(found: FoundImport): string[] {
  const { decl } = found
  const names: string[] = []
  const defaultImport = decl.getDefaultImport()
  if (defaultImport && found.binding !== 'default') names.push(defaultImport.getText())
  const namespace = decl.getNamespaceImport()
  if (namespace) names.push(`* as ${namespace.getText()}`)
  for (const spec of decl.getNamedImports()) {
    if (!isOwnSpecifier(spec, found)) names.push(spec.getText())
  }
  return names
}

function removeOwnBinding(found: FoundImport): void {
  if (found.binding === 'default') {
    found.decl.removeDefaultImport()
    return
  }
  found.decl.getNamedImports().find((spec) => isOwnSpecifier(spec, found))?.remove()
}

function isOwnSpecifier(spec: ImportSpecifier, found: FoundImport): boolean {
  return found.binding === 'named' && !spec.isTypeOnly() && localNameOf(spec) === found.localName
}

function insertAfter(sf: SourceFile, decl: ImportDeclaration, text: string): void {
  sf.insertStatements(decl.getChildIndex() + 1, text)
}
