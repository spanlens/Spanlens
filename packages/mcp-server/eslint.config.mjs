// stdout is the MCP JSON-RPC channel for a stdio server: a stray console.log
// corrupts the protocol stream and the client drops the connection. Anything
// diagnostic goes to stderr (console.error). Shared baseline: ../eslint.base.mjs.
import { packageConfig } from '../eslint.base.mjs'

export default packageConfig({ consoleLevel: 'error' })
