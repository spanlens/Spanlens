import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Prompt A/B · Spanlens Docs',
  description:
    '실제 프로덕션 트래픽을 두 prompt 버전으로 분기해 통계적 유의성을 검증합니다. 오프라인 Experiments와의 차이점, 생성·종료·winner 설정 방법을 설명합니다.',
}

export default function PromptAbDocs() {
  return (
    <div>
      <h1>Prompt A/B</h1>
      <p className="lead">
        실제 프로덕션 트래픽을 두 prompt 버전으로 분기해 레이턴시·비용·에러율을 통계적으로 비교합니다.
        오프라인 <a href="/docs/features/experiments">Experiments</a>로 사전 검증을 마친 뒤,
        실사용자에게 노출해 최종 승자를 확정하는 마지막 단계입니다.
      </p>

      <h2>A/B vs Experiments — 언제 무엇을 쓰나</h2>
      <p>
        Spanlens에는 &quot;실험&quot;이라는 개념이 두 곳에 등장합니다. 헷갈리지 않게 정리합니다:
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>A/B (이 문서)</th>
              <th><a href="/docs/features/experiments">Experiments</a> (오프라인)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>데이터 소스</td>
              <td>실제 사용자 트래픽</td>
              <td>사전 정의된 dataset</td>
            </tr>
            <tr>
              <td>실행 시점</td>
              <td>실시간 (며칠 ~ 수 주)</td>
              <td>즉시 실행 (분 단위)</td>
            </tr>
            <tr>
              <td>사용자 노출</td>
              <td>있음 (실제 사용자에게 감)</td>
              <td>없음</td>
            </tr>
            <tr>
              <td>측정 방식</td>
              <td>통계적 유의성 (p-value)</td>
              <td>출력 텍스트 직접 비교 + 점수</td>
            </tr>
            <tr>
              <td>주요 지표</td>
              <td>레이턴시, 비용, 에러율</td>
              <td>응답 품질, 점수 분포</td>
            </tr>
            <tr>
              <td>위험</td>
              <td>나쁜 버전이 사용자에게 노출될 수 있음</td>
              <td>없음</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        권장 순서: <strong>Experiments로 품질 사전 검증 → A/B로 프로덕션 검증</strong>.
        두 도구는 대체 관계가 아니라 보완 관계입니다.
      </p>

      <h2>동작 방식</h2>
      <p>
        A/B 실험을 생성하면 서버가 해당 prompt name으로 들어오는 요청을{' '}
        <code>trafficSplit</code> 비율에 따라 Version A(control) 또는 Version B(challenger)로
        분기합니다. 분기는 <a href="/docs/proxy">Spanlens 프록시</a>를 통과하는 요청에 자동으로
        적용됩니다. 각 요청의 결과는 <code>requests</code> 테이블에 기록되고, 실험이 종료되거나
        수동으로 <code>stopped</code> 처리할 때까지 누적됩니다.
      </p>

      <h2>실험 생성</h2>
      <CodeBlock language="bash">{`POST /api/v1/prompt-experiments`}</CodeBlock>
      <p>인증: JWT (<code>Authorization: Bearer $SPANLENS_JWT</code>)</p>

      <h3>요청 파라미터</h3>
      <div className="overflow-x-auto">
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
              <td><code>promptName</code></td>
              <td>string</td>
              <td>필수</td>
              <td>실험 대상 prompt 이름 (예: <code>chatbot-system</code>)</td>
            </tr>
            <tr>
              <td><code>versionAId</code></td>
              <td>string (UUID)</td>
              <td>필수</td>
              <td>Control arm에 사용할 prompt version ID</td>
            </tr>
            <tr>
              <td><code>versionBId</code></td>
              <td>string (UUID)</td>
              <td>필수</td>
              <td>Challenger arm에 사용할 prompt version ID</td>
            </tr>
            <tr>
              <td><code>trafficSplit</code></td>
              <td>integer</td>
              <td>선택 (기본 50)</td>
              <td>
                Version B로 보낼 트래픽 비율 (1 – 99). 예: 20이면 B:20%, A:80%.
                기본값 50은 50/50 동일 분배
              </td>
            </tr>
            <tr>
              <td><code>endsAt</code></td>
              <td>string (ISO 8601)</td>
              <td>선택</td>
              <td>자동 종료 일시. 설정하지 않으면 수동으로 stopped 처리할 때까지 계속 진행</td>
            </tr>
            <tr>
              <td><code>projectId</code></td>
              <td>string (UUID)</td>
              <td>선택</td>
              <td>실험을 특정 project에 scoping. 미설정 시 organization 전체 범위</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>생성 예시</h3>
      <CodeBlock language="bash">{`curl https://spanlens-server.vercel.app/api/v1/prompt-experiments \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "promptName":   "chatbot-system",
    "versionAId":   "ae1c3c1e-99eb-4f2a-b821-000000000001",
    "versionBId":   "ae1c3c1e-99eb-4f2a-b821-000000000002",
    "trafficSplit": 20,
    "endsAt":       "2026-06-01T00:00:00Z"
  }'`}</CodeBlock>

      <h2>실험 상태</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>status</th>
              <th>의미</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>running</code></td>
              <td>현재 트래픽을 분기 중. 데이터 누적 진행</td>
            </tr>
            <tr>
              <td><code>concluded</code></td>
              <td><code>endsAt</code>에 도달하거나 winner가 설정되어 자동 종료됨</td>
            </tr>
            <tr>
              <td><code>stopped</code></td>
              <td>수동으로 중단 처리됨. winner 없이 종료</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>통계 지표</h2>
      <p>
        각 실험에는 다음 세 가지 통계 검정 결과가 실시간으로 집계됩니다:
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>지표</th>
              <th>검정 방법</th>
              <th>유의 기준</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>레이턴시 (latency)</td>
              <td>Welch&apos;s t-test</td>
              <td>p-value &lt; 0.05</td>
            </tr>
            <tr>
              <td>비용 (cost)</td>
              <td>Welch&apos;s t-test</td>
              <td>p-value &lt; 0.05</td>
            </tr>
            <tr>
              <td>에러율 (error rate)</td>
              <td>Fisher&apos;s exact test</td>
              <td>p-value &lt; 0.05</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        <strong>p-value &lt; 0.05</strong>이면 통계적으로 유의미한 차이가 있음을 의미합니다.
        샘플이 충분하지 않을 때는 (통상 수십 건 이하) p-value가 1에 가까운 값이 나오므로,
        며칠 이상 데이터를 쌓은 뒤 결론을 내리는 것이 좋습니다.
      </p>
      <p>
        Welch&apos;s t-test는 두 그룹의 분산이 다를 때도 유효하게 평균 차이를 검정합니다.
        에러율처럼 이진(성공/실패) 지표에는 Fisher&apos;s exact test가 더 정확합니다.
      </p>

      <h2>Winner 설정</h2>
      <p>
        통계적으로 한 버전이 유의미하게 좋다고 판단되면 winner를 지정합니다. Winner가 설정되면
        실험 status가 <code>concluded</code>로 바뀌고 트래픽 분기가 중단됩니다.
      </p>
      <CodeBlock language="bash">{`PATCH /api/v1/prompt-experiments/:id

curl -X PATCH https://spanlens-server.vercel.app/api/v1/prompt-experiments/<experiment-id> \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "winnerVersionId": "ae1c3c1e-99eb-4f2a-b821-000000000002"
  }'`}</CodeBlock>
      <p>
        Winner로 지정한 버전을 프로덕션 기본으로 굳히려면,{' '}
        <a href="/docs/features/prompts">Prompts</a>의 <strong>Roll back</strong> 또는 새 버전 생성으로
        해당 내용을 latest 버전으로 올리세요.
      </p>

      <h2>중복 실험 제한</h2>
      <p>
        같은 <code>promptName</code>에 대해 <code>running</code> 상태의 실험이 이미 존재하면
        새 실험 생성이 실패합니다(<code>409 Conflict</code>). 먼저 기존 실험을 <code>stopped</code>{' '}
        처리하거나 <code>endsAt</code>을 기다린 후 새 실험을 생성하세요.
      </p>

      <h2>API 레퍼런스</h2>
      <table>
        <thead>
          <tr>
            <th>Method + Path</th>
            <th>설명</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>POST /api/v1/prompt-experiments</code></td>
            <td>실험 생성 + 트래픽 분기 시작</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/prompt-experiments?promptName=...</code></td>
            <td>특정 prompt name의 실험 목록 (최신순)</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/prompt-experiments/:id</code></td>
            <td>실험 상태 + 집계 지표 + p-value 조회</td>
          </tr>
          <tr>
            <td><code>PATCH /api/v1/prompt-experiments/:id</code></td>
            <td>winner 설정 또는 수동 중단 (<code>status: "stopped"</code>)</td>
          </tr>
        </tbody>
      </table>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>2-arm 비교만.</strong> A / B 두 버전만 지정할 수 있습니다. 3개 이상을 동시에
          비교하려면 실험을 별도로 만드세요.
        </li>
        <li>
          <strong>같은 prompt name에 동시 실험 1개.</strong> running 상태의 실험이 있으면 새 실험을
          만들 수 없습니다.
        </li>
        <li>
          <strong>통계 유의성에는 충분한 샘플이 필요합니다.</strong> 하루 호출이 수십 건이라면
          유의미한 결론을 내리기까지 수 주가 걸릴 수 있습니다. 샘플이 적을 때는{' '}
          <a href="/docs/features/experiments">Experiments</a>를 먼저 활용하세요.
        </li>
        <li>
          <strong>응답 품질은 측정하지 않습니다.</strong> 레이턴시·비용·에러율만 집계합니다.
          품질 채점이 필요하면 <a href="/docs/features/evals">Evals</a>를 함께 사용하세요.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        관련: <a href="/docs/features/prompts">Prompts</a> (버전 관리),{' '}
        <a href="/docs/features/experiments">Experiments</a> (오프라인 dataset 기반 비교),{' '}
        <a href="/docs/features/evals">Evals</a> (LLM-as-judge 품질 채점),{' '}
        <a href="/prompts">/prompts</a> 대시보드.
      </p>
    </div>
  )
}
