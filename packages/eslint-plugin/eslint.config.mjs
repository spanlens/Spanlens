// Rules run inside other packages' lint, where console output is noise.
// Shared baseline: ../eslint.base.mjs.
import { packageConfig } from '../eslint.base.mjs'

export default packageConfig({ consoleLevel: 'error' })
