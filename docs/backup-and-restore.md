# Database backup and restore

Production runs on Supabase. The Free plan has no automated backups, so
`.github/workflows/db-backup.yml` takes a logical backup every day at
19:17 UTC and keeps it as an encrypted GitHub Actions artifact for 30 days.

## One-time setup

1. Generate a passphrase and store it in the password manager first:

   ```bash
   openssl rand -base64 48
   ```

2. Add it as the repository secret `BACKUP_PASSPHRASE`
   (Settings → Secrets and variables → Actions). It must be at least 32
   characters; the workflow refuses to run otherwise.
3. `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` are shared with
   `deploy-server.yml` and are already set.
4. Run the workflow once by hand (Actions → Daily DB backup → Run workflow)
   and confirm it is green before relying on it.

Also keep the server's `ENCRYPTION_KEY` in the password manager. Provider keys
are stored encrypted with it, so a restored database without that key has
unusable provider keys.

## What a backup contains

One file, `spanlens-db-<timestamp>.tar.gz.gpg`, encrypted with AES-256. Inside:

| File | Contents |
|---|---|
| `roles.sql` | cluster roles |
| `schema.sql` | DDL for every non-platform schema |
| `data.sql` | all rows in COPY format, `auth.users` included |

Platform-managed schemas (`storage` migrations, `realtime`, `vault`,
`supabase_migrations`, ...) are left out, matching `supabase db dump`.

The repository is public, so anyone signed in to GitHub can download the
artifact. That is safe only because of the encryption. Do not change the
workflow to upload plaintext or print dump contents to the log.

## Restore

1. Download the artifact from the workflow run and unzip it.
2. Decrypt and unpack:

   ```bash
   gpg --decrypt spanlens-db-<timestamp>.tar.gz.gpg | tar -xzf -
   ```

3. Restore into a target project. Use a **new** Supabase project, or a
   project you are sure can be overwritten. Use the session pooler (port 5432)
   connection string from Connect in the dashboard:

   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql \
     --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql \
     --dbname "$TARGET_DB_URL"
   ```

   `session_replication_role = replica` turns off triggers and foreign-key
   checks while the rows load, so the order of the COPY statements does not
   matter.

4. Point the server at the restored project (`SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_POOLER_URL`)
   and redeploy. Run `/health/deep` to confirm the pool connects.
5. Make sure partitions for the coming months exist before the proxy writes
   to them:

   ```sql
   SELECT public.ensure_requests_partitions(3, 1);
   ```

## Retention

Artifacts expire after 30 days. For a longer-lived copy (before a risky
migration, for example) download the artifact and keep it somewhere private.
