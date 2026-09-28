// The onboarding wizard talks to the terminal through @clack/prompts, so a raw
// console.log is usually a leftover debug line. Warn instead of fail, matching
// apps/server. Shared baseline: ../eslint.base.mjs.
import { packageConfig } from '../eslint.base.mjs'

export default packageConfig({ consoleLevel: 'warn' })
