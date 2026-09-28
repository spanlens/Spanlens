import { normalizeServerUrl } from './server-url.js'

export interface Flags {
  subcommand: string
  dryRun: boolean
  /** Normalized server origin for self-hosted Spanlens, or null for the hosted service. */
  serverUrl: string | null
  /** Part of --server-url that was dropped while normalizing (path, query), if any. */
  droppedPath: string | null
  /** Set when the flags cannot be used; the wizard must stop instead of guessing. */
  error?: string
}

const SERVER_URL_FLAG = '--server-url'

export function parseFlags(argv: readonly string[]): Flags {
  const args = argv.slice(2)
  const base: Flags = {
    subcommand: args[0] ?? 'init',
    dryRun: args.includes('--dry-run'),
    serverUrl: null,
    droppedPath: null,
  }

  const raw = readServerUrlArg(args)
  if (raw === undefined) return base
  if (raw === null) {
    // Falling back to the hosted service here would send a self-hosted key
    // (and later, prompts) to api.spanlens.io. Stop instead.
    return { ...base, error: `${SERVER_URL_FLAG} needs a value, for example ${SERVER_URL_FLAG} https://spanlens.yourcompany.com` }
  }

  const normalized = normalizeServerUrl(raw)
  if (!normalized.ok) return { ...base, error: normalized.error }
  return { ...base, serverUrl: normalized.origin, droppedPath: normalized.droppedPath }
}

/** undefined = flag absent, null = flag present without a usable value. */
function readServerUrlArg(args: readonly string[]): string | null | undefined {
  const inline = args.find((a) => a.startsWith(`${SERVER_URL_FLAG}=`))
  if (inline !== undefined) return inline.slice(SERVER_URL_FLAG.length + 1) || null

  const idx = args.indexOf(SERVER_URL_FLAG)
  if (idx === -1) return undefined
  const value = args[idx + 1]
  return value === undefined || value.startsWith('--') ? null : value
}
