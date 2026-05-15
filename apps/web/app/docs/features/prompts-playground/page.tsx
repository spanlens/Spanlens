import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Prompts Playground · Spanlens Docs',
  description:
    'Prompts 탭 안에서 프롬프트 버전을 실시간으로 실행해보는 인터랙티브 콘솔. model·temperature·variables를 조정하고 비용·토큰을 즉시 확인합니다.',
}

export default function PromptsPlaygroundDocs() {
  return (
    <div>
      <h1>Prompts Playground</h1>
      <p className="lead">
        SQL 쿼리 콘솔처럼 — 프롬프트 버전을 선택하고, model·temperature·variables를 조정한 뒤{' '}
        <strong>Run</strong>을 누르면 즉시 실행 결과와 비용·토큰이 돌아옵니다. 프로덕션 배포 전에
        프롬프트가 실제로 어떻게 작동하는지 빠르게 검증할 수 있습니다.
      </p>

      <h2>사용 흐름</h2>
      <ol>
        <li>
          <a href="/prompts">/prompts</a>에서 프롬프트 이름을 클릭합니다.
        </li>
        <li>
          서브탭에서 <strong>Playground</strong>를 선택합니다.
        </li>
        <li>
          드롭다운에서 실행할 <strong>버전</strong>을 선택합니다.
        </li>
        <li>
          <strong>Model</strong>, <strong>Temperature</strong>, <strong>Max Tokens</strong>를 설정합니다.
        </li>
        <li>
          프롬프트 내 <code>{'{{variableName}}'}</code> 플레이스홀더가 감지되면 Variables 입력 폼이
          자동으로 나타납니다. 값을 채웁니다.
        </li>
        <li>
          <strong>Run</strong>을 클릭합니다.
        </li>
        <li>
          응답 텍스트, 사용 토큰 수, 비용, 레이턴시가 결과 패널에 표시됩니다.
        </li>
      </ol>

      <h2>변수 보간</h2>
      <p>
        프롬프트 본문에 <code>{'{{variableName}}'}</code> 형식으로 플레이스홀더를 넣으면, 실행 시
        Playground의 <strong>variables</strong> 객체의 값으로 치환됩니다. 예를 들어:
      </p>
      <CodeBlock language="text">{`당신은 {{language}} 전문가입니다. {{userName}} 님의 질문에 답해주세요.`}</CodeBlock>
      <p>
        Variables에 <code>language: "TypeScript"</code>, <code>userName: "지수"</code>를 입력하면
        실제로 전달되는 내용은 다음과 같습니다:
      </p>
      <CodeBlock language="text">{`당신은 TypeScript 전문가입니다. 지수 님의 질문에 답해주세요.`}</CodeBlock>
      <p>
        템플릿에는 있지만 variables에 값이 없는 플레이스홀더는 <code>missingVars</code> 배열로
        응답에 포함됩니다. 해당 자리는 빈 문자열로 치환되어 실행됩니다.
      </p>

      <h2>지원 Provider</h2>
      <p>Playground는 현재 아래 두 provider를 지원합니다:</p>
      <ul>
        <li><strong>OpenAI</strong> — GPT 계열 모델</li>
        <li><strong>Anthropic</strong> — Claude 계열 모델</li>
      </ul>
      <p>
        실행에는 해당 provider의 <strong>사용자 provider key</strong>가 사용됩니다. Playground
        실행 비용은 Spanlens가 대납하지 않으며, 등록된 provider key의 계정에 직접 청구됩니다.
      </p>

      <h2>실행 파라미터</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>파라미터</th>
              <th>타입</th>
              <th>기본값</th>
              <th>설명</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>promptVersionId</code></td>
              <td>string (UUID)</td>
              <td>—</td>
              <td>실행할 prompt version의 ID (필수)</td>
            </tr>
            <tr>
              <td><code>providerKeyId</code></td>
              <td>string (UUID)</td>
              <td>—</td>
              <td>사용할 provider key ID (필수)</td>
            </tr>
            <tr>
              <td><code>model</code></td>
              <td>string</td>
              <td>—</td>
              <td>실행 모델 (예: <code>gpt-4o-mini</code>, <code>claude-3-5-haiku-20241022</code>)</td>
            </tr>
            <tr>
              <td><code>temperature</code></td>
              <td>number</td>
              <td>0.7</td>
              <td>0 – 2 범위. 낮을수록 결정론적, 높을수록 창의적</td>
            </tr>
            <tr>
              <td><code>maxTokens</code></td>
              <td>integer</td>
              <td>1024</td>
              <td>1 – 8192. 응답 최대 토큰 수</td>
            </tr>
            <tr>
              <td><code>variables</code></td>
              <td>object</td>
              <td>{'{}'}</td>
              <td>프롬프트 내 <code>{'{{key}}'}</code>를 치환할 값 맵</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>응답 구조</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>필드</th>
              <th>타입</th>
              <th>설명</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>responseText</code></td>
              <td>string</td>
              <td>모델이 생성한 응답 텍스트</td>
            </tr>
            <tr>
              <td><code>model</code></td>
              <td>string</td>
              <td>실제로 사용된 모델명 (provider가 반환하는 dated variant 포함)</td>
            </tr>
            <tr>
              <td><code>promptTokens</code></td>
              <td>integer</td>
              <td>입력 토큰 수</td>
            </tr>
            <tr>
              <td><code>completionTokens</code></td>
              <td>integer</td>
              <td>출력 토큰 수</td>
            </tr>
            <tr>
              <td><code>totalTokens</code></td>
              <td>integer</td>
              <td>입력 + 출력 합계</td>
            </tr>
            <tr>
              <td><code>costUsd</code></td>
              <td>number | null</td>
              <td>해당 실행의 예상 비용 (USD). model_prices에 모델이 없으면 null</td>
            </tr>
            <tr>
              <td><code>latencyMs</code></td>
              <td>integer</td>
              <td>첫 요청부터 응답 완료까지 소요 시간 (ms)</td>
            </tr>
            <tr>
              <td><code>missingVars</code></td>
              <td>string[]</td>
              <td>
                템플릿에 있지만 <code>variables</code>에 값이 없는 플레이스홀더 이름 목록.
                비어있으면 모든 변수가 채워진 것
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Rate limit</h2>
      <p>
        Playground 엔드포인트는 <strong>유저당 60초에 20 요청</strong>으로 제한됩니다. 초과 시
        <code>429 Too Many Requests</code>가 반환됩니다. 자동화 파이프라인에는{' '}
        <a href="/docs/features/experiments">Experiments</a>를 사용하세요.
      </p>

      <h2>주의 사항</h2>
      <ul>
        <li>
          <strong>Playground 실행 결과는 <code>requests</code> 테이블에 저장되지 않습니다.</strong>{' '}
          대시보드 Requests 페이지나 Prompts Calls 탭에 기록이 남지 않으므로, 프로덕션 메트릭에
          영향을 주지 않습니다.
        </li>
        <li>
          <strong>비용은 사용자의 provider key에 직접 청구됩니다.</strong> Spanlens 플랜 사용량에는
          포함되지 않습니다.
        </li>
        <li>
          Provider key가 등록되지 않은 경우 실행이 실패합니다.{' '}
          <a href="/settings/keys">Provider Keys</a>에서 먼저 등록하세요.
        </li>
      </ul>

      <h2>API</h2>
      <CodeBlock language="bash">{`POST /api/v1/prompts-playground/run`}</CodeBlock>
      <p>인증: JWT (<code>Authorization: Bearer $SPANLENS_JWT</code>)</p>

      <h3>요청 예시</h3>
      <CodeBlock language="bash">{`curl https://spanlens-server.vercel.app/api/v1/prompts-playground/run \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "promptVersionId": "ae1c3c1e-99eb-4f2a-b821-000000000001",
    "providerKeyId":   "b2d9f3a0-1234-5678-abcd-000000000002",
    "model": "gpt-4o-mini",
    "temperature": 0.5,
    "maxTokens": 512,
    "variables": {
      "language": "TypeScript",
      "userName": "지수"
    }
  }'`}</CodeBlock>

      <h3>응답 예시</h3>
      <CodeBlock language="json">{`{
  "responseText": "TypeScript는 정적 타입을 지원하는 JavaScript의 상위 집합입니다...",
  "model": "gpt-4o-mini-2024-07-18",
  "promptTokens": 48,
  "completionTokens": 132,
  "totalTokens": 180,
  "costUsd": 0.000054,
  "latencyMs": 812,
  "missingVars": []
}`}</CodeBlock>

      <h3>missingVars 있는 경우</h3>
      <CodeBlock language="json">{`{
  "responseText": "안녕하세요,  님. ...",
  "model": "gpt-4o-mini-2024-07-18",
  "promptTokens": 42,
  "completionTokens": 89,
  "totalTokens": 131,
  "costUsd": 0.000039,
  "latencyMs": 654,
  "missingVars": ["userName"]
}`}</CodeBlock>
      <p>
        <code>missingVars</code>가 비어있지 않으면, 해당 변수가 빈 문자열로 치환되어 실행된 것입니다.
        Variables 폼에서 값을 채워 재실행하세요.
      </p>

      <hr />
      <p className="text-sm text-muted-foreground">
        관련: <a href="/docs/features/prompts">Prompts</a> (버전 관리 + A/B 비교),{' '}
        <a href="/docs/features/experiments">Experiments</a> (오프라인 dataset 기반 비교),{' '}
        <a href="/docs/features/evals">Evals</a> (LLM-as-judge 품질 채점),{' '}
        <a href="/prompts">/prompts</a> 대시보드.
      </p>
    </div>
  )
}
