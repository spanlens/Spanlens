# @spanlens/mcp-server

> Query your LLM observability data from inside Cursor, Continue, or Claude Desktop. Powered by [Spanlens](https://spanlens.io).

Ask your IDE's agent things like _"what's my OpenAI spend this week?"_, _"any cost anomalies?"_, or _"show me the most expensive trace today"_ — and get real answers from your Spanlens workspace through the [Model Context Protocol](https://modelcontextprotocol.io).

## 30-second setup

### 1. Issue a public-scope Spanlens key

Public-scope keys (`sl_live_pub_*`) are read-only — they can query your dashboard data but cannot trigger LLM proxy spend. **This server refuses to start with a full-access key** because the credential will live in a plaintext config file in your IDE.

Create one at **[spanlens.io/projects](https://spanlens.io/projects)** → the **Public Keys** card at the top → **+ New public key**. Copy the `sl_live_pub_…` value when it's shown.

### 2. Add the server to your IDE

<details open>
<summary><b>Cursor</b> — <code>~/.cursor/mcp.json</code> (or workspace <code>.cursor/mcp.json</code>)</summary>

```json
{
  "mcpServers": {
    "spanlens": {
      "command": "npx",
      "args": ["-y", "@spanlens/mcp-server"],
      "env": { "SPANLENS_API_KEY": "sl_live_pub_..." }
    }
  }
}
```

</details>

<details>
<summary><b>Claude Desktop</b> — <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> (macOS) or <code>%APPDATA%\Claude\claude_desktop_config.json</code> (Windows)</summary>

```json
{
  "mcpServers": {
    "spanlens": {
      "command": "npx",
      "args": ["-y", "@spanlens/mcp-server"],
      "env": { "SPANLENS_API_KEY": "sl_live_pub_..." }
    }
  }
}
```

</details>

<details>
<summary><b>Continue</b> — <code>~/.continue/config.yaml</code></summary>

```yaml
mcpServers:
  - name: spanlens
    command: npx
    args: ['-y', '@spanlens/mcp-server']
    env:
      SPANLENS_API_KEY: sl_live_pub_...
```

</details>

### 3. Reload your IDE and start asking

The agent will discover six tools and use them automatically when relevant.

## What you can ask

| Question | Tool called |
|---|---|
| "How much have we spent on LLMs this week?" | `get_stats` |
| "Break down cost by model for the last 30 days" | `get_stats(groupBy=model)` |
| "Any cost or latency anomalies?" | `get_anomalies` |
| "Show me the 10 most recent error calls on gpt-4o" | `query_requests` |
| "Walk me through trace `abc123…`" | `get_trace` |
| "What models could we swap to save money?" | `get_savings` |
| "Which end-user is driving the most spend?" | `get_user_analytics` |

## Available tools

| Tool | What it returns |
|---|---|
| `get_stats` | Aggregate cost, request count, token usage, latency, error rate. Optional `groupBy` for per-model or per-provider breakdown. |
| `query_requests` | Individual LLM requests with cost, latency, model, error message. Filter by `model`, `provider`, `status`, `userId`, `since`, `limit`. |
| `get_trace` | Full agent span tree for a trace ID — every LLM/tool/retrieval span with timing, tokens, cost. |
| `get_anomalies` | Cost / latency / error-rate anomalies the platform has detected. Optional `severity`. |
| `get_savings` | Model-swap recommendations with projected monthly savings and adoption status. |
| `get_user_analytics` | Per-end-user usage breakdown — total cost, request count, models touched, recent calls. |

## Safety

This server is designed for the IDE-config use case, where the credential sits in a plaintext file that's easy to leak (dotfile sync, screen shares, accidental commits). Two defenses:

1. **Public-scope keys only.** The server boots, calls `/api/v1/me/key-info` against your workspace, and verifies the key has `scope=public`. If you accidentally paste a full-access `sl_live_*` key, the server refuses to start with a clear error pointing at the correct key type.
2. **Read-only at the API layer.** Even if a public key leaks, it cannot call `/proxy/*` or `/ingest/*` — the Spanlens server enforces this with a 403 + `PUBLIC_KEY_WRITE_FORBIDDEN` code. The blast radius of a leak is "competitor sees my usage stats", not "competitor runs up my OpenAI bill".

## Configuration

| Environment variable | Default | Notes |
|---|---|---|
| `SPANLENS_API_KEY` | _required_ | A `sl_live_pub_*` key from the **Public Keys** card on `/projects`. The server refuses to start without one, and refuses to start with a `sl_live_*` (full) key. |
| `SPANLENS_BASE_URL` | `https://server.spanlens.io` | Override for self-hosted Spanlens. Trailing slashes are normalised. |

## Self-hosted Spanlens

```json
{
  "mcpServers": {
    "spanlens": {
      "command": "npx",
      "args": ["-y", "@spanlens/mcp-server"],
      "env": {
        "SPANLENS_API_KEY": "sl_live_pub_...",
        "SPANLENS_BASE_URL": "https://spanlens.your-company.com"
      }
    }
  }
}
```

## Links

- [Spanlens dashboard](https://spanlens.io)
- [Documentation](https://spanlens.io/docs)
- [Model Context Protocol spec](https://modelcontextprotocol.io)
- [Source on GitHub](https://github.com/spanlens/Spanlens/tree/main/packages/mcp-server)

## License

MIT — see [LICENSE](../../LICENSE) in the repo root.
