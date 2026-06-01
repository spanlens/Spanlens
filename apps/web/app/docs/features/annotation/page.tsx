import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Annotation · Spanlens Docs',
  description:
    'Human star-rating for production responses. Pearson r correlation with LLM judge scores makes judge reliability visible at a glance.',
}

export default function AnnotationDocs() {
  return (
    <div>
      <h1>Annotation</h1>
      <p className="lead">
        Team members rate production responses with 1–5 stars. Comparing those ratings to LLM
        judge scores reveals in a single number (<code>Pearson r</code>) whether the judge can
        actually be trusted.
      </p>

      <h2>Why it matters</h2>
      <p>
        An <a href="/docs/features/evals">Evals</a> judge score is meaningless if it doesn&apos;t
        correlate with human judgment. If the judge gives 70 but a human gives 30, the criterion
        needs rethinking.
      </p>
      <p>
        Annotation is where you build that validation dataset. The ratings can also serve as
        ground truth for future fine-tuning.
      </p>

      <h2>Rating flow</h2>
      <ol>
        <li>
          Go to <strong>REVIEW → Annotation</strong> in the sidebar.
        </li>
        <li>
          Use the top filters: select a prompt / enable <strong>Unscored only</strong> (show
          only what you haven&apos;t rated yet) / enable{' '}
          <strong>Low judge score</strong> (judge scored below 50, highest validation priority).
        </li>
        <li>
          Each card shows the user input and response in two columns. Click{' '}
          <strong>expand</strong> to read the full content.
        </li>
        <li>
          Click a star rating (1–5), optionally add a comment, and click{' '}
          <strong>Save rating</strong>.
        </li>
        <li>
          Already-rated rows show &quot;You: 60&quot; in the header. Rating the same row again
          overwrites the previous score.
        </li>
      </ol>

      <h2>Score normalization</h2>
      <p>
        Users click 1–5 stars, but the database stores the value normalized to 0..1 as{' '}
        <code>(stars - 1) / 4</code>. This makes it directly comparable to{' '}
        <code>eval_results.score</code> (which is already 0..1) for Pearson r calculation.
      </p>
      <table>
        <thead>
          <tr>
            <th>Stars</th>
            <th>Normalized score</th>
            <th>UI display (×100)</th>
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
        Both <code>raw_score</code> (original star count) and <code>score</code> (normalized)
        are stored, so the UI can display the original star rating.
      </p>

      <h2>Duplicate prevention</h2>
      <p>
        A <code>UNIQUE (request_id, reviewer_id)</code> constraint ensures each user leaves
        at most one score per request. Rating the same row again performs an{' '}
        <strong>upsert</strong>, it updates <code>raw_score</code>, <code>score</code>, and{' '}
        <code>comment</code>.
      </p>
      <p>Multiple reviewers can rate the same request, each gets their own row.</p>

      <h2>Correlation card on the Evals page</h2>
      <p>
        When a request has both an LLM judge score and a human score, it forms a{' '}
        <em>paired sample</em>. A per-prompt <strong>Pearson r card</strong> appears automatically
        at the top of the <a href="/evals">/evals</a> page.
      </p>
      <ul>
        <li>
          <strong>r ≥ 0.7</strong>, Strong: judge can be trusted
        </li>
        <li>
          <strong>0.4 ≤ r &lt; 0.7</strong>, Moderate
        </li>
        <li>
          <strong>r &lt; 0.4</strong>, Revisit the judge criterion
        </li>
      </ul>
      <p>
        The card includes a 120×120 SVG scatter plot with a diagonal reference line (perfect
        agreement) so you can see visually where the divergence occurs.
      </p>

      <h2>RLS policy</h2>
      <ul>
        <li><strong>SELECT</strong>, any org member (you can see others&apos; scores)</li>
        <li><strong>INSERT</strong>, any org member</li>
        <li><strong>UPDATE / DELETE</strong>, own rows only (<code>reviewer_id = auth.uid()</code>)</li>
      </ul>

      <h2>API</h2>
      <table>
        <thead>
          <tr>
            <th>Method + Path</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>GET /api/v1/annotation/queue</code></td>
            <td>Rating queue (filters: promptName, promptVersionId, unscoredOnly, lowJudgeScoreOnly)</td>
          </tr>
          <tr>
            <td><code>POST /api/v1/human-evals</code></td>
            <td>Save a rating (upsert)</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/human-evals?promptVersionId=...</code></td>
            <td>List ratings for a specific version</td>
          </tr>
          <tr>
            <td><code>DELETE /api/v1/human-evals/:id</code></td>
            <td>Delete your own rating</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/human-evals/correlation?promptName=...</code></td>
            <td>Returns (judgeScore, humanScore) pairs. Client computes Pearson r.</td>
          </tr>
        </tbody>
      </table>

      <h3>Example, save a rating</h3>
      <CodeBlock language="bash">{`# 4 stars + comment
curl https://server.spanlens.io/api/v1/human-evals \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "requestId": "<request-uuid>",
    "score": 0.75,
    "rawScore": 4,
    "comment": "Friendly but a bit long"
  }'`}</CodeBlock>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>No keyboard shortcuts.</strong> j/k navigation and 1–5 number key shortcuts
          are planned. Currently mouse-only.
        </li>
        <li>
          <strong>No multi-reviewer averaging.</strong> The correlation card uses the most recent
          score per request, not an average across reviewers.
        </li>
        <li>
          <strong>No reviewer permission management.</strong> Any org member can rate any request.
        </li>
        <li>
          <strong>experiment_results / eval_results are not ratable.</strong> Only direct requests
          can be annotated. A UI for human pairwise comparison of experiment arms is planned.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/evals">Evals</a> (LLM judge infrastructure),{' '}
        <a href="/annotation">/annotation</a> dashboard.
      </p>
    </div>
  )
}
