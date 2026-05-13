import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Annotation · Spanlens Docs',
  description:
    '사람이 직접 응답을 별점으로 채점. LLM judge 점수와의 Pearson 상관도가 판단의 신뢰도를 가시화합니다.',
}

export default function AnnotationDocs() {
  return (
    <div>
      <h1>Annotation</h1>
      <p className="lead">
        팀원이 production 응답을 직접 1–5 별점으로 채점합니다. 그 결과를 LLM judge 점수와 비교하면{' '}
        <em>judge를 신뢰할 수 있는지</em>가 한 줄(<code>Pearson r</code>)로 드러납니다.
      </p>

      <h2>왜 필요한가</h2>
      <p>
        <a href="/docs/features/evals">Evals</a>의 LLM judge가 매긴 점수가 <em>실제로 의미가 있는지</em>{' '}
        모르면 그 점수를 신뢰할 수 없습니다. judge가 70점 줬는데 사람이 30점 주는 응답이 많다면
        criterion을 다시 봐야 합니다.
      </p>
      <p>
        Annotation은 그 검증 데이터를 만드는 곳입니다. 또한 향후 fine-tuning용 ground truth로도
        활용 가능합니다.
      </p>

      <h2>채점 흐름</h2>
      <ol>
        <li>
          사이드바 <strong>REVIEW → Annotation</strong> 진입
        </li>
        <li>
          상단 필터: prompt 선택 / <strong>Unscored only</strong> (내가 채점 안 한 것만) /{' '}
          <strong>Low judge score</strong> (judge가 50 미만 준 것만 → 검증 우선순위)
        </li>
        <li>
          각 카드에 user input + response가 2-column으로 표시. <strong>expand</strong>로 전체 보기
        </li>
        <li>
          1–5 별 클릭 + 코멘트(선택) + <strong>Save rating</strong>
        </li>
        <li>이미 채점한 row는 헤더에 &quot;You: 60&quot;처럼 표시되고, 같은 row 다시 채점하면 덮어씀</li>
      </ol>

      <h2>점수 변환 규칙</h2>
      <p>
        사용자는 1–5 별을 클릭하지만, DB에는 <code>(stars - 1) / 4</code>로 0..1 정규화되어
        저장됩니다. 이렇게 해야 <code>eval_results.score</code>(이미 0..1)와 직접 상관 계산이
        가능합니다.
      </p>
      <table>
        <thead>
          <tr>
            <th>별점</th>
            <th>정규화 score</th>
            <th>UI 표시 (×100)</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>1</td><td>0.00</td><td>0</td></tr>
          <tr><td>2</td><td>0.25</td><td>25</td></tr>
          <tr><td>3</td><td>0.50</td><td>50</td></tr>
          <tr><td>4</td><td>0.75</td><td>75</td></tr>
          <tr><td>5</td><td>1.00</td><td>100</td></tr>
        </tbody>
      </table>
      <p>
        <code>raw_score</code> (별점 원본)와 <code>score</code> (정규화) 둘 다 저장하므로 UI는
        별점 그대로 다시 보여줄 수 있습니다.
      </p>

      <h2>중복 채점 방지</h2>
      <p>
        DB에 <code>UNIQUE (request_id, reviewer_id)</code> 제약이 있어 한 사용자는 한 request에
        한 번만 점수가 남습니다. 같은 row 다시 채점하면 <strong>upsert로 덮어씁니다</strong>{' '}
        (raw_score / score / comment 모두 갱신).
      </p>
      <p>여러 reviewer가 같은 request를 채점하는 건 허용됩니다 (각자 한 row씩).</p>

      <h2>Evals 페이지의 상관도 카드</h2>
      <p>
        같은 request에 LLM judge 점수와 사람 점수가 모두 있는 경우 <em>paired sample</em>이
        됩니다. <a href="/evals">/evals</a> 페이지 상단에 prompt별 <strong>Pearson r 카드</strong>가
        자동으로 나타납니다.
      </p>
      <ul>
        <li>
          <strong>r ≥ 0.7</strong> Strong — judge 신뢰 가능
        </li>
        <li>
          <strong>0.4 ≤ r &lt; 0.7</strong> Moderate
        </li>
        <li>
          <strong>r &lt; 0.4</strong> — judge criterion 재검토 필요
        </li>
      </ul>
      <p>
        카드에 산점도(120×120 SVG)와 대각 reference line(완벽 일치 선)이 함께 표시되어 어디서
        괴리가 생기는지 시각적으로 보입니다.
      </p>

      <h2>RLS 정책</h2>
      <ul>
        <li><strong>SELECT</strong> — org member 누구나 (다른 사람 점수도 볼 수 있음)</li>
        <li><strong>INSERT</strong> — org member</li>
        <li><strong>UPDATE / DELETE</strong> — 본인 row만 (reviewer_id = auth.uid())</li>
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
            <td><code>GET /api/v1/annotation/queue</code></td>
            <td>채점 대기 큐 (필터: promptName, promptVersionId, unscoredOnly, lowJudgeScoreOnly)</td>
          </tr>
          <tr>
            <td><code>POST /api/v1/human-evals</code></td>
            <td>채점 저장 (upsert)</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/human-evals?promptVersionId=...</code></td>
            <td>특정 버전 채점 목록</td>
          </tr>
          <tr>
            <td><code>DELETE /api/v1/human-evals/:id</code></td>
            <td>본인 점수 삭제</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/human-evals/correlation?promptName=...</code></td>
            <td>(judgeScore, humanScore) 쌍 반환. 클라이언트가 Pearson r 계산</td>
          </tr>
        </tbody>
      </table>

      <h3>예시 — 채점 저장</h3>
      <CodeBlock language="bash">{`# 별 4점 + 코멘트
curl https://spanlens-server.vercel.app/api/v1/human-evals \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "requestId": "<request-uuid>",
    "score": 0.75,
    "rawScore": 4,
    "comment": "친절하지만 조금 길다"
  }'`}</CodeBlock>

      <h2>Limitations (MVP)</h2>
      <ul>
        <li>
          <strong>단축키 없음.</strong> 키보드 j/k 다음/이전, 1–5 점수 단축키는 추후. 지금은
          마우스 클릭만.
        </li>
        <li>
          <strong>다중 reviewer 평균/일치도 계산 없음.</strong> 한 사람의 점수만 상관도에
          반영됩니다 (가장 최신).
        </li>
        <li>
          <strong>Reviewer 권한 관리 없음.</strong> org member 누구나 채점 가능.
        </li>
        <li>
          <strong>experiment_results / eval_results 채점 안 됨.</strong> 직접 request만 채점
          대상. experiment의 양쪽 arm을 사람이 비교 선택하는 UI는 추후.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        관련: <a href="/docs/features/evals">Evals</a> (LLM judge 인프라),{' '}
        <a href="/annotation">/annotation</a> 대시보드.
      </p>
    </div>
  )
}
