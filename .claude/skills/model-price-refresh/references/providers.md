# Provider pricing sources

Per-provider URLs, the extraction technique that actually works, and traps.
Verified 2026-07-29 — if a snippet stops returning rows, the page was
restructured; adapt it rather than guessing at prices.

## Contents

- [How to read a JS-rendered pricing page](#how-to-read-a-js-rendered-pricing-page)
- [OpenAI](#openai) · [Anthropic](#anthropic) · [Gemini](#gemini)
- [Mistral](#mistral) · [Groq](#groq) · [DeepSeek](#deepseek) · [xAI](#xai) · [Cohere](#cohere)
- [Azure](#azure) · [OpenRouter](#openrouter)
- [Cross-provider notes](#cross-provider-notes)

## How to read a JS-rendered pricing page

`WebFetch` works when the page has a text or markdown representation. It fails
on the tabbed, JS-built tables that Gemini and Mistral use — it returns prose
about the tiers and no numbers, or silently drops most models.

For those, open the page in the browser pane (`preview_start` with the URL,
then `navigate`) and extract with `javascript_tool`. Two techniques carry most
of the work:

**Pair every table with the heading above it.** Pricing pages nest tables deep
inside tab containers, so `nextElementSibling` walks from a heading don't
reach them. Walk all headings, `code` elements and tables in document order and
carry the last-seen heading forward:

```js
(()=>{const els=document.querySelectorAll('h2,h3,code,table');
let name='',code='';const out=[];
els.forEach(e=>{
  if(e.tagName==='H2'||e.tagName==='H3'){name=e.innerText.trim();code=''}
  else if(e.tagName==='CODE'){if(!code)code=e.innerText.trim()}
  else{const rows=Array.from(e.querySelectorAll('tr'))
        .map(r=>r.innerText.replace(/\s+/g,' ').trim());
       out.push(`${name} [${code}]\n  ${rows.join('\n  ')}`)}});
return out.join('\n\n')})()
```

The `code` element usually holds the real API model id, which is what you need —
the heading is marketing copy ("Nano Banana Pro" is `gemini-3-pro-image`).

**Pull one field across all tables.** Once you know the layout, grab just the
row you care about instead of dumping everything:

```js
(()=>{const t=document.querySelectorAll('table');
return [0,9,23].map(i=>'#'+i+': '+
  t[i].innerText.replace(/\s*\n\s*/g,' | ').slice(0,400)).join('\n\n')})()
```

Careful: tab groups repeat the same model across Standard / Batch / Flex /
Priority tables. Only **Standard** goes in `model_prices` — `lib/cost.ts`
derives the other tiers with `TIER_MULTIPLIERS`.

A page served in the user's locale may be a stale translation. Append `?hl=en`
on Google properties; the English page has been a full generation ahead.

---

## OpenAI

- <https://developers.openai.com/api/docs/pricing>
- Markdown works: append `.md` to the URL and `WebFetch` it. Easiest provider.

The flagship table shows only the newest family; the "All models" table has the
long tail. The `.md` version contains both, which is why it's preferred.

Traps:
- Response bodies return **dated** ids (`gpt-4o-mini-2024-07-18`) and that's
  what lands in `requests.model`. Seed the base id and let the boundary-aware
  prefix match in `lookupPrice()` handle the variants.
- Long-context threshold is 272k, in a tooltip on the "Long context" header
  rather than the table.
- GPT-5.6 introduced OpenAI's first published **cache write** rate (1.25x
  input). Earlier families have cached-input only.
- Image/realtime/transcription models are priced per modality — out of scope.

## Anthropic

- <https://platform.claude.com/en/docs/about-claude/pricing> — the rate table
- <https://platform.claude.com/en/docs/about-claude/models/overview> — API ids
- Both work with `WebFetch` or the browser.

You need both pages: pricing lists models by display name ("Claude Opus 5"),
and the overview maps them to API ids (`claude-opus-5`). Guessing the id from
the display name breaks on the dashed-vs-dotted convention.

Traps:
- From the 4.6 generation on, ids are dateless but still pinned snapshots. Both
  the alias and any dated form need rows.
- Cache columns are derivable: `cache_read = 0.1x input`,
  `cache_write (5min) = 1.25x input`. The 1-hour cache write is a different
  multiplier we don't model.
- Introductory pricing is a real, dated thing — Sonnet 5 launched at $2/$10
  through 2026-08-31. Record the expiry, it won't announce itself.
- Invitation-only models (Mythos) still get rows; a customer with access will
  otherwise log NULL.

## Gemini

- <https://ai.google.dev/gemini-api/docs/pricing?hl=en>
- Browser + the heading-pairing snippet. `WebFetch` returns the tier prose only.

`?hl=en` is not optional. The localized page has been served from a stale cache
missing an entire model generation.

Traps:
- Every current model publishes a **context caching** rate that is easy to miss
  because it sits in a third table row. Leaving it NULL over-charges every
  cache hit. Take the text/image/video number; audio caches higher and isn't
  modelled.
- The `$1.00 / 1M tokens per hour` storage fee on the same row is a separate
  charge Google bills directly — not `cache_read`.
- Pro-family and Computer Use split at 200k tokens; the >200k rate goes in the
  `long_*` columns.
- The models page lists retired models under a "legacy" heading — worth reading
  to catch things that quietly went away.
- Image models (`*-image`, "Nano Banana") price output per image. Out of scope.

## Mistral

- <https://mistral.ai/pricing/api>
- Browser. The plain `/pricing` page has no table; `WebFetch` on `/pricing/api`
  returns a partial list.

Model cards render as a grid; this pulls id + prices:

```js
(()=>{const t=document.body.innerText;const i=t.indexOf('results');
const seg=t.slice(i,i+14000);const out=[];
const re=/\$([\d.]+)\s*\n+\s*Output \(\/M tokens\)\s*\n+\s*\$([\d.]+)\s*\n+\s*([a-z0-9\-.]+)/g;
let m;while((m=re.exec(seg)))out.push(m[3]+' = '+m[1]+'/'+m[2]);
return out.join('\n')})()
```

Traps:
- `*-latest` ids are **moving pointers**. `mistral-large-latest` went from
  $2/$6 to $0.50/$1.50 when Large 3 shipped, and `mistral-small-latest` rose
  from $0.10/$0.30 to $0.15/$0.60 with Small 4. Re-verify these every run even
  when no new model appeared — this is the provider most likely to have moved
  under you.
- Open-weight ids carry an `open-` prefix (`open-mixtral-8x22b`). We shipped a
  bare `mixtral-8x22b` row once that never matched a single request.

## Groq

- <https://groq.com/pricing>
- `WebFetch` works.

Traps:
- Catalogue turns over fast; models disappear without deprecation notices.
- Ids are namespaced (`openai/gpt-oss-120b`, `qwen/qwen3.6-27b`), which is
  exactly where collisions with OpenRouter come from. Run the collision query.
- Cached-input rates are published for some models only.

## DeepSeek

- <https://api-docs.deepseek.com/quick_start/pricing>
- `WebFetch` works.

Traps:
- `deepseek-chat` / `deepseek-reasoner` are compatibility aliases that resolve
  to the current v4 model. Keep rows for all of them.
- `cache_read` here is the published cache-**hit** input rate and is dramatically
  lower than input (~2% of it), so leaving it NULL is a large over-charge.

## xAI

- <https://docs.x.ai/docs/models>
- `WebFetch` works.

Traps:
- Every Grok model has a cached-input rate **and** a 200k tier. The tier
  semantics are unusual: reaching the threshold re-rates *all* tokens in the
  request at 2x, not just the overage. That happens to match how
  `long_context_threshold_tokens` is applied, so it maps cleanly — but it means
  a 250k-token request costs double throughout.
- Ids are versioned oddly (`grok-4.20-0309-reasoning`). Copy them exactly.

## Cohere

- <https://cohere.com/pricing> — partial, JS-heavy
- <https://docs.cohere.com/docs/models> — the reliable id list

Traps:
- The flagship `command-a-plus-*` and specialized `command-a-{reasoning,
  vision,translate}-*` models have **no public per-token price**. Deliberately
  unseeded; they log NULL. If sales-quoted pricing becomes available, that's
  the moment to add them.
- The public page mixes in legacy models that are no longer served.

## Azure

No pricing page to check and **no rows in `model_prices`**. Azure OpenAI serves
OpenAI models at OpenAI list prices, so `lib/cost.ts` rewrites `azure → openai`
via `PRICE_TABLE_PROVIDER`. Nothing to do here during a refresh — just don't
"fix" the missing rows by adding them.

## OpenRouter

- <https://openrouter.ai/models> (API: `https://openrouter.ai/api/v1/models`)

A meta-provider with 100+ rows that churn weekly. Deliberately **not** mirrored
into the seed file or `FALLBACK_PRICES`.

Traps:
- Rows are stored **with** the vendor prefix (`anthropic/claude-opus-4.7`), and
  the proxy looks up the full id. Don't strip it.
- OpenRouter uses dotted versions where our Anthropic rows use dashes
  (`claude-opus-4.7` vs `claude-opus-4-7`). They are not interchangeable.
- The proxy prefers the `usage.cost` OpenRouter reports, so our table is only a
  fallback. Bulk-refreshing it is low value; fix specific misses instead.

---

## Cross-provider notes

**Tiers.** Only Standard rates belong in the table. Batch/Flex/Priority are
derived in `lib/cost.ts` via `TIER_MULTIPLIERS` (0.5x / 0.5x / 1.8x).

**Embeddings** are input-only: set `completion_price_per_1m = 0`, not NULL.

**Multimodal input** (image/audio/video tokens priced above text) isn't
modelled — one `prompt_price_per_1m` per row. Seed the text rate and note it.

**Deprecated models** keep their rows so historical requests still price
correctly. Deleting a row silently re-prices the past.

**New provider?** Adding one is more than a price row — see the provider
addition checklist in the project docs for the full layer list.
