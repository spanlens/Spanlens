# P3-20: GitHub README updates

**Target**: https://github.com/spanlens/Spanlens/blob/main/README.md
**Edit pattern**: PR or direct commit on a feature branch

## Recommended README structure (top-down)

```markdown
<p align="center">
  <a href="https://www.spanlens.io">
    <img src="https://www.spanlens.io/icon.png" width="120" alt="Spanlens">
  </a>
</p>

<h1 align="center">Spanlens</h1>

<p align="center">
  <strong>Open-source LLM observability. One line to integrate. Self-hostable.</strong>
</p>

<p align="center">
  <a href="https://github.com/spanlens/Spanlens/stargazers"><img src="https://img.shields.io/github/stars/spanlens/Spanlens?style=social" alt="GitHub stars"></a>
  <a href="https://github.com/spanlens/Spanlens/blob/main/LICENSE"><img src="https://img.shields.io/github/license/spanlens/Spanlens" alt="MIT License"></a>
  <a href="https://www.npmjs.com/package/@spanlens/sdk"><img src="https://img.shields.io/npm/v/@spanlens/sdk" alt="npm version"></a>
  <a href="https://www.spanlens.io/docs/quick-start"><img src="https://img.shields.io/badge/docs-quick--start-blue" alt="Docs"></a>
</p>

<p align="center">
  <a href="https://www.spanlens.io">Website</a> ·
  <a href="https://www.spanlens.io/docs">Docs</a> ·
  <a href="https://www.spanlens.io/compare">Compare</a> ·
  <a href="https://www.spanlens.io/pricing">Pricing</a> ·
  <a href="https://blog.spanlens.io">Blog</a>
</p>

---

## What is Spanlens?

Drop-in LLM observability for OpenAI, Anthropic, and Gemini. Spanlens logs every API call in one line of code: cost, latency, tokens, full request and response. Then it traces multi-step agents, catches anomalies, masks PII, and recommends cheaper models with dollar-figure savings.

- 🔌 **One line.** Change your `baseURL` or swap your SDK import. Same surface, every call captured.
- 💵 **Cost down to the request.** USD per call, per customer, per prompt version. Find the burnaway in minutes.
- 🌳 **Agent tracing with critical path.** Multi-step LangGraph / LangChain / CrewAI flows render as waterfall span trees with the bottleneck highlighted automatically.
- 🧪 **Prompt A/B with statistics.** Welch's t-test on latency and cost, two-proportion z-test on error rate. Promote winners with confidence.
- 🛡️ **Security by default.** Provider keys encrypted at rest (AES-256-GCM). PII detectors flag at log time. API keys auto-masked before persistence.
- 🐳 **Self-host with one command.** `docker compose up`. No ee/ folder. Every feature in OSS.

## Quick start

```bash
npm install @spanlens/sdk
```

```ts
import { createOpenAI } from '@spanlens/sdk/openai'

// Drop-in replacement for new OpenAI()
const openai = createOpenAI() // reads SPANLENS_API_KEY from env

const response = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'hello' }],
})
```

That's it. Open https://www.spanlens.io/requests in the dashboard and the call is there with cost, latency, and the full body.

Python, Java, Go, raw HTTP, and OpenTelemetry are also supported — see [/docs/quick-start](https://www.spanlens.io/docs/quick-start).

## Comparisons

- [Spanlens vs Langfuse](https://www.spanlens.io/compare/langfuse)
- [Spanlens vs Helicone](https://www.spanlens.io/compare/helicone)
- [Spanlens vs LangSmith](https://www.spanlens.io/compare/langsmith)
- [Spanlens vs Braintrust](https://www.spanlens.io/compare/braintrust)
- [Spanlens vs Arize Phoenix](https://www.spanlens.io/compare/arize-phoenix)

## Self-hosting

```bash
git clone https://github.com/spanlens/Spanlens.git
cd Spanlens
cp .env.example .env
docker compose up
```

Stack: Next.js 14 + Hono + Supabase Postgres + ClickHouse. Full guide: [/docs/self-host](https://www.spanlens.io/docs/self-host).

## License

MIT. The whole repo, no `ee/` folder. What you self-host is what we run.

## Contributing

Issues, feature requests, and pull requests welcome. See the open issues tab and feel free to claim anything.
```

## Key changes vs current README (if applicable)

1. Centered logo + star badge above the H1
2. One-line value prop directly under the title
3. Five badges (star, license, npm, docs, compare) for at-a-glance credibility
4. Six-bullet feature summary with emoji anchors (scannable)
5. Quick start in the first scroll — no scrolling to find the install command
6. Comparison links visible above the fold (turns the README into a comparison hub for visitors)
7. Self-hosting block with the literal commands
