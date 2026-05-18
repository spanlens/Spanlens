# Security Policy

## Supported Versions

Only the latest release of Spanlens receives security updates.

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| older   | :x:                |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

To report a security issue, email **haeseong050321@gmail.com** with:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept (if available)
- Any relevant logs, screenshots, or supporting material

### Response Policy

- **Acknowledgement**: within 48 hours of receiving your report
- **Status update**: within 7 days with an assessment and expected timeline
- **Resolution**: critical and high severity issues are prioritized for the next patch release

We follow responsible disclosure. Please allow us reasonable time to investigate and remediate before any public disclosure. We will credit reporters in the release notes unless you prefer to remain anonymous.

## Scope

The following are in scope:

- `apps/server` — Hono proxy and REST API
- `apps/web` — Next.js dashboard
- `packages/sdk` — JS/TS SDK published to npm

The following are **out of scope**:

- Denial-of-service attacks requiring significant resources
- Social engineering of Spanlens team members
- Vulnerabilities in third-party dependencies (please report these upstream)

## Security Measures

Spanlens implements the following controls:

- Provider API keys encrypted at rest with AES-256-GCM
- API key transport via `Authorization` header only (no query-parameter transport)
- Row-Level Security (RLS) on all Supabase tables
- `organization_id` isolation enforced on every ClickHouse query
- Automated SAST via GitHub CodeQL (weekly schedule + every PR)
- Automated dependency vulnerability scanning via GitHub Dependabot
