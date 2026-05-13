import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Evals · Spanlens Docs',
  description:
    'LLM-as-judge 평가 — production 응답을 기준에 따라 0..1점으로 자동 채점하고 prompt 버전별 품질을 수치화합니다.',
}

export default function EvalsDocs() {
  return (
    <div>
      <h1>Evals</h1>
      <p className="lead">
        프로덕션 요청의 응답 품질을 LLM-as-judge로 자동 채점합니다. 비용·레이턴시(이미 측정)에
        품질(Evals)을 더해 <em>이 프롬프트가 진짜 좋아졌나</em>에 답할 수 있게 됩니다.
      </p>

      <h2>풀고 싶은 문제</h2>
      <p>
        Spanlens가 측정하던 것: 비용, 레이턴시, 에러율. <strong>측정하지 못하던 것:</strong> 응답이
        실제로 좋은가?
      </p>
      <p>
        v1이 v2보다 빠르고 싸도, 사용자가 받은 응답 품질이 떨어지면 그 비교는 무의미합니다.
        Evals는 응답 본문에 0..1점을 매기는 인프라입니다.
      </p>

      <h2>동작 방식 (MVP)</h2>

      <h3>Evaluator 정의</h3>
      <p>Evaluator는 <em>어떤 기준으로 점수를 매길지</em>의 재사용 가능한 정의입니다.</p>
      <ul>
        <li><code>prompt_name</code> — 어느 프롬프트를 위한 evaluator인지</li>
        <li><code>name</code> — 예: &quot;친절도 평가&quot;</li>
        <li><code>type</code> — MVP는 <code>llm_judge</code> 한 종류</li>
        <li>
          <code>config</code>:
          <ul>
            <li><code>criterion</code> — 채점 기준 문장</li>
            <li><code>judge_provider</code> — <code>openai</code> / <code>anthropic</code></li>
            <li><code>judge_model</code> — 예: <code>gpt-4o-mini</code></li>
            <li><code>scale_min</code>, <code>scale_max</code> — 점수 범위 (저장 시 0..1 정규화)</li>
          </ul>
        </li>
      </ul>

      <h3>실행 흐름</h3>
      <ol>
        <li><code>/evals</code>에서 <strong>New evaluator</strong> 클릭 → 기준 정의</li>
        <li>리스트에서 <strong>Run</strong> → 버전·기간·sample size 선택</li>
        <li>
          서버가 <code>requests</code> 테이블에서 해당 <code>prompt_version_id</code>의 응답을 N개
          샘플링 → judge LLM에게 채점 요청 (사용자의 provider key 사용)
        </li>
        <li>샘플별 점수가 <code>eval_results</code>에 저장되고 <code>eval_runs.avg_score</code>로 집계</li>
        <li>UI에 점수 분포 + 낮은 점수 5개가 드릴다운으로 표시</li>
      </ol>

      <h3>샘플은 어디서 오나</h3>
      <p>
        다른 평가 도구와 달리 <strong>사용자가 데이터셋을 따로 만들 필요가 없습니다.</strong>{' '}
        Spanlens는 이미 모든 호출을 로깅하므로, <em>해당 prompt version을 사용한 production 응답</em>에서
        자동으로 샘플링합니다.
      </p>
      <p>
        샘플 소스를 <strong>Dataset</strong>으로 바꾸려면 <a href="/docs/features/datasets">Datasets</a>
        탭을 함께 보세요. dataset의 <code>expected_output</code> 필드가 채점 대상이 됩니다.
      </p>

      <h2>A/B 테스트와 다른 점</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>A/B (Prompts 탭 내부)</th>
              <th>Evals (이 탭)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>언제</td>
              <td>프로덕션 트래픽 라우팅</td>
              <td>오프라인 채점</td>
            </tr>
            <tr>
              <td>측정</td>
              <td>어느 버전이 더 많이 쓰이나 / 덜 실패하나</td>
              <td>응답 품질 점수</td>
            </tr>
            <tr>
              <td>소요 시간</td>
              <td>며칠 (통계 유의성 대기)</td>
              <td>분 단위 (샘플 50개면 1~2분)</td>
            </tr>
            <tr>
              <td>사용자 영향</td>
              <td>실사용자에 노출됨</td>
              <td>없음</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        둘은 보완 관계입니다. Evals로 <em>A/B 돌릴 가치가 있는지</em> 사전 검증 → A/B로 프로덕션
        검증, 이런 순서가 자연스럽습니다.
      </p>

      <h2>Calls 탭의 QUALITY 컬럼 연결</h2>
      <p>
        Prompts 탭 → 특정 프롬프트 → Calls 서브탭의 <strong>Quality</strong> 컬럼은 이 페이지에서
        실행한 evaluator의 <code>eval_results</code> 평균을 표시합니다. 한 번도 evaluator를 실행하지
        않은 버전은 <code>—</code>로 표시됩니다.
      </p>
      <p>색상 기준:</p>
      <ul>
        <li><strong>≥70</strong> good (green)</li>
        <li><strong>40–69</strong> warn (yellow)</li>
        <li><strong>&lt;40</strong> bad (red)</li>
      </ul>

      <h2>LLM judge 신뢰도 검증</h2>
      <p>
        LLM judge가 매긴 점수가 사람의 판단과 얼마나 일치하는지 모르면 그 점수를 신뢰할 수
        없습니다. <a href="/docs/features/annotation">Annotation</a> 탭에서 사람이 직접 채점하면,
        Evals 페이지 상단에 <strong>Pearson r 상관도 카드</strong>가 자동으로 나타납니다.
      </p>
      <ul>
        <li><strong>r ≥ 0.7</strong> — Strong (judge 신뢰 가능)</li>
        <li><strong>0.4 ≤ r &lt; 0.7</strong> — Moderate</li>
        <li><strong>r &lt; 0.4</strong> — judge의 criterion을 다시 봐야 함</li>
      </ul>

      <h2>비용</h2>
      <p>
        Judge는 <strong>사용자의 provider key로 청구</strong>됩니다 (Spanlens가 대납하지 않음).
        gpt-4o-mini 기준 한 건 평가 시 약 <code>$0.0005</code>. 50건이면 <code>$0.025</code>.
      </p>
      <p>안전장치:</p>
      <ul>
        <li><code>sample_size</code> DB CHECK 제약: 1..1000</li>
        <li>실행 전 예상 비용 카드 표시 (Run 다이얼로그)</li>
      </ul>

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
            <td><code>POST /api/v1/evaluators</code></td>
            <td>Evaluator 생성</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/evaluators?promptName=...</code></td>
            <td>목록 조회</td>
          </tr>
          <tr>
            <td><code>DELETE /api/v1/evaluators/:id</code></td>
            <td>Soft archive</td>
          </tr>
          <tr>
            <td><code>POST /api/v1/eval-runs</code></td>
            <td>실행 시작 (즉시 202, 백그라운드 진행)</td>
          </tr>
          <tr>
            <td><code>POST /api/v1/eval-runs/estimate</code></td>
            <td>사전 비용 추정</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/eval-runs/:id</code></td>
            <td>한 run의 상태/집계 (pending/running 동안 폴링)</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/eval-runs/:id/results</code></td>
            <td>샘플별 점수 + reasoning</td>
          </tr>
        </tbody>
      </table>

      <h2>예시 — evaluator 만들고 실행</h2>
      <CodeBlock language="bash">{`# 1. Evaluator 정의
curl https://spanlens-server.vercel.app/api/v1/evaluators \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "promptName": "support_reply",
    "name": "친절도 평가",
    "type": "llm_judge",
    "config": {
      "criterion": "응답이 친절하고 명확하게 고객 질문에 답하는가?",
      "judge_provider": "openai",
      "judge_model": "gpt-4o-mini",
      "scale_min": 0,
      "scale_max": 1
    }
  }'

# 2. v2에 대해 지난 7일 50건 채점
curl https://spanlens-server.vercel.app/api/v1/eval-runs \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "evaluatorId": "<evaluator-id>",
    "promptVersionId": "<v2-id>",
    "source": "production",
    "sampleSize": 50,
    "sampleFrom": "2026-05-06T00:00:00Z"
  }'

# 3. 결과 폴링 (status: pending → running → completed)
curl https://spanlens-server.vercel.app/api/v1/eval-runs/<run-id> \\
  -H "Authorization: Bearer $SPANLENS_JWT"`}</CodeBlock>

      <h2>Limitations (MVP 단계 솔직 평가)</h2>
      <ul>
        <li>
          <strong>Evaluator 타입은 <code>llm_judge</code>만.</strong> regex / JSON schema /
          length 같은 heuristic evaluator는 추후.
        </li>
        <li>
          <strong>Multi-evaluator 동시 실행 없음.</strong> 한 번에 하나만 돌릴 수 있습니다.
        </li>
        <li>
          <strong><code>response_body</code>가 비어있는 28% 가량의 row는 자동 스킵.</strong>{' '}
          스트리밍 파서 실패 / 옛 데이터 / 에러 응답 등. &quot;47/50 채점됨&quot;처럼 표시됩니다.
        </li>
        <li>
          <strong>Judge 자체가 부정확할 수 있음.</strong> 그래서 Annotation 탭으로 검증할 수
          있도록 만들어 둡니다.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        관련: <a href="/docs/features/datasets">Datasets</a> (테스트 입력 세트),{' '}
        <a href="/docs/features/experiments">Experiments</a> (오프라인 side-by-side 비교),{' '}
        <a href="/docs/features/annotation">Annotation</a> (사람 채점),{' '}
        <a href="/evals">/evals</a> 대시보드.
      </p>
    </div>
  )
}
