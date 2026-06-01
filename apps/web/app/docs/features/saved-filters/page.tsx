import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Saved Filters · Spanlens Docs',
  description:
    'Save named filter combinations on the /requests page and restore them instantly from a dropdown on future visits.',
}

export default function SavedFiltersDocs() {
  return (
    <div>
      <h1>Saved Filters</h1>
      <p className="lead">
        Save any filter combination set on the <a href="/requests">/requests</a> page, provider,
        model, status, date range, and more, under a name, then restore the entire state in one
        click on future visits. Useful for recurring debug queries or shared team views.
      </p>

      <h2>How to use</h2>
      <ol>
        <li>
          Go to <a href="/requests">/requests</a> and configure your filters, provider, model,
          status, date range, etc.
        </li>
        <li>
          Click <strong>Save as filter</strong> on the right side of the filter bar.
        </li>
        <li>Enter a name (1–80 characters) and click <strong>Save</strong>.</li>
        <li>
          On future visits, select the saved name from the <strong>Saved filters</strong> dropdown
          in the filter bar to restore all filters at once.
        </li>
      </ol>

      <h2>Scope and isolation</h2>
      <p>
        Saved filters are <strong>per-user</strong>. Filters created by other members in the same
        organization are not visible, and only your own filters appear in the dropdown. This
        isolation is enforced at the database level via Row Level Security (RLS).
      </p>

      <h2>API</h2>
      <p>
        All endpoints require <strong>JWT authentication</strong> (<code>authJwt</code> middleware).
        Include <code>Authorization: Bearer &lt;supabase_access_token&gt;</code> in the request header.
      </p>

      <h3>List</h3>
      <CodeBlock language="bash">{`GET /api/v1/saved-filters

# Response: array sorted newest first
# [
#   {
#     "id": "sf_xxxxxxxx",
#     "name": "GPT-4o errors only",
#     "filters": { "provider": "openai", "model": "gpt-4o", "status": "5xx" },
#     "created_at": "2026-05-15T09:00:00.000Z"
#   },
#   ...
# ]`}</CodeBlock>

      <h3>Save</h3>
      <CodeBlock language="bash">{`POST /api/v1/saved-filters
Content-Type: application/json

{
  "name": "GPT-4o errors only",
  "filters": {
    "provider": "openai",
    "model": "gpt-4o",
    "status": "5xx"
  }
}

# 201 Created
# {
#   "id": "sf_xxxxxxxx",
#   "name": "GPT-4o errors only",
#   "filters": { "provider": "openai", "model": "gpt-4o", "status": "5xx" },
#   "created_at": "2026-05-15T09:00:00.000Z"
# }`}</CodeBlock>

      <h3>Delete</h3>
      <CodeBlock language="bash">{`DELETE /api/v1/saved-filters/:id

# 204 No Content`}</CodeBlock>

      <h2>Request / response schema</h2>
      <table className="[&_th:first-child]:text-left [&_th:nth-child(2)]:text-left [&_td:first-child]:text-left [&_td:nth-child(2)]:text-left [&_td:first-child]:whitespace-nowrap [&_td:nth-child(2)]:whitespace-nowrap [&_td:first-child]:align-middle [&_td:nth-child(2)]:align-middle">
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>name</code></td>
            <td><code>string</code></td>
            <td>1–80 characters. Must be unique per user, returns 409 on duplicate.</td>
          </tr>
          <tr>
            <td><code>filters</code></td>
            <td><code>object</code></td>
            <td>
              Free-form JSON object containing the filter values. Stored as JSONB without
              server-side parsing, the UI reads and writes it in its own format.
            </td>
          </tr>
          <tr>
            <td><code>id</code></td>
            <td><code>string</code></td>
            <td>Server-assigned identifier.</td>
          </tr>
          <tr>
            <td><code>created_at</code></td>
            <td><code>string (ISO 8601)</code></td>
            <td>Creation timestamp. The list is sorted by this value descending.</td>
          </tr>
        </tbody>
      </table>

      <h2>Error codes</h2>
      <table>
        <thead>
          <tr>
            <th>HTTP status</th>
            <th>Cause</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>400</code></td>
            <td><code>name</code> missing or too long, or <code>filters</code> is absent</td>
          </tr>
          <tr>
            <td><code>401</code></td>
            <td>JWT token missing or expired</td>
          </tr>
          <tr>
            <td><code>404</code></td>
            <td>Delete target ID does not exist or does not belong to the current user</td>
          </tr>
          <tr>
            <td><code>409</code></td>
            <td>A filter with the same name already exists for this user</td>
          </tr>
        </tbody>
      </table>

      <h2>curl examples</h2>
      <CodeBlock language="bash">{`# List saved filters
curl https://server.spanlens.io/api/v1/saved-filters \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"

# Save a filter
curl -X POST https://server.spanlens.io/api/v1/saved-filters \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Anthropic 429 errors","filters":{"provider":"anthropic","status":"4xx"}}'

# Delete a filter
curl -X DELETE https://server.spanlens.io/api/v1/saved-filters/sf_xxxxxxxx \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"`}</CodeBlock>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>No organization-wide sharing.</strong> Saved filters are private to the creating
          user. Shared team filters are on the roadmap.
        </li>
        <li>
          <strong>No filter validation.</strong> The server stores the <code>filters</code> object
          as-is without validating keys or values. An invalid filter value will be saved without
          error but may be ignored when the /requests UI applies it.
        </li>
        <li>
          <strong>100 filters per user maximum.</strong> Delete old filters before creating new
          ones if you hit this limit.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/requests">Requests</a> (filter view),{' '}
        <a href="/requests">/requests</a> dashboard.
      </p>
    </div>
  )
}
