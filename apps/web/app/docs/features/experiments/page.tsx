import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Experiments · Spanlens Docs',
  description:
    '오프라인 side-by-side 비교 — dataset의 입력을 두 prompt 버전으로 실행해 출력·점수·비용을 직접 비교합니다.',
}

export default function ExperimentsDocs() {
  return (
    <div>
      <h1>Experiments</h1>
      <p className="lead">
        dataset의 각 입력을 <strong>두 prompt 버전</strong>으로 실행해 출력 텍스트를 단어 단위
        diff로 비교하고, evaluator가 있으면 양쪽 점수까지 매깁니다. 프로덕션 트래픽에 영향 없이
        &quot;v2가 정말 v3보다 나은가&quot;에 답할 수 있습니다.
      </p>

      <h2>A/B(Prompts) vs Experiments</h2>
      <p>
        Spanlens에는 &quot;실험&quot;이라는 단어가 두 곳에 등장합니다. 헷갈리지 않도록 명확히
        구분하세요:
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>A/B (Prompts 탭 내부)</th>
              <th>Experiments (이 탭)</th>
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
              <td>통계적 유의성 (Welch&apos;s t-test)</td>
              <td>출력 텍스트 직접 비교 + 점수</td>
            </tr>
            <tr>
              <td>위험</td>
              <td>나쁜 버전이 사용자에게 감</td>
              <td>없음</td>
            </tr>
            <tr>
              <td>비용 예측</td>
              <td>어려움 (며칠 운영)</td>
              <td>명확 (items × 2 + judge × 2)</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        보완 관계입니다: <strong>Experiments로 사전 검증 → A/B로 프로덕션 검증</strong>.
      </p>

      <h2>실행 흐름</h2>
      <ol>
        <li>
          <a href="/experiments">/experiments</a>에서 <strong>New experiment</strong> 클릭
        </li>
        <li>
          name → prompt → Version A (control) / Version B (challenger) → dataset → optional
          evaluator → run provider / model 선택
        </li>
        <li>
          서버가 dataset의 각 item에 대해 양쪽 버전을 <em>같은 모델</em>로 병렬 실행 (concurrency 3)
        </li>
        <li>
          evaluator가 지정됐다면 양쪽 응답을 LLM judge로 채점
        </li>
        <li>
          UI에 결과: KPI 카드 (avg_A, avg_B, Δ, total_cost) + 결과 row 펼치기 → 단어 단위 diff
          하이라이트
        </li>
      </ol>

      <h2>단어 단위 diff 하이라이트</h2>
      <p>각 결과 row를 펼치면 양쪽 output이 나란히 보이고, 차이가 색으로 표시됩니다.</p>
      <ul>
        <li><strong>빨강</strong> — A에는 있는데 B에는 없는 단어</li>
        <li><strong>초록</strong> — B에는 있는데 A에는 없는 단어</li>
        <li>같은 단어는 색 없음</li>
      </ul>
      <p>
        간단한 token-level 비교라 의미 단위는 아니지만, 어느 부분이 달라졌는지 즉시 보입니다.
      </p>

      <h2>비용 가시화</h2>
      <p>
        <strong>사용자의 provider key로 청구</strong>됩니다 (Spanlens 부담 없음). 대략:
      </p>
      <ul>
        <li>Prompt 실행: <code>dataset items × 2</code> (양쪽 arm)</li>
        <li>Judge 호출(있는 경우): <code>+ dataset items × 2</code></li>
        <li>총 호출 수 = <code>items × 2 × (evaluator 있으면 2)</code></li>
      </ul>
      <p>
        예: 50개 dataset × evaluator 사용 → 50×4 = 200 LLM 호출. gpt-4o-mini 기준 약 $0.1 미만.
      </p>
      <p>안전장치: dataset items <strong>최대 200건 hard cap</strong>.</p>

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
            <td><code>POST /api/v1/experiments</code></td>
            <td>생성 + 백그라운드 실행 (즉시 202)</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/experiments?promptName=...</code></td>
            <td>목록 조회 (max 50)</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/experiments/:id</code></td>
            <td>한 experiment의 상태/집계 (pending/running 동안 폴링)</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/experiments/:id/results</code></td>
            <td>item별 양쪽 결과 + dataset_items 조인</td>
          </tr>
        </tbody>
      </table>

      <h3>예시</h3>
      <CodeBlock language="bash">{`curl https://spanlens-server.vercel.app/api/v1/experiments \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "support v2 vs v3",
    "promptName": "support_reply",
    "versionAId": "<v2-id>",
    "versionBId": "<v3-id>",
    "datasetId": "<dataset-id>",
    "evaluatorId": "<optional-evaluator-id>",
    "runProvider": "openai",
    "runModel": "gpt-4o-mini"
  }'`}</CodeBlock>

      <h2>입력 처리 규칙</h2>
      <p>
        dataset_item의 <code>input</code> shape에 따라 prompt 실행 방식이 달라집니다:
      </p>
      <ul>
        <li>
          <code>{`{ "variables": {...} }`}</code> — prompt content의 <code>{`{{var}}`}</code>{' '}
          placeholder를 치환한 결과를 user message로 전달
        </li>
        <li>
          <code>{`{ "messages": [...] }`}</code> — 마지막 user 메시지를 추출해 user role로 전달
          (prompt content는 system role)
        </li>
      </ul>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>2-arm 비교만.</strong> 3개 이상 버전 동시 비교는 추후.
        </li>
        <li>
          <strong>같은 모델로만 비교.</strong> v2/v3 둘 다 같은 <code>run_model</code>로 실행됨.
          모델까지 다르게 비교하고 싶다면 두 experiment를 따로 돌리세요.
        </li>
        <li>
          <strong>실행 중단 / 재개 없음.</strong> 시작하면 끝까지 가거나 실패 처리.
        </li>
        <li>
          <strong>200건 hard cap.</strong> 대규모 회귀 테스트는 dataset을 쪼개서 여러 experiment로
          실행.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        관련: <a href="/docs/features/datasets">Datasets</a>,{' '}
        <a href="/docs/features/evals">Evals</a>,{' '}
        <a href="/docs/features/prompts">Prompts</a> (A/B 라우팅 비교),{' '}
        <a href="/experiments">/experiments</a> 대시보드.
      </p>
    </div>
  )
}
