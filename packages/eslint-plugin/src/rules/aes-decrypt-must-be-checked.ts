import { ESLintUtils, AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils'

/**
 * Require an emptiness check after `await aes256Decrypt(...)`.
 *
 * `apps/server/src/lib/crypto.ts:aes256Decrypt` returns "" on every failure
 * mode (wrong key, tampered ciphertext, malformed input). A caller that
 * forgets to check produces a silent empty Authorization header upstream.
 *
 * The rule fires on the await expression. Recognised valid follow-ups,
 * looked at within the next three statements of the enclosing block:
 *
 *   if (!result) ...
 *   if (result.length === 0) ...
 *   if (result === '') ...
 *   if (!result || result.length === 0) ...
 *   if (result == '') / result == "" / result === "" (loose & strict)
 *
 * Anything else, including discarding the result via a non-VariableDeclarator
 * parent, is reported.
 */

const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/spanlens/spanlens/blob/main/packages/eslint-plugin/RULES.md#${name}`,
)

const DECRYPT_FUNCTION_NAME = 'aes256Decrypt'
const STATEMENTS_TO_INSPECT = 3

type AwaitWithCallee = TSESTree.AwaitExpression & {
  argument: TSESTree.CallExpression & {
    callee: TSESTree.Identifier
  }
}

function isDecryptAwait(node: TSESTree.AwaitExpression): node is AwaitWithCallee {
  return (
    node.argument.type === AST_NODE_TYPES.CallExpression &&
    node.argument.callee.type === AST_NODE_TYPES.Identifier &&
    node.argument.callee.name === DECRYPT_FUNCTION_NAME
  )
}

/**
 * Walk outward from the AwaitExpression until we find either a
 * VariableDeclarator (the result was named) or a Statement (the result
 * was discarded). Returns the VariableDeclarator + its declaring
 * VariableDeclaration if found, otherwise null.
 */
function findOwningDeclaration(await_: TSESTree.AwaitExpression): {
  varName: string
  declaration: TSESTree.VariableDeclaration
} | null {
  let cur: TSESTree.Node | undefined = await_.parent
  while (cur) {
    if (cur.type === AST_NODE_TYPES.VariableDeclarator) {
      if (cur.id.type !== AST_NODE_TYPES.Identifier) return null
      const parent = cur.parent
      if (!parent || parent.type !== AST_NODE_TYPES.VariableDeclaration) return null
      return { varName: cur.id.name, declaration: parent }
    }
    if (cur.type === AST_NODE_TYPES.AssignmentExpression) {
      if (cur.left.type !== AST_NODE_TYPES.Identifier) return null
      // Reassignment (`judgeApiKey = await ...`) — we treat the LHS the
      // same as a fresh binding for purposes of the next-3-statements
      // scan. Cast the enclosing ExpressionStatement to a Declaration-ish
      // sentinel by returning the surrounding statement as `declaration`.
      let stmt: TSESTree.Node | undefined = cur.parent
      while (stmt && stmt.type !== AST_NODE_TYPES.ExpressionStatement) {
        stmt = stmt.parent
      }
      if (!stmt) return null
      return {
        varName: cur.left.name,
        declaration: stmt as unknown as TSESTree.VariableDeclaration,
      }
    }
    if (
      cur.type === AST_NODE_TYPES.ExpressionStatement ||
      cur.type === AST_NODE_TYPES.IfStatement ||
      cur.type === AST_NODE_TYPES.ReturnStatement
    ) {
      return null
    }
    cur = cur.parent
  }
  return null
}

/**
 * Does this IfStatement test a known emptiness condition against `varName`?
 *
 * Recognised:
 *   !varName
 *   varName.length === 0   (also ==)
 *   varName === ''         (also ==, "")
 *   !varName.length
 *   varName.length < 1
 *   any LogicalExpression composed of the above (||, &&)
 *
 * The IfStatement consequent does NOT have to be a throw/return — any
 * branch the user took is fine, because the lint goal is "you explicitly
 * looked at the value." Encoding "the branch must throw" makes the rule
 * trip over legitimate `if (!key) { metrics.inc('decrypt-fail'); return null }`
 * patterns.
 */
function testChecksVar(node: TSESTree.Expression, varName: string): boolean {
  // !varName
  if (
    node.type === AST_NODE_TYPES.UnaryExpression &&
    node.operator === '!' &&
    node.argument.type === AST_NODE_TYPES.Identifier &&
    node.argument.name === varName
  ) {
    return true
  }

  // varName === '' / varName == ''
  if (
    node.type === AST_NODE_TYPES.BinaryExpression &&
    (node.operator === '===' || node.operator === '==')
  ) {
    const left = node.left
    const right = node.right
    const isEmpty = (n: TSESTree.Node): boolean =>
      n.type === AST_NODE_TYPES.Literal && (n.value === '' || n.value === 0)
    const isVar = (n: TSESTree.Node): boolean =>
      n.type === AST_NODE_TYPES.Identifier && n.name === varName
    const isLengthOfVar = (n: TSESTree.Node): boolean =>
      n.type === AST_NODE_TYPES.MemberExpression &&
      n.object.type === AST_NODE_TYPES.Identifier &&
      n.object.name === varName &&
      n.property.type === AST_NODE_TYPES.Identifier &&
      n.property.name === 'length'
    if ((isVar(left) && isEmpty(right)) || (isEmpty(left) && isVar(right))) return true
    if ((isLengthOfVar(left) && isEmpty(right)) || (isEmpty(left) && isLengthOfVar(right)))
      return true
  }

  // varName.length < 1   (also <=, !==)
  if (
    node.type === AST_NODE_TYPES.BinaryExpression &&
    (node.operator === '<' || node.operator === '<=') &&
    node.left.type === AST_NODE_TYPES.MemberExpression &&
    node.left.object.type === AST_NODE_TYPES.Identifier &&
    node.left.object.name === varName &&
    node.left.property.type === AST_NODE_TYPES.Identifier &&
    node.left.property.name === 'length' &&
    node.right.type === AST_NODE_TYPES.Literal &&
    typeof node.right.value === 'number' &&
    node.right.value <= 1
  ) {
    return true
  }

  // !varName.length
  if (
    node.type === AST_NODE_TYPES.UnaryExpression &&
    node.operator === '!' &&
    node.argument.type === AST_NODE_TYPES.MemberExpression &&
    node.argument.object.type === AST_NODE_TYPES.Identifier &&
    node.argument.object.name === varName &&
    node.argument.property.type === AST_NODE_TYPES.Identifier &&
    node.argument.property.name === 'length'
  ) {
    return true
  }

  // LogicalExpression ( ... || ... ) / ( ... && ... ) — recurse
  if (
    node.type === AST_NODE_TYPES.LogicalExpression &&
    (node.operator === '||' || node.operator === '&&')
  ) {
    return testChecksVar(node.left, varName) || testChecksVar(node.right, varName)
  }

  return false
}

export const aesDecryptMustBeChecked = createRule({
  name: 'aes-decrypt-must-be-checked',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require an empty-string check after `await aes256Decrypt(...)` to prevent silent fallthrough on decryption failure.',
    },
    schema: [],
    messages: {
      missingCheck:
        "aes256Decrypt() returns '' on every failure mode. Add an explicit check (`if (!{{ varName }}) ...`, `if ({{ varName }}.length === 0) ...`, or equivalent) within the next 3 statements before using the value.",
      noBinding:
        "aes256Decrypt() returns '' on every failure mode. Capture the result in a variable and check it before use — discarding the await result is almost certainly a bug.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      AwaitExpression(node) {
        if (!isDecryptAwait(node)) return

        const owning = findOwningDeclaration(node)
        if (!owning) {
          context.report({ node, messageId: 'noBinding' })
          return
        }

        const { varName, declaration } = owning

        // Find the enclosing block-like node so we can look at the next
        // statements. Both BlockStatement and Program have a `body` array.
        const block = declaration.parent
        if (
          !block ||
          (block.type !== AST_NODE_TYPES.BlockStatement &&
            block.type !== AST_NODE_TYPES.Program)
        ) {
          context.report({ node, messageId: 'missingCheck', data: { varName } })
          return
        }

        const idx = block.body.indexOf(declaration as unknown as TSESTree.Statement)
        if (idx === -1) {
          context.report({ node, messageId: 'missingCheck', data: { varName } })
          return
        }

        const next = block.body.slice(idx + 1, idx + 1 + STATEMENTS_TO_INSPECT)
        for (const stmt of next) {
          if (stmt.type !== AST_NODE_TYPES.IfStatement) continue
          if (testChecksVar(stmt.test, varName)) return
        }

        context.report({ node, messageId: 'missingCheck', data: { varName } })
      },
    }
  },
})
