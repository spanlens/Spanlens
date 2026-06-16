# P3-23: Customer interview script

**Purpose**: 5 case studies + 5 logo permissions for /pricing trust signal + /case-studies section.
**Target**: existing Pro and Team customers, plus active Free-tier users with visible LLM workloads.
**Format**: 30-min Zoom or async email Q&A.

## Outreach email template

Subject: `Quick Spanlens question (30 min — or email if easier)`

```
Hi {first_name},

We're putting together a few short case studies on how teams use Spanlens
in production and would love to feature your team if you're up for it.

Two asks:
1) A 30-min call (or async email) about your LLM workload and what
   Spanlens caught for you
2) Permission to show your logo on the Spanlens pricing page

Whatever level of detail you're comfortable with — we'll send you the
draft before anything goes public and you can edit or kill it. No
pressure.

Are you in?

— Haeseong
```

## Interview script (30 min)

**Setup (2 min)**: thanks for time, recap purpose (case study + logo permission), confirm recording permission.

**Section 1: context (5 min)**
- What's your team's LLM use case in one sentence?
- How many LLM calls per day, roughly?
- Which providers do you use?
- Were you on another observability tool before Spanlens? What made you switch?

**Section 2: pain → fix (10 min)** — the heart of the case study
- What was the most surprising or expensive issue Spanlens caught for you?
  - Ask for specifics: cost spike, prompt regression, anomaly, security finding
  - Get a dollar figure or percent if they're willing
- What was the fix? How long did it take to identify vs. fix?
- Has anything changed in how your team works since adopting Spanlens?

**Section 3: features used (5 min)**
- Which features do you check the dashboard for most?
- Anything you wish existed?
- Have you used the model savings recommender? What did it suggest?

**Section 4: permission and quotes (5 min)**
- "Can I quote you in the case study?" — get explicit verbal yes
- "Can we display your company logo on the pricing page?" — explicit verbal yes
- Best two quotes from the conversation, confirmed by them
- Title + name + headshot URL (LinkedIn is usually fine)

**Section 5: ask for referral (3 min)**
- "Know anyone else running LLMs in prod who'd benefit from this conversation?"
- Open-ended — don't push.

## Case study template

```markdown
# Case Study: {company_name}

## The team
{1 sentence: who they are, what their product does}

## The challenge
{1-2 sentences: the specific LLM problem they couldn't see before}

## What Spanlens caught
{the surprising / expensive issue — dollar figure or percent if possible}

## The fix
{what changed, how long it took, what's different now}

## Quote
> "{best quote from the interview}"
> — {Name}, {Title}, {Company}

## Numbers (if shared)
- LLM calls per month: {N}
- Providers: {list}
- Cost reduction since adopting: {%}
- Time-to-detect for cost anomalies: {before} → {after}
```

## Logo permission tracking sheet

Maintain in Notion or `marketing/customer-logos.csv`:

| Company | Contact | Logo URL | Permission date | Place displayed | Notes |
|---|---|---|---|---|---|
| ... | ... | ... | ... | /pricing, /, /case-studies | ... |

Don't display until written permission (email is fine, screenshot the reply).
