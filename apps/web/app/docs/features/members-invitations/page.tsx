import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Members & invitations · Spanlens Docs',
  description:
    'Multi-user workspaces, roles (admin / editor / viewer), email invitations with auto-accept on the dashboard, and the audit log that records every membership event.',
}

export default function MembersInvitationsDocs() {
  return (
    <div>
      <h1>Members &amp; invitations</h1>
      <p className="lead">
        Spanlens is multi-user out of the box. Invite teammates by email,
        hand out roles, switch between workspaces, and watch every membership
        event in the audit log. Nothing here costs extra — it&rsquo;s the
        same flow on the Free plan as on Enterprise.
      </p>

      <h2 id="roles">Roles</h2>
      <p>
        Every membership row carries one of three roles. The role is checked
        server-side via the <code>requireRole</code> middleware on every
        write endpoint, and surfaces in the dashboard via
        <code>{'<PermissionGate need="…">'}</code> so disabled buttons /
        hidden settings stay consistent with what the API will actually
        let through.
      </p>
      <table>
        <thead>
          <tr>
            <th>Role</th>
            <th>Read</th>
            <th>Edit data</th>
            <th>Manage members &amp; billing</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>admin</strong></td>
            <td>✓</td>
            <td>✓</td>
            <td>✓</td>
          </tr>
          <tr>
            <td><strong>editor</strong></td>
            <td>✓</td>
            <td>✓</td>
            <td>—</td>
          </tr>
          <tr>
            <td><strong>viewer</strong></td>
            <td>✓</td>
            <td>—</td>
            <td>—</td>
          </tr>
        </tbody>
      </table>
      <p>
        The <strong>last admin</strong> in a workspace is protected — the
        API rejects any attempt to demote or remove them. Promote a second
        admin first if you need to leave.
      </p>

      <h2 id="invite">Inviting a teammate</h2>
      <p>
        Settings → <a href="/settings">Members</a> → <strong>+ Invite member</strong>.
        Enter an email and pick a role. We POST to{' '}
        <code>/api/v1/organizations/:orgId/invitations</code>; the server
        creates an <code>org_invitations</code> row with a 7-day expiry and
        a sha256-hashed token. The raw token only ever lives in the email
        URL — a database leak cannot turn into working invite links.
      </p>

      <h3>Two ways the recipient sees it</h3>
      <ol>
        <li>
          <strong>Email link.</strong> If you have <code>RESEND_API_KEY</code>{' '}
          configured, the invitee gets an email with an Accept button. The
          link goes to <code>/invite?token=…</code>, which verifies the
          token, checks the email matches the signed-in account, then
          shows Accept / Decline.
        </li>
        <li>
          <strong>Dashboard banner.</strong> Even if the email never
          arrives — bounce, spam folder, admin DM&rsquo;d the invite
          instead — the recipient&rsquo;s next dashboard navigation
          surfaces a banner across the top:{' '}
          <em>&ldquo;Acme Inc. invited you as editor.&rdquo;</em> with{' '}
          <strong>Accept</strong> / <strong>Decline</strong> buttons. The
          banner queries <code>GET /me/pending-invitations</code> on every
          dashboard page so this catches every invite regardless of
          delivery channel.
        </li>
      </ol>

      <p>
        Both paths converge on the same server-side handler. Accept inserts
        the <code>org_members</code> row, marks the invitation accepted,
        sets <code>onboarded_at</code> on the user&rsquo;s profile (so the
        dashboard layout&rsquo;s onboarding gate lets them through), and
        returns the joined organization id. The client writes that id to
        the <code>sb-ws</code> cookie and hard-reloads — the user lands
        in the joined workspace immediately.
      </p>

      <h3>Decline vs Dismiss</h3>
      <p>
        The dashboard banner has two negative actions and they are not the
        same:
      </p>
      <ul>
        <li>
          <strong>Decline</strong> — DELETEs the invitation row. The user
          will not see this invite again unless an admin re-invites the
          same email (which creates a new row).
        </li>
        <li>
          <strong>⨯ Dismiss</strong> — session-only hide. Refreshing the
          page brings the banner back. Use this for &ldquo;I see it, just
          not now.&rdquo;
        </li>
      </ul>

      <h2 id="onboarding">First-signup behaviour</h2>
      <p>
        Brand-new users land on <code>/onboarding</code> after sign-up. The
        page checks for pending invitations on their email <em>before</em>{' '}
        showing the workspace-creation step:
      </p>
      <ul>
        <li>
          <strong>Pending invites exist</strong> → an &ldquo;You&rsquo;ve
          been invited&rdquo; screen lists them, each with{' '}
          <strong>Accept</strong>. There&rsquo;s also a{' '}
          <strong>Skip &amp; create my own workspace →</strong> button so
          a user who wants to keep a personal sandbox alongside their
          company workspace isn&rsquo;t forced into either / or.
        </li>
        <li>
          <strong>No pending invites</strong> → the standard 2-step
          onboarding (workspace name → optional survey).
        </li>
      </ul>

      <h2 id="switch">Switching workspaces</h2>
      <p>
        The active workspace is stored in the <code>sb-ws</code> cookie.
        Both the Next.js middleware and the Hono <code>authJwt</code>{' '}
        middleware read it on every request to set the org scope, so a
        switch must be explicit and observable across the whole app.
      </p>
      <p>
        Click the workspace box at the top-left of the sidebar and pick
        a workspace from the <strong>Workspaces</strong> section. The
        sidebar writes the new id to <code>sb-ws</code> and hard-reloads
        the page — middleware re-resolves, every TanStack Query cache is
        cleared, and the dashboard re-renders against the new org.
      </p>
      <p>
        Need a fresh workspace (consultancy with a new client, separate
        prod / staging)? <strong>+ New workspace</strong> in the same
        dropdown opens a modal; the server creates the org + admin
        membership + a default project in one round-trip.
      </p>

      <h2 id="audit">Audit log</h2>
      <p>
        Settings → <strong>Audit log</strong> records every membership
        event with the actor, timestamp, and target. Inviting, accepting,
        declining, role changes, and member removal all show up. Free for
        all plans on the past 30 days; longer retention on Pro and above.
      </p>

      <h2 id="api">API reference</h2>
      <p>
        The dashboard is a thin client over a stable REST API. Use it
        directly if you need to script provisioning.
      </p>
      <CodeBlock language="http">{`# Admin: list / send / cancel invitations
GET    /api/v1/organizations/:orgId/invitations
POST   /api/v1/organizations/:orgId/invitations    body: { email, role }
DELETE /api/v1/invitations/:id

# Recipient: list / accept / decline (signed-in user's email)
GET    /api/v1/me/pending-invitations
POST   /api/v1/me/pending-invitations/:id/accept
DELETE /api/v1/me/pending-invitations/:id

# Email-link variants (token in body)
GET    /api/v1/invitations/accept?token=...        (public, returns invite metadata)
POST   /api/v1/invitations/accept                  body: { token }
POST   /api/v1/invitations/decline                 body: { token }

# Members
GET    /api/v1/organizations/:orgId/members
PATCH  /api/v1/organizations/:orgId/members/:userId   body: { role }
DELETE /api/v1/organizations/:orgId/members/:userId`}</CodeBlock>

      <p>
        All endpoints require a Supabase JWT in the{' '}
        <code>Authorization: Bearer …</code> header. Admin-only routes
        additionally check the role server-side.
      </p>

      <hr />

      <p className="text-sm text-muted-foreground">
        Email delivery is best-effort: when <code>RESEND_API_KEY</code> is
        not configured, the server skips the send and returns the accept
        URL as <code>devAcceptUrl</code> in the API response so an admin
        can hand-deliver it. Set up a verified Resend sender to avoid
        spam folders — see <a href="/docs/self-host#env">self-host env vars</a>.
      </p>
    </div>
  )
}
