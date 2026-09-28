# @spanlens/mcp-server changelog

## 0.3.0

### Fixed

- API errors show their real message and code. The client read the server's `error` field as a string, but the server sends `{ error: { code, message, details, requestId } }`, so every failure, including a rejected key at startup, surfaced as `[object Object]` with no code. Both the current shape and the older flat `{ error, code }` shape are parsed, and `SpanlensApiError` now carries `requestId` and `details`.
- `groupBy: 'provider'` aggregates by provider. It used to return the same per-model rows as `groupBy: 'model'`. Request counts and cost are summed per provider, and average latency and error rate are weighted by request count.

### Added

- Every request to the Spanlens API has a timeout (30 seconds by default) that also covers reading the response body, and a stalled request fails with a clear timeout error. The key check at startup is bounded the same way, so an unresponsive API now stops startup with a timeout error after 30 seconds instead of hanging for up to five minutes. Set `SPANLENS_TIMEOUT_MS` to change the timeout.

## 0.2.1 and earlier

See the [`mcp-server-v*` tags](https://github.com/spanlens/Spanlens/tags) and the commit history of `packages/mcp-server`.
