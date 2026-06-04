#!/usr/bin/env node
/**
 * @spanlens/mcp-server — Model Context Protocol server for Spanlens.
 *
 * Stdio transport only for now. Mounts in any MCP client (Cursor, Continue,
 * Claude Desktop) by adding an entry to that client's config that runs
 * `spanlens-mcp` with `SPANLENS_API_KEY` in the environment.
 *
 * Safety stance:
 *   The API key for this server SHOULD be a `scope=public` Spanlens key
 *   (`sl_live_pub_*`). The server refuses to start when given a full-access
 *   `sl_live_*` key because the key lives in a plaintext IDE config file —
 *   a higher-leak-surface location than the customer's production env. A
 *   leaked public key can only read dashboard data; a leaked full key can
 *   trigger proxy spend on the user's account.
 *
 *   This check is enforced via `/api/v1/me/key-info` (which returns `scope`)
 *   on startup, not a prefix sniff — the network call is the canonical
 *   validation AND it confirms the key is actually live.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { SpanlensApiError, SpanlensClient } from './client.js'
import { registerTools } from './tools.js'
import { SERVER_VERSION } from './version.js'

// All diagnostics go to stderr — stdout is the MCP transport channel.
const log = (msg: string): void => {
  process.stderr.write(`[spanlens-mcp] ${msg}\n`)
}

async function main(): Promise<void> {
  const apiKey = process.env['SPANLENS_API_KEY']
  if (!apiKey) {
    log('SPANLENS_API_KEY is required. See https://spanlens.io/docs/integrations/mcp')
    process.exit(1)
  }

  const baseUrl = process.env['SPANLENS_BASE_URL'] ?? undefined
  const client = new SpanlensClient(baseUrl ? { apiKey, baseUrl } : { apiKey })

  // Validate the key + enforce public scope BEFORE binding the transport.
  // If we let a full-access key through and somebody discovers the config
  // file, the leaked key could be used to incur LLM spend — exactly the
  // attack vector public scope was introduced to neutralise.
  try {
    const info = await client.keyInfo()
    if (info.scope !== 'public') {
      log(
        'SPANLENS_API_KEY has scope="full". Refusing to start — use a public-scope key for MCP.',
      )
      log(
        'Issue one at https://spanlens.io/projects (Public Keys card) and re-run with the sl_live_pub_… value.',
      )
      process.exit(1)
    }
    log(`authenticated · scope=public · v${SERVER_VERSION}`)
  } catch (err) {
    if (err instanceof SpanlensApiError) {
      log(`auth failed (${err.status}): ${err.message}`)
    } else {
      log(`auth failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    process.exit(1)
  }

  const server = new McpServer({
    name: 'spanlens',
    version: SERVER_VERSION,
  })

  registerTools(server, client)

  const transport = new StdioServerTransport()
  await server.connect(transport)
  log('mcp transport connected (stdio)')
}

main().catch((err) => {
  log(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
  process.exit(1)
})
