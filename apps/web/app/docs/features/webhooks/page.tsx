import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Webhooks · Spanlens Docs',
  description:
    'Spanlens에서 발생하는 이벤트(요청 생성, 트레이스 완료, 알림 발동)를 HTTP POST로 외부 서버에 실시간으로 전달하는 Webhooks API 가이드.',
}

export default function WebhooksDocs() {
  return (
    <div>
      <h1>Webhooks</h1>
      <p className="lead">
        Spanlens에서 발생하는 이벤트를 외부 서버에 HTTP POST로 실시간 전달합니다.
        요청 생성, 트레이스 완료, 알림 발동 세 가지 이벤트를 지원하며,
        HMAC-SHA256 서명으로 위변조를 검증할 수 있습니다.
        대시보드 알림 외에 자체 슬랙봇, 데이터 파이프라인, CI/CD 트리거 등
        커스텀 자동화가 필요할 때 사용하세요.
      </p>

      <h2>지원 이벤트</h2>
      <table>
        <thead>
          <tr>
            <th>이벤트</th>
            <th>언제 발생하는가</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>request.created</code></td>
            <td>프록시가 LLM 응답을 받아 <code>requests</code> 테이블에 행을 삽입한 직후</td>
          </tr>
          <tr>
            <td><code>trace.completed</code></td>
            <td>에이전트 트레이스의 마지막 span이 완료되어 트레이스가 닫힌 시점</td>
          </tr>
          <tr>
            <td><code>alert.triggered</code></td>
            <td>Alert 규칙이 임계값을 초과해 알림을 발송한 시점</td>
          </tr>
        </tbody>
      </table>

      <h2>엔드포인트 목록</h2>
      <CodeBlock language="http">{`GET    /api/v1/webhooks              # 조직 내 모든 webhook 목록
POST   /api/v1/webhooks              # 신규 webhook 등록
PATCH  /api/v1/webhooks/:id          # 이름·URL·이벤트·활성화 여부 수정
DELETE /api/v1/webhooks/:id          # webhook 삭제
POST   /api/v1/webhooks/:id/test     # 테스트 페이로드 즉시 전송
GET    /api/v1/webhooks/:id/deliveries  # 최근 전송 기록 조회 (최대 10건)`}</CodeBlock>

      <p>
        모든 엔드포인트는 <code>Authorization: Bearer &lt;supabase-jwt&gt;</code> 헤더가 필요합니다.
        생성·수정·삭제는 <strong>admin 또는 editor</strong> 역할 이상만 가능합니다.
        viewer 역할은 목록 조회와 전송 기록 확인만 허용됩니다.
      </p>

      <h2>Webhook 등록하기</h2>

      <h3>요청 스키마</h3>
      <table>
        <thead>
          <tr>
            <th>필드</th>
            <th>타입</th>
            <th>필수</th>
            <th>설명</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>name</code></td>
            <td>string</td>
            <td>필수</td>
            <td>식별용 이름 (예: "Slack 이벤트 파이프")</td>
          </tr>
          <tr>
            <td><code>url</code></td>
            <td>string</td>
            <td>필수</td>
            <td><code>https://</code>로 시작해야 함. HTTP는 허용되지 않음</td>
          </tr>
          <tr>
            <td><code>events</code></td>
            <td>string[]</td>
            <td>필수</td>
            <td>구독할 이벤트 목록. 빈 배열이면 이벤트가 전달되지 않음</td>
          </tr>
          <tr>
            <td><code>is_active</code></td>
            <td>boolean</td>
            <td>선택</td>
            <td>기본값 <code>true</code>. <code>false</code>로 설정하면 전송 일시 중단</td>
          </tr>
        </tbody>
      </table>

      <CodeBlock language="bash">{`curl -X POST https://api.spanlens.io/api/v1/webhooks \\
  -H "Authorization: Bearer <JWT>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "내 데이터 파이프라인",
    "url": "https://my-server.example.com/hooks/spanlens",
    "events": ["request.created", "alert.triggered"],
    "is_active": true
  }'`}</CodeBlock>

      <h3>응답 예시</h3>
      <CodeBlock language="json">{`{
  "id": "wh_01j9abc...",
  "name": "내 데이터 파이프라인",
  "url": "https://my-server.example.com/hooks/spanlens",
  "secret": "a3f8c2d1e5b04f7a9c6e2d8b1a4f03c7",
  "events": ["request.created", "alert.triggered"],
  "is_active": true,
  "created_at": "2026-05-15T09:00:00Z"
}`}</CodeBlock>
      <p>
        <code>secret</code>은 32자리 hex 문자열로, 등록 시에만 반환됩니다.
        분실하면 재발급할 수 없으므로 안전한 곳에 보관하세요.
        이후 GET 응답에서는 마스킹된 값만 노출됩니다.
      </p>

      <h2>페이로드 구조</h2>
      <p>
        이벤트 발생 시 Spanlens는 등록된 URL로 다음과 같은 JSON 페이로드를 HTTP POST로 전송합니다.
      </p>
      <CodeBlock language="json">{`{
  "event": "request.created",
  "created_at": "2026-05-15T09:01:23Z",
  "data": {
    "id": "req_01j9xyz...",
    "project_id": "proj_01j9...",
    "model": "gpt-4o-mini-2024-07-18",
    "provider": "openai",
    "input_tokens": 512,
    "output_tokens": 128,
    "cost_usd": 0.000096,
    "duration_ms": 843
  }
}`}</CodeBlock>
      <p>
        <code>data</code> 필드의 구조는 이벤트 종류마다 다릅니다.
        <code>request.created</code>는 requests 행의 요약,
        <code>trace.completed</code>는 trace 메타데이터,
        <code>alert.triggered</code>는 발동된 규칙과 현재 값을 포함합니다.
      </p>

      <h2>서명 검증</h2>
      <p>
        Spanlens는 모든 요청에 <code>X-Spanlens-Signature</code> 헤더를 포함합니다.
        이 값은 webhook 등록 시 발급된 <code>secret</code>으로 페이로드 본문을
        HMAC-SHA256 해싱한 결과입니다. 외부에서 위조한 요청을 차단하려면
        반드시 서명을 검증하세요.
      </p>

      <h3>Node.js 검증 예시</h3>
      <CodeBlock language="typescript">{`import crypto from 'node:crypto'

export function verifySpanlensSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex')

  // 타이밍 공격 방지를 위해 timingSafeEqual 사용
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(signatureHeader, 'hex')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

// Express 예시
app.post('/hooks/spanlens', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-spanlens-signature'] as string
  if (!verifySpanlensSignature(req.body.toString(), sig, process.env.WEBHOOK_SECRET!)) {
    return res.status(401).json({ error: 'Invalid signature' })
  }
  const event = JSON.parse(req.body.toString())
  // 이벤트 처리 로직
  res.json({ ok: true })
})`}</CodeBlock>
      <p>
        서명 검증 시 주의: <code>req.body</code>는 반드시 <strong>raw bytes</strong>로 읽어야 합니다.
        JSON 파싱 후 다시 직렬화하면 공백이나 키 순서가 바뀌어 서명이 불일치할 수 있습니다.
        <code>express.raw()</code> 또는 동등한 미들웨어를 사용하세요.
      </p>

      <h2>전송 기록 (Deliveries)</h2>
      <p>
        <code>GET /api/v1/webhooks/:id/deliveries</code>는 최근 10건의 전송 기록을 반환합니다.
        각 기록에는 HTTP 상태 코드, 응답 본문(첫 500자), 전송 시각이 포함됩니다.
        4xx / 5xx 응답이 반복된다면 수신 서버 로그를 함께 확인하세요.
      </p>
      <CodeBlock language="bash">{`curl https://api.spanlens.io/api/v1/webhooks/wh_01j9abc.../deliveries \\
  -H "Authorization: Bearer <JWT>"`}</CodeBlock>
      <CodeBlock language="json">{`[
  {
    "id": "del_01j9...",
    "event": "request.created",
    "status_code": 200,
    "response_body": "{\"ok\":true}",
    "delivered_at": "2026-05-15T09:01:24Z"
  }
]`}</CodeBlock>

      <h2>테스트 전송</h2>
      <p>
        <code>POST /api/v1/webhooks/:id/test</code>를 호출하면 더미 페이로드를 즉시 전송해
        엔드포인트 연결과 서명 검증 로직을 손쉽게 확인할 수 있습니다.
      </p>
      <CodeBlock language="bash">{`curl -X POST https://api.spanlens.io/api/v1/webhooks/wh_01j9abc.../test \\
  -H "Authorization: Bearer <JWT>"`}</CodeBlock>

      <h2>권한 요약</h2>
      <table>
        <thead>
          <tr>
            <th>작업</th>
            <th>admin</th>
            <th>editor</th>
            <th>viewer</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>목록 조회 / 전송 기록 확인</td>
            <td>✓</td>
            <td>✓</td>
            <td>✓</td>
          </tr>
          <tr>
            <td>등록 / 수정 / 삭제</td>
            <td>✓</td>
            <td>✓</td>
            <td>—</td>
          </tr>
          <tr>
            <td>테스트 전송</td>
            <td>✓</td>
            <td>✓</td>
            <td>—</td>
          </tr>
        </tbody>
      </table>

      <h2>제한 사항</h2>
      <ul>
        <li>
          <strong>조직당 최대 20개</strong>의 webhook을 등록할 수 있습니다.
        </li>
        <li>
          <strong>재시도 없음.</strong> 수신 서버가 200~299 외의 상태 코드를 반환하거나
          타임아웃(10초)이 발생하면 해당 전송은 실패로 기록되고 재전송되지 않습니다.
          멱등성 처리는 수신 측에서 구현하세요.
        </li>
        <li>
          <strong>전송 기록은 최근 10건</strong>만 보관됩니다.
          전체 감사 이력이 필요하다면 수신 서버에서 별도로 영구 저장하세요.
        </li>
        <li>
          <strong>HTTPS 필수.</strong> HTTP URL은 등록 시 거부됩니다.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        관련 문서:{' '}
        <a href="/docs/features/alerts">Alerts</a> (임계값 기반 알림),{' '}
        <a href="/docs/features/audit-logs">Audit logs</a> (변경 이력 감사),{' '}
        <a href="/docs/features/security">Security</a> (PII / 프롬프트 인젝션 스캔).
      </p>
    </div>
  )
}
