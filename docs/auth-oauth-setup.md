# OAuth Setup — Google & GitHub Sign-in

Operator guide for enabling the "Continue with Google" and "Continue with
GitHub" buttons on `/login` and `/signup`. The buttons are already wired
in the code — this doc covers the external configuration required to
make them work.

## Architecture recap

```
User clicks "Continue with Google"
  → supabase.auth.signInWithOAuth({ provider: 'google',
       options: { redirectTo: '<origin>/auth/callback' } })
  → Browser redirected to https://accounts.google.com/...
  → Google redirects to Supabase: https://<ref>.supabase.co/auth/v1/callback?code=...
  → Supabase exchanges code, redirects to our /auth/callback?code=...
  → Our route handler runs exchangeCodeForSession + recordOAuthConsentIfMissing
  → Final redirect to /dashboard (which falls through to /onboarding for new users)
```

Two redirect URIs matter:
1. **Provider → Supabase** (configured in Google/GitHub console):
   `https://<supabase-ref>.supabase.co/auth/v1/callback`
2. **Supabase → our app** (configured in Supabase Dashboard URL allowlist):
   `https://<our-domain>/auth/callback`

## 1. Google Cloud Console

1. https://console.cloud.google.com → APIs & Services → Credentials
2. **+ Create Credentials → OAuth client ID** (create OAuth consent screen first if
   prompted; choose "External" + fill in app name / support email / Privacy /
   Terms URLs)
3. Application type: **Web application**
4. Authorized JavaScript origins:
   - `https://www.spanlens.io`
   - `https://spanlens.io`
   - `http://localhost:3000` (dev only)
5. Authorized redirect URIs:
   - `https://gebocvcsjlarxhyauadf.supabase.co/auth/v1/callback` (production)
   - `http://127.0.0.1:54321/auth/v1/callback` (local dev — only if testing OAuth locally)
6. Save → copy **Client ID** and **Client secret**.

## 2. GitHub OAuth App

1. https://github.com/settings/developers → OAuth Apps → **New OAuth App**
2. Application name: `Spanlens` (production) or `Spanlens (Local)` (dev)
3. Homepage URL: `https://www.spanlens.io`
4. Authorization callback URL:
   - Production app: `https://gebocvcsjlarxhyauadf.supabase.co/auth/v1/callback`
   - Local-dev app: `http://127.0.0.1:54321/auth/v1/callback`
   (GitHub OAuth Apps accept only one callback URL — create a separate
   app for local dev if needed.)
5. Register application → **Generate a new client secret** → copy
   Client ID + Client secret.

## 3. Supabase Dashboard

URL: https://supabase.com/dashboard/project/gebocvcsjlarxhyauadf/auth/providers

For **Google**:
- Toggle "Enable Sign in with Google" ON
- Client IDs (comma-separated, web only is fine): paste Google Client ID
- Client Secret (for OAuth): paste Google Client secret
- Leave "Skip nonce checks" and "Allow users without an email" OFF
- Save

For **GitHub**:
- Toggle "Enable Sign in with GitHub" ON
- Client ID: paste GitHub Client ID
- Client Secret: paste GitHub Client secret
- Save

## 4. Supabase URL allowlist

URL: https://supabase.com/dashboard/project/gebocvcsjlarxhyauadf/auth/url-configuration

- **Site URL**: `https://www.spanlens.io`
- **Redirect URLs** — add each on its own line:
  - `https://www.spanlens.io/auth/callback`
  - `https://spanlens.io/auth/callback`
  - `https://spanlens-web.vercel.app/auth/callback`
  - `https://spanlens-*-sunes26s-projects.vercel.app/auth/callback`
  - `http://localhost:3000/auth/callback`

Save.

## 5. Local dev (optional)

Only needed if you want to exercise OAuth end-to-end on your machine.
The buttons will still render without these env vars but clicking them
returns a Supabase error.

1. Populate `apps/web/.env.local`:
   ```
   SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<from step 1>
   SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=<from step 1>
   SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID=<from step 2 local app>
   SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET=<from step 2 local app>
   ```
2. `supabase stop && supabase start` — the new env vars are read at
   container boot, not on the fly.
3. `pnpm dev` → http://localhost:3000/signup → click "Continue with Google".

## 6. Verification

After saving in the Supabase Dashboard:

1. Open an incognito window → https://www.spanlens.io/signup
2. Click "Continue with Google"
3. Expected DevTools Network sequence:
   - Click → `accounts.google.com/o/oauth2/v2/auth?...` (Google consent screen)
   - After approve → `gebocvcsjlarxhyauadf.supabase.co/auth/v1/callback?code=...`
   - → `www.spanlens.io/auth/callback?code=...`
   - → `www.spanlens.io/dashboard` (which the dashboard layout bounces to `/onboarding`)
4. In Supabase Dashboard → Authentication → Users, the new row should have
   `app_metadata.provider = "google"` (or `"github"`).
5. In the `user_consents` table (Supabase Table Editor), the new user has
   two rows: `terms@<TERMS_VERSION>` and `privacy@<PRIVACY_VERSION>`.

## Troubleshooting

| Symptom | Cause |
|---|---|
| "redirect_uri_mismatch" from Google | Authorized redirect URI in Google Console doesn't exactly match `https://gebocvcsjlarxhyauadf.supabase.co/auth/v1/callback`. URLs are case-sensitive; trailing slash matters. |
| Supabase returns to `/auth/callback?error=server_error` | Most often: Site URL or Redirect URLs allowlist missing the destination. Check step 4. |
| Returns to `/login` immediately after OAuth | Middleware ran before Supabase set the cookie. Hard-refresh once; if persistent, check that `apps/web/middleware.ts` PUBLIC_PATHS includes `/auth/` (it does). |
| No `user_consents` row for new OAuth user | The callback succeeded but `/api/v1/me/consent` POST failed. Check server logs for `[auth/callback] consent recording failed`. Server endpoint requires authJwt — the access token must be valid. |
| Existing email user clicks Google, gets a separate account | Supabase by default does NOT link OAuth identities to existing email accounts unless email confirmation is shared. If we want auto-link later, enable "Same email = same account" or use identity linking API. |
