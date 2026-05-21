import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Users · Spanlens Docs',
  description:
    'End-user attribution and per-user analytics for LLM usage. Tag requests with x-spanlens-user and see who is spending what.',
}

export default function UsersDocs() {
  return (
    <div>
      <h1>Users</h1>
      <p className="lead">
        Tag every LLM call with the end-user it originated from, and Spanlens aggregates per-user
        cost, request count, and behaviour at <a href="/users">/users</a>. Answer{' '}
        <em>&ldquo;Which of my customers is costing me the most LLM spend?&rdquo;</em> in one click.
      </p>

      <h2>How tagging works</h2>
      <p>
        Set the <code>x-spanlens-user</code> header on any proxied request. The value is a string
        of your choosing, Spanlens never interprets it. Typical patterns: your DB user UUID,
        email hash, or a workspace identifier.
      </p>
      <p>
        Easiest path with the SDK:
      </p>
      <CodeBlock language="ts">{`import { createOpenAI, withUser } from '@spanlens/sdk/openai'

const openai = createOpenAI()

await openai.chat.completions.create(
  { model: 'gpt-4o-mini', messages: [...] },
  { headers: { ...withUser(currentUser.id).headers } },
)`}</CodeBlock>
      <p>
        Anthropic / Gemini integrations expose the same <code>withUser()</code> /{' '}
        <code>with_user()</code> helper. For raw HTTP, just set the header directly.
      </p>

      <h2>What the dashboard shows</h2>
      <ul>
        <li>
          <strong><a href="/users">/users</a></strong>, sortable table of every tagged end-user
          with total requests, tokens, cost, average latency, error count, distinct models, and
          first/last seen.
        </li>
        <li>
          <strong>Row click</strong> opens <code>/users/[id]</code>, the same stats plus the last
          50 requests for that user, each linkable to its full <a href="/docs/features/requests">request detail</a>.
        </li>
        <li>
          <strong>Filter pivot</strong>, from any request drawer the user_id chip links to the
          analytics page; the small <em>filter</em> link next to it scopes <code>/requests</code> to
          just that user.
        </li>
        <li>
          <strong>Search</strong> the user ID column with substring match. URL-backed so you can
          share filtered views.
        </li>
      </ul>

      <h2>Sort options</h2>
      <table>
        <thead>
          <tr><th><code>sortBy</code></th><th>Behaviour</th></tr>
        </thead>
        <tbody>
          <tr><td><code>cost</code> (default)</td><td>Highest-spending users first.</td></tr>
          <tr><td><code>requests</code></td><td>Most-active users first.</td></tr>
          <tr><td><code>tokens</code></td><td>Heaviest token consumers (large prompts).</td></tr>
          <tr><td><code>last_seen</code></td><td>Most recently active first, useful for triage.</td></tr>
        </tbody>
      </table>

      <h2>API</h2>
      <p>Both endpoints scope to your organization automatically via JWT.</p>
      <CodeBlock language="bash">{`# List, sort by cost desc, page 1
GET /api/v1/users?sortBy=cost&sortDir=desc&page=1&limit=50

# Detail, aggregates + recent 50 requests
GET /api/v1/users/<user-id>?projectId=<optional>&from=<iso>&to=<iso>`}</CodeBlock>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>Untagged requests don&apos;t appear.</strong> Calls without an{' '}
          <code>x-spanlens-user</code> header are excluded from <code>/users</code>. Add the header
          everywhere you want attribution.
        </li>
        <li>
          <strong>No PII protection on the value.</strong> Whatever you put in the header is what
          gets stored. Hash emails or use opaque IDs if you don&apos;t want raw addresses in the
          dashboard.
        </li>
        <li>
          <strong>Time-range filtering is server-side but the UI uses defaults.</strong> The list
          view shows lifetime totals; pass <code>?from=…&amp;to=…</code> on the API to scope.
          Time-window picker in the UI is on the roadmap.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/requests">Requests</a>,{' '}
        <a href="/docs/sdk">SDK reference</a>,{' '}
        <a href="/users">/users</a> dashboard.
      </p>
    </div>
  )
}
