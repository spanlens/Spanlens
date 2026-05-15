import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Prompts · Spanlens Docs',
  description:
    'Version-controlled prompt templates with real-data A/B comparison — latency, cost, and error rate per version.',
}

export default function PromptsDocs() {
  return (
    <div>
      <h1>Prompts</h1>
      <p className="lead">
        Store your prompt templates as named, versioned assets. Every time you tweak a prompt, Spanlens
        creates a new immutable version. Then compare versions side-by-side with real production
        metrics — average latency, error rate, and cost per call.
      </p>

      <h2>Why it matters</h2>
      <p>
        Prompts get edited constantly: a line added here, an example rewritten there, a tone shift
        on Friday afternoon. The unanswered question is always the same — <em>is this actually
        better, or does it just feel better?</em>
      </p>
      <p>
        Plain <code>.replace()</code> edits in your codebase give you no answers. Previous versions
        are lost, you can&apos;t roll back, and you never learn which version actually costs less or
        fails less. Spanlens Prompts fixes that without forcing you to adopt a new runtime or
        template engine.
      </p>

      <h2>How it works</h2>

      <h3>Versioning</h3>
      <p>
        Save a prompt under a name (e.g. <code>chatbot-system</code>) in the dashboard. Edit it
        later → a new version is auto-created with the next number. Old versions stay forever
        (immutable). No manual version bumps, no schema migrations.
      </p>
      <CodeBlock language="text">{`chatbot-system
  ├─ v1  (2 weeks ago)  "You are a helpful assistant..."
  ├─ v2  (1 week ago)   "You are a helpful Korean-speaking assistant..."
  └─ v3  (yesterday)    "You are a Korean assistant. Be concise..."`}</CodeBlock>

      <p>Each version stores:</p>
      <ul>
        <li><code>content</code> — the template body (up to 100K chars)</li>
        <li><code>variables</code> — typed placeholders like <code>{'{{userName}}'}</code> with description and <code>required</code> flag</li>
        <li><code>metadata</code> — free-form JSON for tags (team, task type, model target, etc.)</li>
        <li><code>project_id</code> — optional project scope</li>
      </ul>

      <h3>A/B comparison on real traffic</h3>
      <p>
        Click a prompt in <a href="/prompts">/prompts</a> and you&apos;ll see a comparison table of
        every version that has received production traffic in the last 30 days:
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Version</th>
              <th className="text-right">Samples</th>
              <th className="text-right">Avg latency</th>
              <th className="text-right">Error %</th>
              <th className="text-right">Avg cost</th>
              <th className="text-right">Total cost</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>v3</td>
              <td className="text-right">1,245</td>
              <td className="text-right">820ms</td>
              <td className="text-right">0.4%</td>
              <td className="text-right">$0.0012</td>
              <td className="text-right">$1.49</td>
            </tr>
            <tr>
              <td>v2</td>
              <td className="text-right">3,102</td>
              <td className="text-right">1.2s</td>
              <td className="text-right">1.1%</td>
              <td className="text-right">$0.0018</td>
              <td className="text-right">$5.58</td>
            </tr>
            <tr>
              <td>v1</td>
              <td className="text-right">890</td>
              <td className="text-right">1.4s</td>
              <td className="text-right">2.3%</td>
              <td className="text-right">$0.0023</td>
              <td className="text-right">$2.04</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        In this example v3 is 32% faster, has 1/5 the error rate, and costs 33% less per call than
        v2. That&apos;s a clear keep-v3, retire-v2 decision with actual numbers behind it.
      </p>

      <h2>Using it</h2>

      <h3>Creating a prompt version via dashboard</h3>
      <ol>
        <li>Go to <a href="/prompts">/prompts</a> and click <strong>New prompt / version</strong>.</li>
        <li>Enter a name (e.g. <code>chatbot-system</code>). Reusing a name → new version.</li>
        <li>Paste the content. Save.</li>
      </ol>

      <h3>Creating via API</h3>
      <CodeBlock language="bash">{`curl https://spanlens-server.vercel.app/api/v1/prompts \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "chatbot-system",
    "content": "You are a Korean assistant. Be concise.",
    "metadata": { "team": "growth", "tested": true }
  }'`}</CodeBlock>
      <p>
        Response includes the auto-assigned <code>version</code>. See the full endpoint list below.
      </p>

      <h3>Fetching the comparison data</h3>
      <CodeBlock language="bash">{`GET /api/v1/prompts/:name/compare?sinceHours=720

# returns per-version metrics:
#   { version, sampleCount, avgLatencyMs, errorRate, avgCostUsd, totalCostUsd }`}</CodeBlock>

      <h3>API reference</h3>
      <table>
        <thead>
          <tr>
            <th>Method + Path</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>GET /api/v1/prompts</code></td>
            <td>List all prompts (latest version per name)</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/prompts/:name</code></td>
            <td>Full version history for a prompt name</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/prompts/:name/compare</code></td>
            <td>Per-version metrics for A/B comparison</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/prompts/:name/:version</code></td>
            <td>Fetch one specific version</td>
          </tr>
          <tr>
            <td><code>POST /api/v1/prompts</code></td>
            <td>Create a new version (auto-increments version number)</td>
          </tr>
          <tr>
            <td><code>POST /api/v1/prompts/:name/:version/rollback</code></td>
            <td>
              Copy an older version&apos;s content as a new (latest) version. The old version is
              not modified — the version counter always increases. Returns the newly created version.
            </td>
          </tr>
          <tr>
            <td><code>DELETE /api/v1/prompts/:name/:version</code></td>
            <td>Delete one version</td>
          </tr>
        </tbody>
      </table>

      <h2>Tagging requests with a prompt version</h2>
      <p>
        For the A/B table to fill up, each LLM request needs to declare which version it
        used. The SDK ships two ways to do that — pick whichever fits your call site.
      </p>

      <h3>Option 1 — <code>withPromptVersion()</code> per call</h3>
      <CodeBlock language="ts">{`import { createOpenAI, withPromptVersion } from '@spanlens/sdk/openai'

const openai = createOpenAI()

const res = await openai.chat.completions.create(
  {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: promptV3Content },
      { role: 'user', content: userMessage },
    ],
  },
  withPromptVersion('chatbot-system@3'),
)`}</CodeBlock>
      <p>Same helper exists on <code>@spanlens/sdk/anthropic</code> for Claude calls.</p>

      <h3>Option 2 — <code>observeOpenAI()</code> with promptVersion option</h3>
      <p>If you&apos;re already using agent tracing, just add one option:</p>
      <CodeBlock language="ts">{`import { observeOpenAI } from '@spanlens/sdk'

const res = await observeOpenAI(
  trace,
  { name: 'answer', promptVersion: 'chatbot-system@3' },
  (headers) => openai.chat.completions.create({ /* ... */ }, { headers }),
)`}</CodeBlock>

      <h3>Accepted id formats</h3>
      <table>
        <thead>
          <tr><th>Format</th><th>Example</th><th>Notes</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><code>name@version</code></td>
            <td><code>chatbot-system@3</code></td>
            <td>Most common; explicit version pin</td>
          </tr>
          <tr>
            <td><code>name@latest</code></td>
            <td><code>chatbot-system@latest</code></td>
            <td>Auto-resolves to the highest version server-side on every call</td>
          </tr>
          <tr>
            <td>Raw UUID</td>
            <td><code>ae1c3c1e-99eb-...</code></td>
            <td>Use the <code>id</code> returned from POST <code>/api/v1/prompts</code></td>
          </tr>
        </tbody>
      </table>
      <p>
        Server-side the header value is looked up in <code>prompt_versions</code> scoped to your
        organization. Invalid / unknown values silently resolve to null (the request still succeeds,
        it just isn&apos;t linked to a version).
      </p>

      <h2>Prompts 페이지의 서브탭들</h2>
      <p>
        대시보드에서 prompt 하나를 클릭하면 6개 서브탭이 보입니다:
      </p>
      <ul>
        <li>
          <strong>Versions</strong> — 모든 버전 목록 + 펼치기로 본문 확인.{' '}
          각 버전에 <strong>Roll back</strong> 버튼이 있어 해당 content를 그대로 새 버전으로
          복사합니다 (기존 버전은 삭제되지 않음 — 버전 번호는 항상 증가).
        </li>
        <li><strong>Diff</strong> — 두 버전 선택 → LCS 기반 line-level diff (+/− 색상)</li>
        <li>
          <strong>Traffic</strong> — 버전별 트래픽 share + 품질 색상 (≥90 green / 70–89 yellow / &lt;70 red)
        </li>
        <li>
          <strong>Calls</strong> — 버전별 호출수·레이턴시·에러율·<strong>QUALITY</strong>·비용·토큰 집계.
          row 클릭 시 <code>/requests?promptVersionId=...</code>로 드릴다운.{' '}
          <strong>Quality 컬럼</strong>은 <a href="/docs/features/evals">Evals</a>가 매긴
          <code>eval_results</code> 평균을 표시.
        </li>
        <li>
          <strong>A/B</strong> — 프로덕션 트래픽 A/B 라우팅. <a href="/docs/features/experiments">Experiments</a>의
          오프라인 비교와는 다릅니다 (아래 표 참고).
        </li>
        <li>
          <strong>Playground</strong> — 버전을 선택해 provider key·model·temperature·variables 설정 후 즉시
          실행. SQL 쿼리 콘솔과 비슷한 도구로, 결과는 <code>requests</code> 테이블에 저장되지 않음.
          Rate limit 20 req/min/user.
        </li>
      </ul>

      <h2>A/B 라우팅 vs Experiments</h2>
      <p>
        같은 &quot;실험&quot; 단어가 두 곳에 등장하므로 헷갈리지 않게 정리:
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>A/B (이 탭)</th>
              <th><a href="/docs/features/experiments">Experiments</a></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>데이터</td>
              <td>프로덕션 트래픽</td>
              <td>오프라인 dataset</td>
            </tr>
            <tr>
              <td>시점</td>
              <td>실시간, 실제 사용자 노출</td>
              <td>즉시 실행, 사용자 노출 없음</td>
            </tr>
            <tr>
              <td>측정</td>
              <td>통계 유의성 (Welch&apos;s t-test)</td>
              <td>출력 텍스트 직접 비교 + 점수</td>
            </tr>
            <tr>
              <td>위험</td>
              <td>나쁜 버전이 사용자에게 감</td>
              <td>없음</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        보완 관계: <strong>Experiments로 사전 검증 → A/B로 프로덕션 검증</strong>.
      </p>

      <h2>Limitations</h2>
      <p>Honest view of what the feature does <em>not</em> do yet:</p>
      <ul>
        <li>
          <strong>No editor affordances.</strong> The create/edit form is a plain textarea —
          no diff view, no syntax highlighting, no variable autocomplete. Good enough for now;
          polish deferred to post-launch.
        </li>
        <li>
          <strong>Comparison window is fixed at 30 days in the UI.</strong> The API accepts a{' '}
          <code>sinceHours</code> query parameter; we just haven&apos;t wired a UI picker yet.
        </li>
        <li>
          <strong>No statistical-significance hints.</strong> If v1 has 5 samples and v2 has 5,000,
          both show up the same way in the table. Significance flags are on the roadmap.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        관련: <a href="/docs/features/evals">Evals</a> (응답 품질 점수),{' '}
        <a href="/docs/features/experiments">Experiments</a> (오프라인 비교),{' '}
        <a href="/docs/features/savings">Savings</a> (model substitution),{' '}
        <a href="/docs/features/traces">Traces</a>, <a href="/prompts">/prompts</a> 대시보드.
      </p>
    </div>
  )
}
