import type { IncomingMessage, ServerResponse } from 'node:http'

export const runtime = 'nodejs'

// Static re-export (export { default } from '...') causes ERR_REQUIRE_ESM at
// runtime: the monorepo root has no "type":"module" so this file compiles to
// CJS, but apps/server uses "type":"module" (ESM). CJS cannot require() ESM.
//
// Dynamic import() works in both CJS and ESM and is the standard cross-system
// bridge. The import is cached by Node after the first cold start.
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const { default: serverHandler } = await import('../apps/server/api/index.js')
  return serverHandler(req, res)
}
