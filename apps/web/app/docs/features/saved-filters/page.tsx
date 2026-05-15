import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Saved Filters · Spanlens Docs',
  description:
    '자주 쓰는 필터 조합을 이름 붙여 저장하고 /requests 페이지에서 한 번에 불러오는 기능.',
}

export default function SavedFiltersDocs() {
  return (
    <div>
      <h1>Saved Filters</h1>
      <p className="lead">
        <a href="/requests">/requests</a> 페이지에서 설정한 필터 조합(provider, model, status,
        날짜 범위 등)을 이름 붙여 저장해 두고, 이후 방문 시 드롭다운 하나로 바로 불러올 수
        있습니다. 반복적인 디버깅 쿼리나 팀 내 공유 뷰를 빠르게 재현할 때 유용합니다.
      </p>

      <h2>사용 흐름</h2>
      <ol>
        <li>
          <a href="/requests">/requests</a> 페이지에서 원하는 필터를 설정합니다 — provider,
          model, status, date range 등.
        </li>
        <li>
          필터 바 오른쪽의 <strong>Save as filter</strong> 버튼을 누릅니다.
        </li>
        <li>이름을 입력(1–80자)하고 <strong>저장</strong>을 누릅니다.</li>
        <li>
          이후 방문 시 필터 바의 <strong>Saved filters</strong> 드롭다운에서 저장한 이름을
          선택하면 모든 필터가 한 번에 복원됩니다.
        </li>
      </ol>

      <h2>저장 범위 및 격리</h2>
      <p>
        Saved filters는 <strong>사용자 단위</strong>로 격리됩니다. 같은 조직 내 다른 멤버의
        필터는 보이지 않으며, 본인이 만든 필터만 드롭다운에 표시됩니다. Row Level Security(RLS)로
        DB 레벨에서 강제됩니다.
      </p>

      <h2>API</h2>
      <p>
        모든 엔드포인트는 <strong>JWT 인증</strong>(<code>authJwt</code> 미들웨어)이 필요합니다.
        요청 헤더에 <code>Authorization: Bearer &lt;supabase_access_token&gt;</code>을 포함하세요.
      </p>

      <h3>목록 조회</h3>
      <CodeBlock language="bash">{`GET /api/v1/saved-filters

# 응답: 생성 시간 역순(최신순) 배열
# [
#   {
#     "id": "sf_xxxxxxxx",
#     "name": "GPT-4o 에러만",
#     "filters": { "provider": "openai", "model": "gpt-4o", "status": "5xx" },
#     "created_at": "2026-05-15T09:00:00.000Z"
#   },
#   ...
# ]`}</CodeBlock>

      <h3>저장</h3>
      <CodeBlock language="bash">{`POST /api/v1/saved-filters
Content-Type: application/json

{
  "name": "GPT-4o 에러만",
  "filters": {
    "provider": "openai",
    "model": "gpt-4o",
    "status": "5xx"
  }
}

# 201 Created
# {
#   "id": "sf_xxxxxxxx",
#   "name": "GPT-4o 에러만",
#   "filters": { "provider": "openai", "model": "gpt-4o", "status": "5xx" },
#   "created_at": "2026-05-15T09:00:00.000Z"
# }`}</CodeBlock>

      <h3>삭제</h3>
      <CodeBlock language="bash">{`DELETE /api/v1/saved-filters/:id

# 204 No Content`}</CodeBlock>

      <h2>요청/응답 스키마</h2>
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
            <td><code>name</code></td>
            <td><code>string</code></td>
            <td>1–80자. 동일 사용자 내에서 중복 불가 (중복 시 409 반환)</td>
          </tr>
          <tr>
            <td><code>filters</code></td>
            <td><code>object</code></td>
            <td>
              저장할 필터 값의 자유형 JSON 객체. UI가 읽고 쓰는 형식 그대로 저장됩니다. 서버는
              내용을 파싱하지 않고 JSONB로 그대로 보관합니다.
            </td>
          </tr>
          <tr>
            <td><code>id</code></td>
            <td><code>string</code></td>
            <td>서버 생성 식별자</td>
          </tr>
          <tr>
            <td><code>created_at</code></td>
            <td><code>string (ISO 8601)</code></td>
            <td>생성 시각. 목록은 이 값 역순으로 정렬됩니다.</td>
          </tr>
        </tbody>
      </table>

      <h2>에러 코드</h2>
      <table>
        <thead>
          <tr>
            <th>HTTP 상태</th>
            <th>원인</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>400</code></td>
            <td><code>name</code>이 없거나 길이 초과, <code>filters</code>가 누락됨</td>
          </tr>
          <tr>
            <td><code>401</code></td>
            <td>JWT 토큰 없음 또는 만료</td>
          </tr>
          <tr>
            <td><code>404</code></td>
            <td>삭제 대상 ID가 존재하지 않거나 본인 소유가 아님</td>
          </tr>
          <tr>
            <td><code>409</code></td>
            <td>동일 이름의 필터가 이미 존재함</td>
          </tr>
        </tbody>
      </table>

      <h2>curl 예시</h2>
      <CodeBlock language="bash">{`# 목록 조회
curl https://api.spanlens.io/api/v1/saved-filters \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"

# 저장
curl -X POST https://api.spanlens.io/api/v1/saved-filters \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Anthropic 429 에러","filters":{"provider":"anthropic","status":"4xx"}}'

# 삭제
curl -X DELETE https://api.spanlens.io/api/v1/saved-filters/sf_xxxxxxxx \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"`}</CodeBlock>

      <h2>제한 사항</h2>
      <ul>
        <li>
          <strong>조직 공유 없음.</strong> 저장된 필터는 본인만 볼 수 있습니다. 팀 공유 필터는
          로드맵에 있습니다.
        </li>
        <li>
          <strong>필터 내용 검증 없음.</strong> <code>filters</code> 객체의 키/값은 서버가
          검증하지 않습니다. 잘못된 필터 값을 저장해도 오류가 발생하지 않지만, /requests UI에서
          불러왔을 때 해당 필드가 무시될 수 있습니다.
        </li>
        <li>
          <strong>사용자당 최대 100개.</strong> 초과 시 가장 오래된 필터를 삭제 후 재생성하세요.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/requests">Requests</a> (필터 뷰),{' '}
        <a href="/requests">/requests</a> 대시보드.
      </p>
    </div>
  )
}
