import { Hono } from 'hono'

/**
 * OpenAPI 3.0 spec for the Spanlens public REST API.
 *
 * Served as JSON at  GET /api/v1/openapi.json
 * Swagger UI at      GET /api/v1/docs
 *
 * Covers the externally useful endpoints only — internal cron, webhooks,
 * and invite-flow plumbing are intentionally omitted.
 */

const SPEC = {
  openapi: '3.0.3',
  info: {
    title: 'Spanlens API',
    version: '1.0.0',
    description:
      'REST API for Spanlens LLM observability. All authenticated endpoints require a Supabase JWT in `Authorization: Bearer <token>`. Proxy endpoints use a Spanlens API key.',
    contact: { email: 'support@spanlens.io' },
    license: { name: 'MIT', url: 'https://github.com/sunes26/Spanlens/blob/main/LICENSE' },
  },
  externalDocs: {
    description: 'Full documentation',
    url: 'https://www.spanlens.io/docs',
  },
  servers: [
    { url: 'https://spanlens-server.vercel.app', description: 'Production' },
    { url: 'http://localhost:3001', description: 'Local dev' },
  ],
  tags: [
    { name: 'Health',         description: 'Service health check' },
    { name: 'Waitlist',       description: 'Early-access waitlist (public)' },
    { name: 'Organizations',  description: 'Workspace management' },
    { name: 'Projects',       description: 'Project scoping' },
    { name: 'API Keys',       description: 'API key CRUD' },
    { name: 'Provider Keys',  description: 'Encrypted provider credentials' },
    { name: 'Requests',       description: 'LLM request log' },
    { name: 'Stats',          description: 'Aggregated metrics & latency' },
    { name: 'Traces',         description: 'Agent span traces' },
    { name: 'Prompts',        description: 'Prompt versioning & A/B' },
    { name: 'Anomalies',      description: 'Statistical anomaly detection' },
    { name: 'Security',       description: 'PII & injection scan results' },
    { name: 'Alerts',         description: 'Threshold-based alerting' },
    { name: 'Recommendations',description: 'Model swap suggestions' },
    { name: 'Members',        description: 'Team membership & roles' },
    { name: 'Proxy',          description: 'LLM proxy passthrough (API-key auth)' },
  ],
  components: {
    securitySchemes: {
      BearerJWT: {
        type: 'http',
        scheme: 'bearer',
        description: 'Supabase JWT obtained from `/auth/v1/token`. Valid for 1h; refresh via Supabase client.',
      },
      ApiKey: {
        type: 'http',
        scheme: 'bearer',
        description: 'Spanlens API key (starts with `sl_`). Created in Settings → API Keys.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Organization not found' },
        },
        required: ['error'],
      },
      Organization: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Acme Inc.' },
          slug: { type: 'string', example: 'acme-inc' },
          plan: { type: 'string', enum: ['free', 'starter', 'team', 'enterprise'] },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Project: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Production' },
          organization_id: { type: 'string', format: 'uuid' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      ApiKey: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'prod-key' },
          key_preview: { type: 'string', example: 'sl_live_abc...xyz' },
          project_id: { type: 'string', format: 'uuid' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Request: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          provider: { type: 'string', enum: ['openai', 'anthropic', 'gemini'] },
          model: { type: 'string', example: 'gpt-4o-mini' },
          prompt_tokens: { type: 'integer' },
          completion_tokens: { type: 'integer' },
          total_tokens: { type: 'integer' },
          cost_usd: { type: 'number', format: 'float', nullable: true },
          latency_ms: { type: 'integer' },
          proxy_overhead_ms: { type: 'integer', nullable: true },
          status_code: { type: 'integer' },
          flags: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', example: 'pii_email' },
                severity: { type: 'string', enum: ['low', 'medium', 'high'] },
              },
            },
          },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Trace: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'agent.run' },
          status: { type: 'string', enum: ['ok', 'error'] },
          total_tokens: { type: 'integer' },
          total_cost_usd: { type: 'number', format: 'float', nullable: true },
          duration_ms: { type: 'integer', nullable: true },
          span_count: { type: 'integer' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      StatsOverview: {
        type: 'object',
        properties: {
          totalRequests: { type: 'integer' },
          successRequests: { type: 'integer' },
          errorRequests: { type: 'integer' },
          totalCostUsd: { type: 'number' },
          totalTokens: { type: 'integer' },
          avgLatencyMs: { type: 'integer' },
        },
      },
      LatencyStats: {
        type: 'object',
        properties: {
          sampleCount: { type: 'integer' },
          overheadSampleCount: { type: 'integer' },
          hours: { type: 'integer' },
          provider: {
            type: 'object',
            properties: {
              p50Ms: { type: 'integer' },
              p95Ms: { type: 'integer' },
              p99Ms: { type: 'integer' },
              avgMs: { type: 'integer' },
            },
          },
          overhead: {
            type: 'object',
            properties: {
              p50Ms: { type: 'integer' },
              p95Ms: { type: 'integer' },
              p99Ms: { type: 'integer' },
              avgMs: { type: 'integer' },
              targetP95Ms: { type: 'integer', description: 'SLA target: p95 overhead < 50ms' },
              withinSla: { type: 'boolean' },
            },
          },
        },
      },
      Anomaly: {
        type: 'object',
        properties: {
          provider: { type: 'string' },
          model: { type: 'string' },
          metric: { type: 'string', enum: ['latency_ms', 'cost_usd'] },
          zScore: { type: 'number' },
          observed: { type: 'number' },
          baseline: { type: 'number' },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          detectedAt: { type: 'string', format: 'date-time' },
        },
      },
      ModelRecommendation: {
        type: 'object',
        properties: {
          currentModel: { type: 'string', example: 'gpt-4o' },
          suggestedModel: { type: 'string', example: 'gpt-4o-mini' },
          reason: { type: 'string' },
          estimatedMonthlySavingsUsd: { type: 'number' },
          sampleCount: { type: 'integer' },
        },
      },
      Member: {
        type: 'object',
        properties: {
          user_id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['admin', 'editor', 'viewer'] },
          joined_at: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        operationId: 'getHealth',
        security: [],
        responses: {
          200: {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/waitlist': {
      post: {
        tags: ['Waitlist'],
        summary: 'Join early-access waitlist',
        operationId: 'joinWaitlist',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  name: { type: 'string' },
                  company: { type: 'string' },
                  use_case: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Added to waitlist' },
          200: { description: 'Already registered (idempotent)' },
          400: { description: 'Invalid email', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/v1/organizations/me': {
      get: {
        tags: ['Organizations'],
        summary: 'Get active organization',
        operationId: 'getActiveOrg',
        security: [{ BearerJWT: [] }],
        responses: {
          200: {
            description: 'Active organization',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Organization' } } },
          },
          401: { description: 'Unauthorized' },
        },
      },
      patch: {
        tags: ['Organizations'],
        summary: 'Update organization name',
        operationId: 'updateOrg',
        security: [{ BearerJWT: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { name: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Updated' },
          401: { description: 'Unauthorized' },
          403: { description: 'Admin role required' },
        },
      },
    },
    '/api/v1/projects': {
      get: {
        tags: ['Projects'],
        summary: 'List projects',
        operationId: 'listProjects',
        security: [{ BearerJWT: [] }],
        responses: {
          200: {
            description: 'Project list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/Project' } },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Projects'],
        summary: 'Create project',
        operationId: 'createProject',
        security: [{ BearerJWT: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
            },
          },
        },
        responses: {
          201: { description: 'Created' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/api/v1/api-keys': {
      get: {
        tags: ['API Keys'],
        summary: 'List API keys',
        operationId: 'listApiKeys',
        security: [{ BearerJWT: [] }],
        parameters: [{ name: 'projectId', in: 'query', schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: {
            description: 'API key list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { data: { type: 'array', items: { $ref: '#/components/schemas/ApiKey' } } },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['API Keys'],
        summary: 'Create API key',
        operationId: 'createApiKey',
        security: [{ BearerJWT: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'projectId'],
                properties: {
                  name: { type: 'string' },
                  projectId: { type: 'string', format: 'uuid' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Created — raw key returned once, store it now',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    key: { type: 'string', description: 'Full API key — only shown on creation' },
                    id: { type: 'string', format: 'uuid' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/api-keys/{id}': {
      delete: {
        tags: ['API Keys'],
        summary: 'Revoke API key',
        operationId: 'deleteApiKey',
        security: [{ BearerJWT: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          204: { description: 'Revoked' },
          404: { description: 'Not found' },
        },
      },
    },
    '/api/v1/requests': {
      get: {
        tags: ['Requests'],
        summary: 'List LLM requests',
        operationId: 'listRequests',
        security: [{ BearerJWT: [] }],
        parameters: [
          { name: 'projectId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'provider', in: 'query', schema: { type: 'string', enum: ['openai', 'anthropic', 'gemini'] } },
          { name: 'model', in: 'query', schema: { type: 'string' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          200: {
            description: 'Request log',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/Request' } },
                    meta: { type: 'object', properties: { total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' } } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/requests/{id}': {
      get: {
        tags: ['Requests'],
        summary: 'Get request detail',
        operationId: 'getRequest',
        security: [{ BearerJWT: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Request detail', content: { 'application/json': { schema: { $ref: '#/components/schemas/Request' } } } },
          404: { description: 'Not found' },
        },
      },
    },
    '/api/v1/stats/overview': {
      get: {
        tags: ['Stats'],
        summary: 'Usage overview (totals)',
        operationId: 'statsOverview',
        security: [{ BearerJWT: [] }],
        parameters: [
          { name: 'projectId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: {
          200: {
            description: 'Stats overview',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/StatsOverview' } } },
          },
        },
      },
    },
    '/api/v1/stats/timeseries': {
      get: {
        tags: ['Stats'],
        summary: 'Daily request/cost timeseries',
        operationId: 'statsTimeseries',
        security: [{ BearerJWT: [] }],
        parameters: [
          { name: 'projectId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: { 200: { description: 'Timeseries data' } },
      },
    },
    '/api/v1/stats/latency': {
      get: {
        tags: ['Stats'],
        summary: 'Proxy latency percentiles',
        description: 'Returns p50/p95/p99 for provider latency and proxy overhead. Use `overhead.withinSla` to verify p95 overhead < 50ms SLA.',
        operationId: 'statsLatency',
        security: [{ BearerJWT: [] }],
        parameters: [
          { name: 'hours', in: 'query', schema: { type: 'integer', default: 24 }, description: 'Lookback window (max 720h)' },
        ],
        responses: {
          200: {
            description: 'Latency percentiles',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LatencyStats' } } },
          },
        },
      },
    },
    '/api/v1/traces': {
      get: {
        tags: ['Traces'],
        summary: 'List agent traces',
        operationId: 'listTraces',
        security: [{ BearerJWT: [] }],
        parameters: [
          { name: 'projectId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          200: { description: 'Trace list', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Trace' } } } } } } },
        },
      },
    },
    '/api/v1/traces/{id}': {
      get: {
        tags: ['Traces'],
        summary: 'Get trace + spans',
        operationId: 'getTrace',
        security: [{ BearerJWT: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Trace with spans' }, 404: { description: 'Not found' } },
      },
    },
    '/api/v1/anomalies': {
      get: {
        tags: ['Anomalies'],
        summary: 'List detected anomalies',
        description: '3-sigma deviations vs 7-day rolling baseline per model/provider.',
        operationId: 'listAnomalies',
        security: [{ BearerJWT: [] }],
        parameters: [
          { name: 'projectId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'hours', in: 'query', schema: { type: 'integer', default: 1 } },
        ],
        responses: {
          200: {
            description: 'Anomalies list',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Anomaly' } } } } } },
          },
        },
      },
    },
    '/api/v1/recommendations': {
      get: {
        tags: ['Recommendations'],
        summary: 'Model swap recommendations',
        description: 'Ranked list of cheaper model alternatives based on your actual traffic.',
        operationId: 'listRecommendations',
        security: [{ BearerJWT: [] }],
        responses: {
          200: {
            description: 'Recommendations',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/ModelRecommendation' } } } } } },
          },
        },
      },
    },
    '/api/v1/organizations/{orgId}/members': {
      get: {
        tags: ['Members'],
        summary: 'List members',
        operationId: 'listMembers',
        security: [{ BearerJWT: [] }],
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Member list', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Member' } } } } } } },
        },
      },
    },
    '/api/v1/organizations/{orgId}/members/{userId}': {
      patch: {
        tags: ['Members'],
        summary: 'Update member role',
        operationId: 'updateMemberRole',
        security: [{ BearerJWT: [] }],
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['role'], properties: { role: { type: 'string', enum: ['admin', 'editor', 'viewer'] } } } } },
        },
        responses: { 200: { description: 'Updated' }, 403: { description: 'Admin required' } },
      },
      delete: {
        tags: ['Members'],
        summary: 'Remove member',
        operationId: 'removeMember',
        security: [{ BearerJWT: [] }],
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { 204: { description: 'Removed' }, 400: { description: 'Cannot remove last admin' } },
      },
    },
    '/proxy/openai/v1/{path}': {
      post: {
        tags: ['Proxy'],
        summary: 'OpenAI passthrough',
        description: 'Drop-in replacement for `https://api.openai.com/v1`. Uses the provider key stored in Settings.',
        operationId: 'proxyOpenai',
        security: [{ ApiKey: [] }],
        parameters: [{ name: 'path', in: 'path', required: true, schema: { type: 'string', example: 'chat/completions' } }],
        requestBody: { description: 'Standard OpenAI request body', required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 200: { description: 'Proxied OpenAI response' }, 400: { description: 'No provider key configured' }, 429: { description: 'Quota exceeded' } },
      },
    },
    '/proxy/anthropic/v1/{path}': {
      post: {
        tags: ['Proxy'],
        summary: 'Anthropic passthrough',
        operationId: 'proxyAnthropic',
        security: [{ ApiKey: [] }],
        parameters: [{ name: 'path', in: 'path', required: true, schema: { type: 'string', example: 'messages' } }],
        requestBody: { description: 'Standard Anthropic request body', required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 200: { description: 'Proxied Anthropic response' }, 400: { description: 'No provider key configured' } },
      },
    },
    '/proxy/gemini/v1/{path}': {
      post: {
        tags: ['Proxy'],
        summary: 'Gemini passthrough',
        operationId: 'proxyGemini',
        security: [{ ApiKey: [] }],
        parameters: [{ name: 'path', in: 'path', required: true, schema: { type: 'string', example: 'models/gemini-1.5-flash:generateContent' } }],
        requestBody: { description: 'Standard Gemini request body', required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 200: { description: 'Proxied Gemini response' }, 400: { description: 'No provider key configured' } },
      },
    },
  },
}

export const openapiRouter = new Hono()

// Serve raw OpenAPI JSON spec
openapiRouter.get('/openapi.json', (c) => {
  return c.json(SPEC)
})

// Swagger UI (CDN, no extra npm deps)
openapiRouter.get('/docs', (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Spanlens API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    SwaggerUIBundle({
      url: '/api/v1/openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      deepLinking: true,
    })
  </script>
</body>
</html>`
  return c.html(html)
})
