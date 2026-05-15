import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Audit Logs · Spanlens Docs',
  description:
    'API 키 생성, Provider 키 추가, 멤버 초대/역할 변경 등 조직 내 모든 변경 이력을 시간 순으로 기록하는 Audit Logs 가이드.',
}

export default function AuditLogsDocs() {
  return (
    <div>
      <h1>Audit Logs</h1>
      <p className="lead">
        Spanlens는 조직 내 중요한 작업을 모두 기록합니다. API 키 생성, Provider 키 추가,
        멤버 초대 및 역할 변경, 플랜 전환 등 &ldquo;누가, 언제, 무엇을 바꿨는가&rdquo;를
        추적할 수 있습니다. Settings → <strong>Audit log</strong>에서 바로 확인하거나
        REST API로 조회해 외부 SIEM / 컴플라이언스 도구와 연동하세요.
      </p>

      <h2>사용 목적</h2>
      <ul>
        <li>
          <strong>보안 감사.</strong> 퇴직자가 마지막으로 어떤 키를 만들었는지,
          예상치 못한 시간대에 관리자 역할이 바뀐 적이 있는지 확인합니다.
        </li>
        <li>
          <strong>컴플라이언스.</strong> SOC 2, ISO 27001 등 감사에서 &ldquo;변경 이력
          접근 로그를 보여달라&rdquo;는 요구에 즉시 응답할 수 있습니다.
        </li>
        <li>
          <strong>장애 원인 추적.</strong> 프록시가 갑자기 인증 오류를 내기 시작했다면
          Audit log에서 해당 시점 전후의 Provider 키 교체 이력을 찾아보세요.
        </li>
      </ul>

      <h2>기록되는 이벤트</h2>
      <table>
        <thead>
          <tr>
            <th>action</th>
            <th>설명</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>api_key.create</code></td>
            <td>Spanlens API 키(<code>sl_live_*</code>) 신규 발급</td>
          </tr>
          <tr>
            <td><code>api_key.delete</code></td>
            <td>API 키 폐기</td>
          </tr>
          <tr>
            <td><code>provider_key.add</code></td>
            <td>OpenAI / Anthropic / Gemini 등 Provider 키 등록</td>
          </tr>
          <tr>
            <td><code>provider_key.delete</code></td>
            <td>Provider 키 삭제</td>
          </tr>
          <tr>
            <td><code>member.invite</code></td>
            <td>팀원 초대 발송</td>
          </tr>
          <tr>
            <td><code>member.role_change</code></td>
            <td>멤버 역할 변경 (admin / editor / viewer)</td>
          </tr>
          <tr>
            <td><code>member.remove</code></td>
            <td>멤버 조직에서 제거</td>
          </tr>
          <tr>
            <td><code>billing.plan.change</code></td>
            <td>플랜 업그레이드 또는 다운그레이드</td>
          </tr>
          <tr>
            <td><code>org.settings.update</code></td>
            <td>조직 이름, 보안 설정 등 조직 수준 설정 변경</td>
          </tr>
        </tbody>
      </table>

      <h2>API 레퍼런스</h2>

      <h3>목록 조회</h3>
      <CodeBlock language="bash">{`GET /api/v1/audit-logs?limit=50&offset=0

# action으로 필터링
GET /api/v1/audit-logs?limit=50&offset=0&action=api_key.create

# 특정 사용자만 보기
GET /api/v1/audit-logs?limit=50&offset=0&user_id=<uuid>`}</CodeBlock>

      <h3>쿼리 파라미터</h3>
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
            <td><code>limit</code></td>
            <td>50</td>
            <td>페이지당 결과 수. 최대 200</td>
          </tr>
          <tr>
            <td><code>offset</code></td>
            <td>0</td>
            <td>페이지네이션 오프셋</td>
          </tr>
          <tr>
            <td><code>action</code></td>
            <td>(전체)</td>
            <td>특정 action 값으로 필터링. 예: <code>member.invite</code></td>
          </tr>
          <tr>
            <td><code>user_id</code></td>
            <td>(전체)</td>
            <td>특정 사용자가 수행한 작업만 조회</td>
          </tr>
        </tbody>
      </table>

      <h3>응답 예시</h3>
      <CodeBlock language="json">{`{
  "data": [
    {
      "id": "al_01j9abc...",
      "action": "api_key.create",
      "resource_type": "api_key",
      "resource_id": "key_01j9...",
      "user_id": "usr_01j9...",
      "metadata": {
        "key_name": "Production proxy key"
      },
      "ip_address": "203.0.113.42",
      "created_at": "2026-05-15T08:30:00Z"
    },
    {
      "id": "al_01j9def...",
      "action": "member.role_change",
      "resource_type": "org_member",
      "resource_id": "usr_01j9yyy...",
      "user_id": "usr_01j9xxx...",
      "metadata": {
        "from_role": "viewer",
        "to_role": "editor",
        "target_email": "colleague@example.com"
      },
      "ip_address": "198.51.100.7",
      "created_at": "2026-05-15T07:12:45Z"
    }
  ],
  "total": 142,
  "limit": 50,
  "offset": 0
}`}</CodeBlock>

      <h3>응답 필드 설명</h3>
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
            <td><code>id</code></td>
            <td>string</td>
            <td>로그 고유 ID</td>
          </tr>
          <tr>
            <td><code>action</code></td>
            <td>string</td>
            <td>수행된 작업 종류 (위 이벤트 표 참고)</td>
          </tr>
          <tr>
            <td><code>resource_type</code></td>
            <td>string</td>
            <td>변경된 리소스 유형 (예: <code>api_key</code>, <code>org_member</code>)</td>
          </tr>
          <tr>
            <td><code>resource_id</code></td>
            <td>string</td>
            <td>변경된 리소스의 ID</td>
          </tr>
          <tr>
            <td><code>user_id</code></td>
            <td>string</td>
            <td>작업을 수행한 사용자의 ID</td>
          </tr>
          <tr>
            <td><code>metadata</code></td>
            <td>object</td>
            <td>이벤트별 부가 정보 (이전 값, 이후 값, 대상 이메일 등)</td>
          </tr>
          <tr>
            <td><code>ip_address</code></td>
            <td>string</td>
            <td>요청이 들어온 IP 주소</td>
          </tr>
          <tr>
            <td><code>created_at</code></td>
            <td>string (ISO 8601)</td>
            <td>이벤트 발생 시각 (UTC)</td>
          </tr>
        </tbody>
      </table>

      <h2>curl 예시</h2>
      <CodeBlock language="bash">{`# 최근 20건 조회
curl "https://api.spanlens.io/api/v1/audit-logs?limit=20" \\
  -H "Authorization: Bearer <JWT>"

# Provider 키 관련 이벤트만 필터링
curl "https://api.spanlens.io/api/v1/audit-logs?action=provider_key.add&limit=50" \\
  -H "Authorization: Bearer <JWT>"

# 두 번째 페이지 (51~100번째)
curl "https://api.spanlens.io/api/v1/audit-logs?limit=50&offset=50" \\
  -H "Authorization: Bearer <JWT>"`}</CodeBlock>

      <h2>제한 사항</h2>
      <ul>
        <li>
          <strong>admin만 접근 가능.</strong> Audit log는 조직의 admin 역할을 가진 멤버만 조회할 수
          있습니다. editor / viewer는 API 및 대시보드 모두 접근이 차단됩니다.
        </li>
        <li>
          <strong>페이지당 최대 200행.</strong> <code>limit</code>에 200을 초과하는 값을 전달하면
          400 오류가 반환됩니다.
        </li>
        <li>
          <strong>최신순 정렬 고정.</strong> 현재 <code>created_at DESC</code>로만 정렬되며,
          정렬 기준 변경 파라미터는 지원하지 않습니다.
        </li>
        <li>
          <strong>보존 기간.</strong> Free 플랜은 최근 30일, Pro 이상은 1년간 보관됩니다.
          더 긴 보존이 필요하다면 정기적으로 API로 내보내 외부 스토리지에 적재하세요.
        </li>
        <li>
          <strong>프록시 요청 자체는 기록되지 않음.</strong> LLM 요청/응답 이력은{' '}
          <a href="/docs/features/requests">Requests</a> 및{' '}
          <a href="/docs/features/traces">Traces</a> 페이지에서 확인하세요.
          Audit log는 <em>조직 설정 변경</em>에 집중합니다.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        관련 문서:{' '}
        <a href="/docs/features/members-invitations">Members &amp; Invitations</a> (멤버 관리),{' '}
        <a href="/docs/features/security">Security</a> (PII / 프롬프트 인젝션 스캔),{' '}
        <a href="/docs/features/webhooks">Webhooks</a> (이벤트 HTTP 전달).
        대시보드: Settings → <strong>Audit log</strong>.
      </p>
    </div>
  )
}
