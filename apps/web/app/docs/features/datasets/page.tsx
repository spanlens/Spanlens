import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Datasets · Spanlens Docs',
  description:
    '재사용 가능한 (input, expected_output) 테스트 세트. Evals와 Experiments에서 production 트래픽 대신 사용할 수 있습니다.',
}

export default function DatasetsDocs() {
  return (
    <div>
      <h1>Datasets</h1>
      <p className="lead">
        명명된 (input, expected_output?) 테스트 세트입니다. <a href="/docs/features/evals">Evals</a>와{' '}
        <a href="/docs/features/experiments">Experiments</a>에서 production 트래픽 대신 고정된
        입력 세트로 평가할 때 사용합니다.
      </p>

      <h2>언제 필요한가</h2>
      <ul>
        <li>
          <strong>신규 프롬프트라 production 트래픽이 없을 때</strong> — 첫 호출이 쌓이기 전에 미리
          평가하고 싶음
        </li>
        <li>
          <strong>production 데이터가 민감할 때</strong> — 의료/금융 등 컴플라이언스 이슈가 있어
          익명화된 셋이 필요함
        </li>
        <li>
          <strong>회귀 테스트 셋이 필요할 때</strong> — 과거에 실패한 30개 케이스를 골든셋으로
          묶어두고 신규 버전이 그걸 잘 처리하는지 매번 확인
        </li>
      </ul>

      <h2>구조</h2>

      <h3><code>datasets</code> 테이블</h3>
      <ul>
        <li><code>name</code> — org 내 유일</li>
        <li><code>description</code> — 자유 텍스트</li>
        <li><code>archived_at</code> — soft delete</li>
      </ul>

      <h3><code>dataset_items</code> 테이블</h3>
      <ul>
        <li>
          <code>input</code> (jsonb) — 두 가지 shape 허용:
          <CodeBlock language="json">{`{ "variables": { "company_name": "Acme", "customer_name": "Alice" } }
{ "messages": [{ "role": "user", "content": "..." }] }`}</CodeBlock>
        </li>
        <li>
          <code>expected_output</code> — 정답 텍스트 (선택). Evals dataset source에서 채점 대상이
          됨. 비어있으면 자동 스킵.
        </li>
        <li>
          <code>source_request_id</code> — production request에서 import된 경우의 출처
        </li>
      </ul>

      <h2>아이템 추가 방법 3가지</h2>

      <h3>1. 수동 입력 (대시보드)</h3>
      <p>
        <a href="/datasets">/datasets</a>에서 dataset 선택 → <strong>Add item</strong> → 두 모드 토글:
      </p>
      <ul>
        <li><strong>User message</strong> — chat-style 단일 user 메시지</li>
        <li><strong>Variables JSON</strong> — <code>{`{{var}}`}</code> placeholder가 있는 prompt용</li>
      </ul>

      <h3>2. Production request에서 import (API)</h3>
      <CodeBlock language="bash">{`curl https://spanlens-server.vercel.app/api/v1/datasets/<dataset-id>/items/import-requests \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{ "requestIds": ["uuid-1", "uuid-2", ...] }'`}</CodeBlock>
      <p>
        서버가 각 request에서 <code>request_body.messages</code>를 <code>input</code>으로,{' '}
        <code>response_body</code>의 응답 텍스트를 <code>expected_output</code>으로 추출해 일괄
        저장합니다 (최대 200건/요청).
      </p>

      <h3>3. 단일 아이템 (API)</h3>
      <CodeBlock language="bash">{`curl https://spanlens-server.vercel.app/api/v1/datasets/<dataset-id>/items \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "input": { "variables": { "name": "Alice" } },
    "expectedOutput": "Hello Alice, how can I help?"
  }'`}</CodeBlock>

      <h2>Evals와의 연결 (Replay 모드)</h2>
      <p>
        Evals 실행 시 <strong>Source: Dataset</strong>을 선택하면 production 트래픽 대신 dataset의
        <code>expected_output</code>이 채점 대상이 됩니다. expected_output이 비어있는 item은
        스킵됩니다.
      </p>
      <p>
        이를 &quot;replay 모드&quot;라고 부릅니다 — 이미 생성된 응답을 다시 채점하는 방식입니다.{' '}
        <em>Fresh run 모드</em>(dataset의 input으로 prompt를 직접 실행 후 채점)는{' '}
        <a href="/docs/features/experiments">Experiments</a>에서 지원합니다.
      </p>

      <h2>API</h2>
      <table>
        <thead>
          <tr>
            <th>Method + Path</th>
            <th>설명</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>POST /api/v1/datasets</code></td>
            <td>Dataset 생성</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/datasets</code></td>
            <td>목록 + item_count</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/datasets/:id</code></td>
            <td>Dataset + items 전체</td>
          </tr>
          <tr>
            <td><code>DELETE /api/v1/datasets/:id</code></td>
            <td>Soft archive</td>
          </tr>
          <tr>
            <td><code>POST /api/v1/datasets/:id/items</code></td>
            <td>단일 item 추가</td>
          </tr>
          <tr>
            <td><code>POST /api/v1/datasets/:id/items/import-requests</code></td>
            <td>request 일괄 import (최대 200건)</td>
          </tr>
          <tr>
            <td><code>DELETE /api/v1/datasets/:id/items/:itemId</code></td>
            <td>Item 삭제</td>
          </tr>
        </tbody>
      </table>

      <h2>Limitations (MVP)</h2>
      <ul>
        <li>
          <strong>CSV 업로드 없음.</strong> 대시보드 수동 입력 또는 API의 import-requests만 가능.
          CSV는 Phase 2.5+.
        </li>
        <li>
          <strong>Evals의 Dataset source는 replay 모드만.</strong> Fresh run은 Experiments에서
          처리합니다.
        </li>
        <li>
          <strong>Item 편집 UI 없음.</strong> 잘못 입력한 item은 삭제 후 다시 추가하세요.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        관련: <a href="/docs/features/evals">Evals</a>,{' '}
        <a href="/docs/features/experiments">Experiments</a>,{' '}
        <a href="/datasets">/datasets</a> 대시보드.
      </p>
    </div>
  )
}
