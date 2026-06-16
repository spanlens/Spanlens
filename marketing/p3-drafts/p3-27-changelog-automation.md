# P3-27: Changelog → Social automation

## Goal
Every changelog entry on `/changelog` (or GitHub release) automatically posts to Twitter/X and LinkedIn. Drives backlinks + fresh signal for SEO + brand reach.

## Why not just manual?
Manual posting drifts. We've seen 6-week gaps. Automation makes it boring and reliable.

## Three approaches

### Approach A: GitHub Actions + manual review (recommended)

GitHub Action triggers on new release tag, drafts the post, opens a PR for human review, then posts when merged. Catches typos before they go public.

**Workflow file**: `.github/workflows/changelog-to-social.yml`

```yaml
name: Changelog to Social Draft
on:
  release:
    types: [published]

jobs:
  draft:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Draft social posts
        env:
          RELEASE_BODY: ${{ github.event.release.body }}
          RELEASE_TAG: ${{ github.event.release.tag_name }}
        run: |
          node scripts/draft-social-from-release.js \
            --body "$RELEASE_BODY" \
            --tag "$RELEASE_TAG" \
            --out social-drafts/${{ github.event.release.tag_name }}.md
      - name: Open PR with drafts
        uses: peter-evans/create-pull-request@v6
        with:
          commit-message: "chore: social drafts for ${{ github.event.release.tag_name }}"
          title: "Social drafts: ${{ github.event.release.tag_name }}"
          body: "Review and edit drafts in social-drafts/. Approve PR to publish."
          branch: social-drafts-${{ github.event.release.tag_name }}
```

Then a separate `publish-social.yml` triggered when the PR is merged:
- Reads `social-drafts/<tag>.md`
- POSTs to Twitter/X API (`POST /2/tweets`)
- POSTs to LinkedIn API (`POST /v2/ugcPosts`)

### Approach B: Buffer / Hypefury MCP

Use a third-party scheduler. Cheaper to maintain (no API key management), but adds a vendor.

### Approach C: Zapier "GitHub Release → Twitter + LinkedIn"

Zero code. Trigger on GitHub release, Zap composes the post from a template, publishes. Limit: ~3000 chars total per post (LinkedIn limit), and Zapier's template engine isn't powerful enough for nuanced posts.

## Recommended: Approach A

Reasons:
- Source-controlled (drafts in git)
- Human-in-loop for tone/copy quality
- Tied to existing release process (no extra dashboard)
- Free if you already have GitHub Actions minutes budget

## Required secrets

Add to GitHub repo secrets:
- `TWITTER_BEARER_TOKEN` (for X API v2)
- `TWITTER_USER_ID` (numeric ID of @spanlens_io)
- `LINKEDIN_ACCESS_TOKEN`
- `LINKEDIN_ORGANIZATION_URN` (`urn:li:organization:xxx`)

## Draft template (per post platform)

**Twitter** (max 280 chars, can be a thread of 2-3):
```
🚀 Spanlens {{TAG}} ships

{{ONE_LINE_HEADLINE}}

{{ONE_BULLET}}
{{ONE_BULLET}}
{{ONE_BULLET}}

Full changelog → {{CHANGELOG_URL}}
```

**LinkedIn** (longer-form, ~1300 chars works):
```
Spanlens {{TAG}} ships today.

{{TWO_SENTENCE_INTRO}}

What's new:
• {{BULLET}}
• {{BULLET}}
• {{BULLET}}

Why this matters for LLM observability teams: {{ONE_PARAGRAPH}}

Read the full changelog: {{CHANGELOG_URL}}
Open source under MIT: https://github.com/spanlens/Spanlens

#LLM #Observability #OpenSource
```

## Estimated effort
- Workflow + scripts: 4-6 hours
- API keys / dev portal setup: 2 hours
- First few iterations of draft quality tuning: 2-3 release cycles to dial in
- **Total ~10 hours upfront + 5 min review per release**

## Out of scope for this draft
- Cross-posting to Mastodon / Bluesky / Threads (same pattern, additional API keys)
- Auto-generating images from release notes (could add via banana MCP later)
