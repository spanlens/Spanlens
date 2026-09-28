import { Node, SyntaxKind, type Identifier, type ImportDeclaration, type SourceFile } from 'ts-morph'
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
}

export type ImportChange =
  | { kind: 'replaced' }
  | { kind: 'binding-removed'; kept: string[] }
  | { kind: 'kept' }

export interface ImportRewrite {
  change: ImportChange
  factoryImportAdded: boolean
}

export function findProviderImport(sf: SourceFile, cfg: ProviderConfig): FoundImport | null {
  for (const decl of sf.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue() !== cfg.importedFrom) continue
    // `import type OpenAI from 'openai'` cannot be constructed with `new`.
    if (decl.isTypeOnly()) continue

    if (cfg.importStyle === 'default') {
      const defaultImport = decl.getDefaultImport()
      if (defaultImport) return { decl, localName: defaultImport.getText() }
      continue
    }

    for (const spec of decl.getNamedImports()) {
      if (spec.getName() === cfg.originalName && !spec.isTypeOnly()) {
        const alias = spec.getAliasNode()
        return { decl, localName: alias ? alias.getText() : spec.getName() }
      }
    }
  }
  return null
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

  const kept = otherBindings(decl, cfg)
  if (kept.length === 0) {
    if (needsFactory) decl.replaceWithText(importText)
    else decl.remove()
    return { change: { kind: 'replaced' }, factoryImportAdded: needsFactory }
  }

  if (needsFactory) insertAfter(sf, decl, importText)
  removeOwnBinding(decl, cfg)
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

/** Names of the bindings in `decl` other than the provider client itself. */
function otherBindings(decl: ImportDeclaration, cfg: ProviderConfig): string[] {
  const names: string[] = []
  const defaultImport = decl.getDefaultImport()
  if (defaultImport && cfg.importStyle !== 'default') names.push(defaultImport.getText())
  const namespace = decl.getNamespaceImport()
  if (namespace) names.push(`* as ${namespace.getText()}`)
  for (const spec of decl.getNamedImports()) {
    const isOurs = cfg.importStyle === 'named' && spec.getName() === cfg.originalName && !spec.isTypeOnly()
    if (!isOurs) names.push(spec.getText())
  }
  return names
}

function removeOwnBinding(decl: ImportDeclaration, cfg: ProviderConfig): void {
  if (cfg.importStyle === 'default') {
    decl.removeDefaultImport()
    return
  }
  const spec = decl
    .getNamedImports()
    .find((s) => s.getName() === cfg.originalName && !s.isTypeOnly())
  spec?.remove()
}

function insertAfter(sf: SourceFile, decl: ImportDeclaration, text: string): void {
  sf.insertStatements(decl.getChildIndex() + 1, text)
}
