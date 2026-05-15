import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Data Export · Spanlens Docs',
  description:
    'LLM 요청 로그, 트레이스, 이상탐지, 보안 플래그 데이터를 CSV 또는 JSON으로 내려받아 BI 도구나 데이터 파이프라인에 연결하는 방법.',
}

export default function ExportDocs() {
  return (
    <div>
      <h1>Data Export</h1>
      <p className="lead">
        Spanlens에 쌓인 요청 로그·트레이스·이상탐지·보안 플래그 데이터를 CSV 또는 JSON 파일로
        한 번에 내려받을 수 있습니다. Pandas, Excel, Redash, Metabase 같은 BI 도구와 직접
        연결하거나, 데이터 파이프라인에 정기적으로 ingestion하는 용도로 사용합니다.
      </p>

      <h2>엔드포인트 목록</h2>
      <table>
        <thead>
          <tr>
            <th>엔드포인트</th>
            <th>데이터</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>GET /api/v1/exports/requests</code></td>
            <td>요청 로그 — provider, model, tokens, cost, latency 등</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/exports/traces</code></td>
            <td>트레이스 — span 수, 총 비용, duration 등</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/exports/anomalies</code></td>
            <td>이상탐지 스냅샷 — 3σ 초과 버킷의 일별 히스토리</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/exports/security</code></td>
            <td>보안 플래그 — PII 감지, prompt injection 탐지 결과</td>
          </tr>
        </tbody>
      </table>
      <p>
        모든 엔드포인트는 <strong>JWT 인증</strong>(<code>authJwt</code> 미들웨어)이 필요합니다.
        요청 헤더에 <code>Authorization: Bearer &lt;supabase_access_token&gt;</code>을 포함하세요.
      </p>

      <h2>공통 쿼리 파라미터</h2>
      <table>
        <thead>
          <tr>
            <th>파라미터</th>
            <th>기본값</th>
            <th>설명</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>format</code></td>
            <td><code>csv</code></td>
            <td><code>csv</code> 또는 <code>json</code></td>
          </tr>
          <tr>
            <td><code>from</code></td>
            <td>—</td>
            <td>
              ISO 8601 시작 시각 (e.g. <code>2026-05-01T00:00:00Z</code>). 지정하지 않으면
              30일 전부터.
            </td>
          </tr>
          <tr>
            <td><code>to</code></td>
            <td>—</td>
            <td>ISO 8601 종료 시각. 지정하지 않으면 현재 시각까지.</td>
          </tr>
          <tr>
            <td><code>limit</code></td>
            <td><code>10000</code></td>
            <td>1–10,000. 최대 10,000행. 더 많은 데이터가 필요하면 <code>from</code>/<code>to</code>로 기간을 나눠 여러 번 요청하세요.</td>
          </tr>
        </tbody>
      </table>

      <h2>requests 추가 파라미터</h2>
      <p>
        <code>GET /api/v1/exports/requests</code>에서만 사용할 수 있는 추가 필터입니다.
      </p>
      <table>
        <thead>
          <tr>
            <th>파라미터</th>
            <th>설명</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>projectId</code></td>
            <td>특정 프로젝트의 요청만 내보냅니다.</td>
          </tr>
          <tr>
            <td><code>provider</code></td>
            <td><code>openai</code> / <code>anthropic</code> / <code>gemini</code> 중 하나.</td>
          </tr>
          <tr>
            <td><code>model</code></td>
            <td>부분 일치, 대소문자 무시 (e.g. <code>mini</code>).</td>
          </tr>
          <tr>
            <td><code>providerKeyId</code></td>
            <td>특정 provider key를 사용한 요청만.</td>
          </tr>
          <tr>
            <td><code>status</code></td>
            <td><code>ok</code> (2xx) / <code>4xx</code> / <code>5xx</code>.</td>
          </tr>
        </tbody>
      </table>

      <h2>파일명</h2>
      <p>
        응답의 <code>Content-Disposition</code> 헤더에 날짜가 포함된 파일명이 자동으로 지정됩니다.
      </p>
      <table>
        <thead>
          <tr>
            <th>엔드포인트</th>
            <th>파일명 예시</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>/exports/requests</code></td>
            <td><code>spanlens-requests-2026-05-15.csv</code></td>
          </tr>
          <tr>
            <td><code>/exports/traces</code></td>
            <td><code>spanlens-traces-2026-05-15.csv</code></td>
          </tr>
          <tr>
            <td><code>/exports/anomalies</code></td>
            <td><code>spanlens-anomalies-2026-05-15.csv</code></td>
          </tr>
          <tr>
            <td><code>/exports/security</code></td>
            <td><code>spanlens-security-2026-05-15.csv</code></td>
          </tr>
        </tbody>
      </table>

      <h2>CSV 컬럼 — requests</h2>
      <table>
        <thead>
          <tr>
            <th>컬럼</th>
            <th>설명</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>id</code></td>
            <td>요청 고유 ID</td>
          </tr>
          <tr>
            <td><code>project_id</code></td>
            <td>소속 프로젝트 ID</td>
          </tr>
          <tr>
            <td><code>provider</code></td>
            <td>openai / anthropic / gemini</td>
          </tr>
          <tr>
            <td><code>model</code></td>
            <td>provider가 반환한 dated variant (e.g. <code>gpt-4o-mini-2024-07-18</code>)</td>
          </tr>
          <tr>
            <td><code>prompt_tokens</code></td>
            <td>입력 토큰 수 (cache 포함 gross)</td>
          </tr>
          <tr>
            <td><code>completion_tokens</code></td>
            <td>출력 토큰 수</td>
          </tr>
          <tr>
            <td><code>total_tokens</code></td>
            <td>prompt + completion</td>
          </tr>
          <tr>
            <td><code>cost_usd</code></td>
            <td>계산된 비용 (USD). 모델 가격 미등록 시 빈 값.</td>
          </tr>
          <tr>
            <td><code>latency_ms</code></td>
            <td>프록시 수신 ~ 마지막 바이트 전송까지 (ms)</td>
          </tr>
          <tr>
            <td><code>status_code</code></td>
            <td>provider 응답 HTTP 상태 코드</td>
          </tr>
          <tr>
            <td><code>error_message</code></td>
            <td>에러 문자열. 정상 요청은 빈 값.</td>
          </tr>
          <tr>
            <td><code>trace_id</code></td>
            <td>연결된 trace ID. SDK observe() 없이 호출된 경우 빈 값.</td>
          </tr>
          <tr>
            <td><code>created_at</code></td>
            <td>프록시에 요청이 도착한 시각 (ISO 8601 UTC)</td>
          </tr>
        </tbody>
      </table>

      <h2>CSV 컬럼 — traces</h2>
      <table>
        <thead>
          <tr>
            <th>컬럼</th>
            <th>설명</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>id</code></td>
            <td>트레이스 고유 ID</td>
          </tr>
          <tr>
            <td><code>project_id</code></td>
            <td>소속 프로젝트 ID</td>
          </tr>
          <tr>
            <td><code>name</code></td>
            <td>트레이스 이름 (SDK에서 지정)</td>
          </tr>
          <tr>
            <td><code>status</code></td>
            <td><code>ok</code> / <code>error</code></td>
          </tr>
          <tr>
            <td><code>error_message</code></td>
            <td>에러 문자열. 정상 트레이스는 빈 값.</td>
          </tr>
          <tr>
            <td><code>duration_ms</code></td>
            <td>첫 span 시작 ~ 마지막 span 종료 (ms)</td>
          </tr>
          <tr>
            <td><code>total_cost_usd</code></td>
            <td>트레이스 내 모든 요청의 비용 합산 (USD)</td>
          </tr>
          <tr>
            <td><code>total_tokens</code></td>
            <td>트레이스 내 모든 요청의 토큰 합산</td>
          </tr>
          <tr>
            <td><code>span_count</code></td>
            <td>트레이스에 포함된 span 수</td>
          </tr>
          <tr>
            <td><code>started_at</code></td>
            <td>트레이스 시작 시각 (ISO 8601 UTC)</td>
          </tr>
          <tr>
            <td><code>ended_at</code></td>
            <td>트레이스 종료 시각 (ISO 8601 UTC)</td>
          </tr>
          <tr>
            <td><code>created_at</code></td>
            <td>DB 저장 시각 (ISO 8601 UTC)</td>
          </tr>
        </tbody>
      </table>

      <h2>curl 예시</h2>

      <h3>CSV 다운로드</h3>
      <CodeBlock language="bash">{`# 요청 로그 — 특정 기간, GPT-4o만, CSV
curl "https://api.spanlens.io/api/v1/exports/requests?from=2026-05-01T00:00:00Z&to=2026-05-15T23:59:59Z&provider=openai&model=gpt-4o&format=csv" \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \\
  -o spanlens-requests.csv

# 트레이스 — 최근 7일, JSON
curl "https://api.spanlens.io/api/v1/exports/traces?from=2026-05-08T00:00:00Z&format=json" \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \\
  -o spanlens-traces.json

# 이상탐지 히스토리 — 기본 설정 (30일, CSV)
curl "https://api.spanlens.io/api/v1/exports/anomalies" \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \\
  -o spanlens-anomalies.csv

# 보안 플래그 — 5xx 에러 요청 중 보안 이슈
curl "https://api.spanlens.io/api/v1/exports/security?from=2026-05-01T00:00:00Z" \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \\
  -o spanlens-security.csv`}</CodeBlock>

      <h3>JSON 다운로드</h3>
      <CodeBlock language="bash">{`curl "https://api.spanlens.io/api/v1/exports/requests?format=json&limit=1000" \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"

# 응답 형태:
# [
#   {
#     "id": "req_xxx",
#     "project_id": "proj_xxx",
#     "provider": "openai",
#     "model": "gpt-4o-mini-2024-07-18",
#     "prompt_tokens": 512,
#     "completion_tokens": 128,
#     "total_tokens": 640,
#     "cost_usd": 0.000096,
#     "latency_ms": 843,
#     "status_code": 200,
#     "error_message": null,
#     "trace_id": null,
#     "created_at": "2026-05-15T09:00:00.000Z"
#   },
#   ...
# ]`}</CodeBlock>

      <h2>BI 도구 연동 팁</h2>

      <h3>Pandas (Python)</h3>
      <CodeBlock language="python">{`import pandas as pd

# CSV를 직접 URL로 읽기 (requests 라이브러리 필요)
import requests, io

token = "YOUR_SUPABASE_ACCESS_TOKEN"
url = "https://api.spanlens.io/api/v1/exports/requests?from=2026-05-01T00:00:00Z&format=csv"

r = requests.get(url, headers={"Authorization": f"Bearer {token}"})
df = pd.read_csv(io.StringIO(r.text))

# 모델별 평균 비용
print(df.groupby("model")["cost_usd"].mean())`}</CodeBlock>

      <h3>Excel</h3>
      <p>
        curl로 <code>.csv</code> 파일을 내려받은 뒤 Excel에서 <strong>데이터 → 텍스트/CSV에서</strong>로 임포트하세요.
        <code>created_at</code> 컬럼은 ISO 8601 문자열이므로, 피벗 테이블에 쓰려면{' '}
        <code>DATEVALUE</code> + <code>TIMEVALUE</code>로 변환하거나 파워 쿼리의 날짜/시간 형식 변환을
        이용하세요.
      </p>

      <h2>제한 사항</h2>
      <ul>
        <li>
          <strong>최대 10,000행.</strong> 단일 요청에서 가져올 수 있는 row 수의 상한입니다. 더
          많은 데이터가 필요하면 <code>from</code>/<code>to</code>로 기간을 나눠 여러 번
          요청하세요.
        </li>
        <li>
          <strong>request_body / response_body 미포함.</strong> 본문 내용은 보안 및 크기 이유로
          export에서 제외됩니다. 개별 요청 내용은 <a href="/requests">/requests</a> 상세 뷰 또는{' '}
          <code>GET /api/v1/requests/:id</code>로 확인하세요.
        </li>
        <li>
          <strong>실시간 데이터 아님.</strong> export는 요청 시점의 스냅샷입니다. 진행 중인
          스트리밍 요청이나 비동기 로깅 지연이 있을 수 있습니다.
        </li>
        <li>
          <strong>Rate limit.</strong> export 엔드포인트는 분당 10회로 제한됩니다. 대량 배치
          파이프라인은 간격을 두고 호출하세요.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/requests">Requests</a>,{' '}
        <a href="/docs/features/traces">Traces</a>,{' '}
        <a href="/docs/features/anomalies">Anomalies</a>,{' '}
        <a href="/docs/features/security">Security</a>.
      </p>
    </div>
  )
}
