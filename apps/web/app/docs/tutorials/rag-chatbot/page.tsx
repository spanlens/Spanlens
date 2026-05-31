import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Add observability to a RAG chatbot · Spanlens Docs',
  description:
    'End-to-end tutorial. Take a basic RAG chatbot, add Spanlens, and see retrieval + generation as one trace with token cost and per-step latency.',
  alternates: { canonical: '/docs/tutorials/rag-chatbot' },
}

export default function RagChatbotTutorial() {
  return (
    <div>
      <h1>Tutorial: add observability to a RAG chatbot</h1>
      <p className="lead">
        Forty minutes. We start with a minimal RAG chatbot (Pinecone + OpenAI), add
        Spanlens, and end with a dashboard that shows each user question as a single trace
        with retrieval, generation, and per-step cost broken out.
      </p>

      <h2>What you will end up with</h2>
      <ul>
        <li>Every chat turn logged to <a href="/requests">/requests</a> with model, tokens, cost, latency.</li>
        <li>
          Every chat turn shown as one trace in <a href="/traces">/traces</a> with two
          spans: retrieval (Pinecone) and generation (OpenAI).
        </li>
        <li>End-user grouping in <a href="/users">/users</a> via <code>x-spanlens-user</code>.</li>
        <li>Conversation grouping via <code>x-spanlens-session</code>.</li>
      </ul>

      <h2>Starting point</h2>
      <p>
        This is a tiny TypeScript chatbot: an Express route that takes a question, embeds
        it, fetches relevant docs from Pinecone, and asks GPT-4o-mini for an answer. No
        observability yet.
      </p>
      <CodeBlock language="ts">{`// routes/chat.ts (BEFORE)
import OpenAI from 'openai'
import { Pinecone } from '@pinecone-database/pinecone'

const openai = new OpenAI()
const pinecone = new Pinecone()
const index = pinecone.index('kb')

export async function chat(req, res) {
  const { question, userId, sessionId } = req.body

  // 1. embed the question
  const embedRes = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: question,
  })
  const vector = embedRes.data[0].embedding

  // 2. retrieve
  const matches = await index.query({ vector, topK: 5, includeMetadata: true })
  const context = matches.matches.map(m => m.metadata?.text).join('\\n\\n')

  // 3. generate
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'Answer using the context.' },
      { role: 'user', content: \`Context:\\n\${context}\\n\\nQuestion: \${question}\` },
    ],
  })

  res.json({ answer: completion.choices[0].message.content })
}`}</CodeBlock>

      <h2>Step 1. Add Spanlens to the project</h2>
      <CodeBlock language="bash">{`pnpm add @spanlens/sdk`}</CodeBlock>
      <p>
        Get a project API key from <a href="/projects">/projects</a> and add it to your
        env:
      </p>
      <CodeBlock language="env">{`SPANLENS_API_KEY=sl_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}</CodeBlock>
      <p>
        In the same dashboard, click <strong>+ Add provider key</strong> on the project
        card and paste your real OpenAI key. Then remove <code>OPENAI_API_KEY</code> from
        your <code>.env</code> file. Your provider key lives server-side from now on.
      </p>

      <h2>Step 2. Swap the OpenAI client</h2>
      <p>One-line change. The rest of the OpenAI calls stay the same.</p>
      <CodeBlock language="ts">{`// BEFORE
import OpenAI from 'openai'
const openai = new OpenAI()

// AFTER
import { createOpenAI } from '@spanlens/sdk/openai'
const openai = createOpenAI()  // reads SPANLENS_API_KEY from env`}</CodeBlock>
      <p>
        Both <code>openai.embeddings.create()</code> and{' '}
        <code>openai.chat.completions.create()</code> now flow through the proxy. Open{' '}
        <a href="/requests">/requests</a>: you should see two rows per chat turn, one for
        the embedding and one for the completion, each with cost, tokens, and full body.
      </p>

      <h2>Step 3. Group the two calls under one trace</h2>
      <p>
        Right now embedding and generation are independent rows. To see them as one user
        interaction, wrap the route in a trace and add a retrieval span for the Pinecone
        call. The retrieval span is what tells Spanlens which 120 ms of the 1.4 s came
        from the vector DB.
      </p>
      <CodeBlock language="ts">{`import { SpanlensClient, observe } from '@spanlens/sdk'
import { createOpenAI, withUser, withSession } from '@spanlens/sdk/openai'
import { Pinecone } from '@pinecone-database/pinecone'

const client = new SpanlensClient()
const openai = createOpenAI()
const pinecone = new Pinecone()
const index = pinecone.index('kb')

export async function chat(req, res) {
  const { question, userId, sessionId } = req.body

  const trace = client.startTrace({
    name: 'rag-chat-turn',
    metadata: { user_id: userId, session_id: sessionId },
  })

  try {
    const headers = {
      ...withUser(userId).headers,
      ...withSession(sessionId).headers,
    }

    // 1. embed (LLM span happens automatically via the proxy)
    const embedRes = await openai.embeddings.create(
      { model: 'text-embedding-3-small', input: question },
      { headers },
    )
    const vector = embedRes.data[0].embedding

    // 2. retrieval span (Pinecone is not an LLM, so we wrap it ourselves)
    const matches = await observe(
      trace,
      { name: 'pinecone.query', spanType: 'retrieval', input: { topK: 5 } },
      async () => index.query({ vector, topK: 5, includeMetadata: true }),
    )
    const context = matches.matches.map(m => m.metadata?.text).join('\\n\\n')

    // 3. generate (LLM span happens automatically via the proxy)
    const completion = await openai.chat.completions.create(
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Answer using the context.' },
          { role: 'user', content: \`Context:\\n\${context}\\n\\nQuestion: \${question}\` },
        ],
      },
      { headers },
    )

    res.json({ answer: completion.choices[0].message.content })
  } finally {
    await trace.end()
  }
}`}</CodeBlock>
      <p>
        Three things to notice in this diff:
      </p>
      <ul>
        <li>
          The two OpenAI calls did not need <code>observe()</code> wrapping. The proxy
          itself emits LLM spans automatically.
        </li>
        <li>
          The Pinecone call needed <code>observe()</code> with{' '}
          <code>spanType: &apos;retrieval&apos;</code>{' '}
          because it is not a Spanlens-aware client.
        </li>
        <li>
          <code>withUser</code> and <code>withSession</code> set request headers, which
          become <code>user_id</code> and <code>session_id</code> on each Request row.
        </li>
      </ul>

      <h2>Step 4. Verify in the dashboard</h2>
      <ol>
        <li>Hit the route once with <code>{`{ question: 'What is the refund policy?', userId: 'u_123', sessionId: 's_abc' }`}</code>.</li>
        <li>
          Open <a href="/traces">/traces</a>. A new trace appears titled{' '}
          <code>rag-chat-turn</code> with three child spans: embedding (LLM), pinecone.query
          (retrieval), and the completion (LLM).
        </li>
        <li>
          Click the trace. The waterfall shows per-step time. The cost panel sums the two
          LLM calls.
        </li>
        <li>
          Open <a href="/users">/users</a>. <code>u_123</code> shows up with one trace and
          the rolled-up cost.
        </li>
      </ol>

      <h2>Step 5. Add prompt versioning so you can A/B test</h2>
      <p>
        The system prompt is the part you will iterate on. Register it as a Spanlens
        prompt version so future tweaks show up as a comparable A/B in{' '}
        <a href="/prompts">/prompts</a>.
      </p>
      <ol>
        <li>Open <a href="/prompts">/prompts</a>, create a prompt named <code>rag-system</code>, paste the system message as version 1.</li>
        <li>
          Reference the version on the completion call with <code>withPromptVersion</code>:
        </li>
      </ol>
      <CodeBlock language="ts">{`import { withPromptVersion } from '@spanlens/sdk/openai'

const completion = await openai.chat.completions.create(
  { ... },
  {
    headers: {
      ...withUser(userId).headers,
      ...withSession(sessionId).headers,
      ...withPromptVersion('rag-system@1').headers,
    },
  },
)`}</CodeBlock>
      <p>
        Now ship version 2 of the prompt later, change the header to{' '}
        <code>rag-system@2</code> for half your traffic, and the{' '}
        <a href="/prompts">/prompts</a> A/B view will show whether v2 is statistically
        better on cost, latency, and (with an evaluator) quality.
      </p>

      <h2>What you skipped that you might want later</h2>
      <ul>
        <li>
          <strong>Evals.</strong> See <a href="/docs/tutorials/nightly-evals">Nightly evals tutorial</a>{' '}
          to score every chat turn for helpfulness on a 0..1 scale.
        </li>
        <li>
          <strong>PII redaction.</strong> Use <code>x-spanlens-log-body=meta</code> on
          requests where the body would carry user PII.{' '}
          <a href="/docs/features/security">Security</a> has the full policy.
        </li>
        <li>
          <strong>LangChain RAG.</strong> If you migrate to LangChain RetrievalQA or
          LangGraph, the callback handler covers all of this with a single line. See{' '}
          <a href="/docs/integrations/langgraph">LangGraph integration</a>.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Next tutorial: <a href="/docs/tutorials/agent-tracing">multi-step agent tracing</a>.
      </p>
    </div>
  )
}
