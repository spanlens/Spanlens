import type { Provider } from './providers.js'
import { proxyEndpoints } from './server-url.js'

export interface NextStepsInput {
  /** Normalized origin of a self-hosted Spanlens server, or null for the hosted service. */
  serverOrigin: string | null
  dashboardUrl: string
  providers: readonly Provider[]
}

export interface Formatter {
  bold(s: string): string
  cyan(s: string): string
  dim(s: string): string
  underline(s: string): string
}

const plain: Formatter = {
  bold: (s) => s,
  cyan: (s) => s,
  dim: (s) => s,
  underline: (s) => s,
}

/** Lines for the closing "Next steps" note. */
export function buildNextSteps(input: NextStepsInput, fmt: Formatter = plain): string[] {
  return input.serverOrigin ? selfHostedSteps(input.serverOrigin, input.providers, fmt) : hostedSteps(input.dashboardUrl, fmt)
}

function hostedSteps(dashboardUrl: string, fmt: Formatter): string[] {
  return [
    `${fmt.bold('1.')} Add ${fmt.cyan('SPANLENS_API_KEY')} to your deployment environment`,
    `     ${fmt.dim('(Vercel/Railway/Fly → Settings → Environment Variables)')}`,
    '',
    `${fmt.bold('2.')} Redeploy your app`,
    '',
    `${fmt.bold('3.')} Your requests will show up at:`,
    `     ${fmt.underline(`${dashboardUrl}/requests`)}`,
  ]
}

function selfHostedSteps(origin: string, providers: readonly Provider[], fmt: Formatter): string[] {
  const endpoints = proxyEndpoints(origin, providers)
  return [
    `${fmt.bold('1.')} Add ${fmt.cyan('SPANLENS_API_KEY')} and ${fmt.cyan('SPANLENS_BASE_URL')} to your deployment environment`,
    `     ${fmt.dim(`SPANLENS_BASE_URL=${origin}`)}`,
    '',
    `${fmt.bold('2.')} Redeploy your app`,
    '',
    endpoints.length > 0
      ? `${fmt.bold('3.')} @spanlens/sdk reads SPANLENS_BASE_URL, so your app sends requests to your server at:`
      : `${fmt.bold('3.')} @spanlens/sdk reads SPANLENS_BASE_URL, so your app sends requests to your server at ${fmt.underline(origin)}`,
    ...endpoints.map((e) => `     ${fmt.underline(e.url)}`),
    `   They show up on the Requests page of your Spanlens dashboard.`,
  ]
}
