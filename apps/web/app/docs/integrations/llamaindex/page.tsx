import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'LlamaIndex integration · Spanlens Docs',
  description:
    'Trace LlamaIndex query engines and agents with Spanlens. One callback handler maps every CBEventType (LLM, RETRIEVE, EMBEDDING, FUNCTION_CALL, QUERY) to a Spanlens span, so the dashboard tree mirrors your RAG pipeline 1:1.',
  alternates: { canonical: '/docs/integrations/llamaindex' },
}

export default function LlamaIndexIntegration() {
  return (
    <div>
      <h1>LlamaIndex integration</h1>
      <p className="lead">
        LlamaIndex funnels every framework event through a single{' '}
        <code>BaseCallbackHandler</code> contract with a <code>CBEventType</code>{' '}
        discriminator. <code>SpanlensCallbackHandler</code> subclasses that base, maps each
        event to a Spanlens span type, and threads parent / child relationships via the
        per-event UUIDs LlamaIndex hands out, so the trace tree on{' '}
        <a href="/traces">/traces</a> mirrors your RAG topology exactly: <code>QUERY</code>{' '}
        at the root, <code>RETRIEVE</code> / <code>SYNTHESIZE</code> / <code>LLM</code> /{' '}
        <code>FUNCTION_CALL</code> nested underneath.
      </p>

      <h2>Install</h2>
      <CodeBlock language="bash">{`pip install "spanlens[llama-index]"
# pulls in llama-index-core>=0.10.0 alongside the SDK`}</CodeBlock>

      <h2>Minimal setup</h2>
      <CodeBlock language="python">{`import os
from llama_index.core import Settings, VectorStoreIndex, SimpleDirectoryReader
from spanlens import SpanlensClient
from spanlens.integrations.llama_index import SpanlensCallbackHandler

client = SpanlensClient(api_key=os.environ["SPANLENS_API_KEY"])
handler = SpanlensCallbackHandler(client=client)

# Register globally — every query engine / agent created after this
# will route callbacks through the handler.
Settings.callback_manager.add_handler(handler)

documents = SimpleDirectoryReader("./data").load_data()
index = VectorStoreIndex.from_documents(documents)
query_engine = index.as_query_engine()

response = query_engine.query("What is RAG?")`}</CodeBlock>
      <p>
        The handler is safe to share across concurrent queries — LlamaIndex tags every event
        with a unique UUID, so one handler instance per process is fine for parallel work.
      </p>

      <h2>What gets captured</h2>
      <table>
        <thead>
          <tr>
            <th>CBEventType</th>
            <th>Spanlens span</th>
            <th>Default capture?</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>QUERY</code></td>
            <td><code>llama_index.query</code>, span_type <code>custom</code> at the trace root</td>
            <td>yes</td>
          </tr>
          <tr>
            <td><code>LLM</code></td>
            <td><code>llama_index.llm</code>, span_type <code>llm</code> with token counts + model</td>
            <td>yes</td>
          </tr>
          <tr>
            <td><code>RETRIEVE</code> / <code>RERANKING</code></td>
            <td><code>llama_index.retrieve</code>, span_type <code>retrieval</code> with node_count + top scores</td>
            <td>yes</td>
          </tr>
          <tr>
            <td><code>EMBEDDING</code></td>
            <td><code>llama_index.embedding</code>, span_type <code>embedding</code></td>
            <td>yes</td>
          </tr>
          <tr>
            <td><code>FUNCTION_CALL</code></td>
            <td><code>llama_index.function_call</code>, span_type <code>tool</code></td>
            <td>yes</td>
          </tr>
          <tr>
            <td><code>AGENT_STEP</code> / <code>SUB_QUESTION</code> / <code>SYNTHESIZE</code></td>
            <td><code>llama_index.*</code>, span_type <code>custom</code></td>
            <td>yes</td>
          </tr>
          <tr>
            <td><code>CHUNKING</code> / <code>NODE_PARSING</code> / <code>TEMPLATING</code></td>
            <td>not captured (preparation noise)</td>
            <td>no</td>
          </tr>
        </tbody>
      </table>
      <p>Override the ignore set or input / output truncation limits at construction time:</p>
      <CodeBlock language="python">{`handler = SpanlensCallbackHandler(
    client=client,
    trace_name="my_rag_pipeline",     # default "llama_index_run"
    event_starts_to_ignore=[],         # capture everything, including chunking
    event_ends_to_ignore=[],
    max_input_bytes=32_768,            # default 16 KB
    max_output_bytes=32_768,
)`}</CodeBlock>

      <h2>Trace tree shape</h2>
      <p>
        A typical query engine run produces a tree like this — <code>QUERY</code> wraps the
        whole call, <code>RETRIEVE</code> and the <code>LLM</code> call sit as siblings under
        it, and any embedding step lives as a child of the retrieval:
      </p>
      <CodeBlock language="text">{`Trace: my_rag_pipeline  (1.8s)
└── llama_index.query                  (1.8s)
    ├── llama_index.retrieve           (320ms, 12 nodes, top_score=0.92)
    │   └── llama_index.embedding      (80ms, count=1)
    │
    └── llama_index.llm                (1.4s, gpt-4o-mini, 120/45 tokens, $0.0008)`}</CodeBlock>

      <h2>Attaching to a long-lived trace</h2>
      <p>
        By default the handler opens a fresh trace on each top-level query and closes it when
        the run ends. To group multiple queries (every turn of a chat session, every step of
        a long agent loop) under one trace, pass an existing trace at construction — the
        handler will then leave its lifecycle entirely to the caller:
      </p>
      <CodeBlock language="python">{`trace = client.start_trace(
    "chat-session",
    metadata={"user_id": user.id, "session_id": session_id},
)

handler = SpanlensCallbackHandler(client=client, trace=trace)
Settings.callback_manager.add_handler(handler)

for user_message in conversation:
    query_engine.query(user_message)

trace.end(status="completed")   # caller owns lifecycle when trace is passed in`}</CodeBlock>

      <h2>Pairing with the proxy for accurate cost</h2>
      <p>
        The callback handler captures span structure and reads token counts from{' '}
        <code>response.raw.usage</code> on the OpenAI-compatible LLM backends LlamaIndex
        ships with. For models where usage is missing or unreliable on streaming, route the
        underlying LLM through the Spanlens proxy and the linked Request will always carry
        the authoritative cost:
      </p>
      <CodeBlock language="python">{`from llama_index.llms.openai import OpenAI

llm = OpenAI(
    model="gpt-4o-mini",
    api_base="https://server.spanlens.io/proxy/openai/v1",
    api_key=os.environ["SPANLENS_API_KEY"],
)

Settings.llm = llm`}</CodeBlock>
      <p>
        Now every LLM call lands as a Request in ClickHouse with the canonical cost, and the
        matching <code>llama_index.llm</code> span links to it via <code>request_id</code>.
      </p>

      <h2>Linking spans to prompt versions</h2>
      <p>
        To tag an LLM call inside the pipeline with a Spanlens prompt version, set the{' '}
        <code>x-spanlens-prompt-version</code> header on the underlying LLM client. With the
        proxy approach above, attach it as a default header:
      </p>
      <CodeBlock language="python">{`from llama_index.llms.openai import OpenAI

llm = OpenAI(
    model="gpt-4o-mini",
    api_base="https://server.spanlens.io/proxy/openai/v1",
    api_key=os.environ["SPANLENS_API_KEY"],
    default_headers={"x-spanlens-prompt-version": "rag-system@7"},
)`}</CodeBlock>
      <p>
        The Request row now carries <code>prompt_version_id</code>, so the Prompt A/B view
        can compare versions on real query traffic.
      </p>

      <h2>Verifying the integration</h2>
      <ol>
        <li>Run one query through your engine.</li>
        <li>
          Open <a href="/traces">/traces</a>. A new trace appears with the configured{' '}
          <code>trace_name</code> (default <code>llama_index_run</code>).
        </li>
        <li>
          Click into the trace. The waterfall mirrors the pipeline: <code>query</code> at the
          top, <code>retrieve</code> and <code>llm</code> children with their real start /
          end times.
        </li>
        <li>
          On the <code>llm</code> row, the right panel shows prompt / completion token counts
          and computed cost. If <code>request_id</code> is set (proxy mode), the row links
          straight to the matching Request in <a href="/requests">/requests</a>.
        </li>
      </ol>

      <h2>Troubleshooting</h2>

      <h3>No spans show up</h3>
      <p>
        Confirm the handler is registered on <code>Settings.callback_manager</code>{' '}
        <em>before</em> you build the query engine or agent — LlamaIndex captures the
        callback list at construction time. If you build the engine first and add the handler
        later, that engine instance will not see it.
      </p>

      <h3>LLM spans missing token usage</h3>
      <p>
        Some LlamaIndex LLM backends omit usage on streaming responses or wrap it in a shape
        the handler can&apos;t introspect. The fix is to route that LLM through the Spanlens
        proxy (see <em>Pairing with the proxy</em> above); the proxy parses tokens from the
        raw stream and the linked Request always has them.
      </p>

      <h3>Chunking and templating events are too noisy</h3>
      <p>
        They are filtered out by default. If you turned them back on with{' '}
        <code>event_starts_to_ignore=[]</code> and want to silence them again, pass the
        defaults explicitly:
      </p>
      <CodeBlock language="python">{`handler = SpanlensCallbackHandler(
    client=client,
    event_starts_to_ignore=["chunking", "node_parsing", "templating"],
    event_ends_to_ignore=["chunking", "node_parsing", "templating"],
)`}</CodeBlock>

      <h3>Trace closes too early on background work</h3>
      <p>
        If your pipeline kicks off fire-and-forget work after the root query returns, the
        auto-managed trace will close before that work logs. Pass an external trace via the{' '}
        <code>trace=</code> argument and call <code>trace.end()</code> yourself when all work
        is done.
      </p>

      <hr />
      <p className="text-sm text-muted-foreground">
        Next: <a href="/docs/tutorials/rag-chatbot">RAG chatbot tutorial</a> for a runnable
        example, or <a href="/docs/concepts/data-model">data model</a> for what ends up in
        the database.
      </p>
    </div>
  )
}
