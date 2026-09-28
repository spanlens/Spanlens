// A library must not write to the host app's stdout, so console.log is an
// error here. console.warn / console.error stay allowed for misconfiguration
// notices. Shared baseline: ../eslint.base.mjs.
import { packageConfig } from '../eslint.base.mjs'

export default packageConfig({ consoleLevel: 'error' })
