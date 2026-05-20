# Integrations Expansion — Azure OpenAI + Ollama

**작성일**: 2026-05-20
**범위**: Phase A (Azure OpenAI), Phase B (Ollama)
**LangGraph/CrewAI**: 별도 plan 문서로 분리 (SDK 작업 위주, 다른 사이클)

---

## 0. TL;DR

| 항목 | Azure OpenAI | Ollama |
|---|---|---|
| 변경 위치 | `apps/server/src/proxy/` + DB | **SDK 문서 + (선택) 모델 가격 시드** |
| 신규 proxy 필요 | ✅ `/proxy/azure/*` | ❌ (customer 로컬 → Spanlens SaaS 도달 불가) |
| DB 마이그레이션 | ✅ `provider` enum + metadata 컬럼 | (선택) virtual provider row |
| 인증 헤더 변경 | `api-key: <key>` (NOT Bearer) | n/a |
| 스트리밍 파서 | OpenAI parser 재사용 가능 | n/a |
| 비용 계산 | OpenAI 가격표 + deployment→model 매핑 | self-hosted → 항상 null/0 |
| 예상 PR 수 | 2 (DB 마이그레이션 1 + 코드 1) | 1 (docs + SDK 검증) |
| 예상 작업량 | ~5일 | ~1일 |

핵심 결정 사항:
1. **Azure는 v1 endpoint 채택** (`/openai/v1/...`) — Microsoft가 2025-08 GA로 출시한 OpenAI 호환 경로. `api-version` 쿼리 파라미터 없이 OpenAI SDK 그대로 동작. 레거시 `/openai/deployments/{name}/...` 경로는 지원하지 않음 (단순화).
2. **Ollama는 proxy 안 만듦.** SDK가 이미 `baseURL` override 지원하므로 customer가 `observeOpenAI({ baseURL: 'http://localhost:11434/v1' })`로 로컬 Ollama 호출을 우리 SDK로 감싸면 trace/span만 SaaS로 전송. proxy 경로는 net 도달 불가 (Vercel → customer localhost) — 시도하면 헛수고.

---

## 1. Azure OpenAI 구현 — 상세

### 1.1 Azure v1 API 사실 정리 (Microsoft 공식 문서 기반)

**Endpoint 형태** (둘 다 허용 — `services.ai.azure.com`은 Foundry 통합 도메인):
```
https://{resource}.openai.azure.com/openai/v1/chat/completions
https://{resource}.services.ai.azure.com/openai/v1/chat/completions
```

**인증** — 두 가지 방식, 키 인증이 우리 사용 사례:
- `api-key: <key>` 헤더 (우리가 쓸 방식)
- `Authorization: Bearer <token>` (Microsoft Entra ID, AAD 토큰)

**스트리밍** — SSE, OpenAI와 거의 동일:
```
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","created":...,
       "model":"gpt-4o","choices":[{"index":0,"delta":{...}}],
       "system_fingerprint":"fp_...","prompt_filter_results":[...]}
data: [DONE]
```
차이점: `prompt_filter_results`, `content_filter_results` (Azure content filter 응답), `system_fingerprint` 필드 추가 — **OpenAI parser가 알 수 없는 필드를 무시하므로 그대로 통과**.

**비스트리밍 응답 shape** — OpenAI와 거의 동일:
```json
{
  "id": "chatcmpl-...",
  "model": "gpt-4o",              // ← v1에서는 actual model name (이전 deployment name 아님)
  "object": "chat.completion",
  "choices": [...],
  "usage": { "prompt_tokens": 33, "completion_tokens": 557, "total_tokens": 590 },
  "prompt_filter_results": [...]  // Azure 전용 — 무시
}
```
**검증 필요** (1.5 참고): v1 endpoint에서 `model` 필드가 실제 모델명을 돌려주는지 vs 여전히 deployment 이름인지. 로컬 테스트로 확인 후 cost.ts 매핑 전략 결정.

### 1.2 데이터 모델 변경

**마이그레이션 1**: `supabase/migrations/YYYYMMDDHHMMSS_provider_keys_azure.sql`

```sql
-- (a) provider enum 확장
ALTER TABLE provider_keys
  DROP CONSTRAINT provider_keys_provider_check;
ALTER TABLE provider_keys
  ADD CONSTRAINT provider_keys_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'gemini', 'azure'));

-- (b) Azure resource endpoint 저장용 metadata 컬럼
ALTER TABLE provider_keys
  ADD COLUMN IF NOT EXISTS provider_metadata jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN provider_keys.provider_metadata IS
  'Provider-specific metadata. For azure: { "resource_url": "https://x.openai.azure.com" }. ' ||
  'For openai/anthropic/gemini: {} (unused).';
```

**왜 metadata jsonb인가?** typed 컬럼 추가하면 (`azure_resource_url text`) 다른 provider 추가할 때마다 컬럼 늘어남. jsonb 하나로 향후 AWS Bedrock의 region, GCP Vertex의 project_id 등도 흡수 가능.

**마이그레이션 후**: `supabase gen types --lang typescript --local > supabase/types.ts` 필수 (CLAUDE.md 규칙).

**ClickHouse `requests` 테이블 변경 불필요**: `provider` 컬럼은 String이고 이미 임의 값 허용. `model` 컬럼에 Azure deployment name 또는 model name이 저장됨.

### 1.3 proxy 라우팅

**파일**: `apps/server/src/proxy/azure.ts` (신규)

OpenAI proxy와 99% 동일하므로 **공통 부분 추출 리팩토링은 하지 않음** — 두 파일 차이가 적어 추출 비용 > 이득. 차이만 표로:

| 항목 | openai.ts | azure.ts (신규) |
|---|---|---|
| Path prefix | `/proxy/openai` | `/proxy/azure` |
| `getDecryptedProviderKey(apiKeyId, ?)` | `'openai'` | `'azure'` |
| `OPENAI_BASE` | `https://api.openai.com` | dynamic, `providerKey.provider_metadata.resource_url + '/openai/v1'` |
| Upstream auth header | `Authorization: Bearer <key>` | `api-key: <key>` |
| `logBase.provider` | `'openai'` | `'azure'` |
| `calculateCost(provider, ...)` | `'openai'` | `'openai'` (가격표 공유 — 1.4 참고) |

**`getDecryptedProviderKey` 시그니처 확장 필요**: 현재 `{plaintext, id}`만 반환. Azure는 resource_url도 필요. 변경:
```ts
export interface ResolvedProviderKey {
  plaintext: string
  id: string
  metadata: Record<string, unknown>  // 추가
}
```
`utils.ts` select에 `provider_metadata` 추가 + 두 호출자(openai/anthropic/gemini는 metadata 무시).

**path 처리**:
```ts
const path = c.req.path.replace(/^\/proxy\/azure/, '')
// e.g. customer가 "/proxy/azure/chat/completions" 호출
// upstreamUrl = "https://myresource.openai.azure.com/openai/v1/chat/completions"
const baseUrl = providerKey.metadata.resource_url as string
const upstreamUrl = `${baseUrl}/openai/v1${path}`
```

**`app.ts`에 route 등록**:
```ts
app.route('/proxy/azure', azureProxy)
```

### 1.4 비용 계산 전략

Azure는 OpenAI와 **사실상 동일한 모델·가격**을 노출 (Microsoft Foundry 추가 모델 제외). 두 가지 선택:

**옵션 A (권장)**: OpenAI 가격표 재사용. `calculateCost('openai', resolvedModel, ...)` 호출. `resolvedModel`은 응답 body의 `model` 필드. v1 endpoint가 실제 모델명을 돌려준다는 가정 하 (1.5에서 검증).

**옵션 B**: 별도 azure 가격 시드. Foundry 전용 모델(DeepSeek, Grok via Azure)이 향후 늘어나면 필요해질 수 있음. 지금은 over-engineering.

**결정**: 옵션 A로 시작. `lib/cost.ts` 변경 없음. 만약 v1이 deployment name을 돌려주면 → 옵션 A1로 폴백: customer가 provider key 등록 시 deployment → model 매핑을 metadata에 같이 저장 (`{ resource_url, deployments: { "my-gpt4o": "gpt-4o" } }`). 이 경우 azure.ts에서 매핑 lookup 후 `calculateCost`에 model name 전달.

### 1.5 검증 단계 (PR 직전 필수)

로컬 또는 dev tier Azure subscription으로:
1. v1 endpoint 응답의 `model` 필드 값 확인 (deployment name vs model name)
2. 스트리밍에서 마지막 `usage` chunk가 OpenAI와 동일하게 오는지 (`stream_options: {include_usage: true}` 자동 injection이 동작하는지)
3. `prompt_filter_results` / `system_fingerprint` 같은 Azure 전용 필드가 OpenAI parser를 깨뜨리지 않는지

검증 결과에 따라 1.4의 옵션 A vs A1 확정.

### 1.6 UI 변경

`apps/web/app/settings/api-keys/` 등의 provider key 등록 UI:
- provider 드롭다운에 `Azure OpenAI` 추가
- provider가 `azure`일 때만 `Azure resource URL` 입력 필드 노출 (예: `https://my-resource.openai.azure.com`)
- form 제출 시 `provider_metadata: { resource_url: "..." }` 함께 전송

기존 코드 위치 그렙해서 PR에서 정확히 잡을 것:
```
apps/web/app/settings/api-keys/**/*.tsx
apps/web/app/settings/provider-keys/**/*.tsx
```

### 1.7 코드 reviewer 체크리스트

- [ ] `provider_keys` UNIQUE INDEX `(api_key_id, provider) WHERE is_active` 는 `azure` 추가해도 작동 (provider별 1개 active만 허용)
- [ ] `requestsScope` / billing 쿼리에서 `provider = 'azure'` 행이 OpenAI와 동등하게 집계되는지 확인
- [ ] CORS — 변경 없음 (server 도메인은 동일, browser→spanlens 호출이지 spanlens→azure이 아님)
- [ ] `STRIP_PREFIXES`에 `api-key` 추가하지 말 것 — 우리 헤더가 아니라 upstream(Azure)에 전달할 헤더
- [ ] 비스트리밍 응답에서 `prompt_filter_results` 같은 Azure 필드가 customer에 그대로 전달되는지 (passthrough 의도 — content filter 결과를 customer가 보고 싶을 수 있음)

---

## 2. Ollama 구현 — 상세

### 2.1 핵심 사실

Ollama는 **customer 로컬 머신**(`localhost:11434`)에서 동작. Spanlens SaaS proxy는 Vercel/공인 IP에서 도는 서버라 customer의 localhost에 도달 불가. 따라서 *proxy 라우트를 만들어도 의미 없음*.

대신 Ollama가 OpenAI 호환 endpoint(`/v1/chat/completions`)를 제공하므로:
- 응답이 OpenAI 형식과 동일 (usage, choices, model 필드)
- SDK가 이걸 wrap해서 trace/span만 Spanlens로 보내면 됨
- Ollama가 stream_options.include_usage를 지원해서 streaming token count도 잡힘

Ollama 공식 문서가 `api_key='ollama'` (any placeholder)를 명시 — 로컬은 인증 없음. Ollama Cloud는 Bearer token 필요 (별도 케이스).

### 2.2 구현 작업 — 최소

**A. SDK 검증** (코드 변경 거의 없음 기대):

```ts
// packages/sdk/src/openai.ts 의 observeOpenAI 가 이미
// custom baseURL 받는지 확인
import OpenAI from 'openai'
import { observeOpenAI } from '@spanlens/sdk'

const ollama = observeOpenAI(new OpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama',  // ignored locally
}), { /* spanlens 옵션 */ })

await ollama.chat.completions.create({
  model: 'llama3.2',
  messages: [...],
})
```

SDK가 응답을 가로채서 `usage` / `model` 추출 → ingest API로 trace/span 전송. **확인 필요**: 현재 SDK가 baseURL 무관하게 응답 body의 `usage` 필드를 읽는지 (OpenAI 가정 하드코딩 안 되어 있어야 함).

**B. ingest 측 변경**: 없을 가능성 큼. Ollama trace도 결국 `provider: 'openai'`로 ingest되는데, 이건 정직하지 않음. 옵션:
- B1: SDK가 `baseURL` 패턴 보고 `provider: 'ollama'` 자동 표시 (휴리스틱 — 11434 포트 또는 호스트 매치)
- B2: `observeOpenAI({ provider: 'ollama' })` 명시 옵션 제공
- B3: 그냥 `provider: 'openai'` 두고 model name(llama3.2 등)으로 구분

**결정**: B2 (명시 옵션). B1은 휴리스틱이라 깨지기 쉬움, B3는 대시보드 UX 나쁨. 작업: SDK `observeOpenAI` signature에 `provider?: string` 추가 → ingest payload에 그대로 전달.

**C. 비용 계산**: Ollama는 self-hosted → cost=0. `lib/cost.ts`에서 `calculateCost('ollama', ...)` 호출 시 항상 0 또는 null 반환하도록 한 줄 추가. 또는 `requests.cost_usd = null` 로 두고 대시보드에서 "Self-hosted" 배지 표시.

**결정**: cost null + 대시보드 표시. 0이면 차트에서 "비용 절약"으로 오인 가능.

**D. 모델 가격 시드 추가**: 불필요. cost null이면 어차피 lookup 안 함.

**E. 문서**: `apps/web/app/docs/sdk/page.tsx` 또는 해당 mdx에 Ollama 섹션 추가. 위 코드 예제 + "self-hosted이므로 비용은 표시되지 않습니다" 설명.

### 2.3 옵션: Ollama Cloud 지원

Ollama Cloud(ollama.com 호스티드 추론)는 Bearer auth + 공개 endpoint라서 **proxy 만들 수 있음**. 하지만 사용자 수가 매우 적고 (Ollama는 self-hosted가 95% 사용 사례) 우선순위 낮음. 별도 phase로 분리하거나 사용자 요청 들어올 때 추가.

### 2.4 검증

로컬에 Ollama 설치 (`brew install ollama` / `ollama pull llama3.2`) 후:
1. SDK로 `observeOpenAI({ baseURL: 'localhost:11434/v1', provider: 'ollama' })` 호출
2. Spanlens 대시보드 `/requests`에 행 들어오는지 확인
3. usage(prompt/completion tokens) 정상 표시
4. cost 컬럼 null + UI에서 "Self-hosted" 표시
5. 스트리밍 trace 정상 (마지막 chunk usage)

---

## 3. PR 분할 계획

| PR | 범위 | 파일 |
|---|---|---|
| PR-A1 | DB 마이그레이션 + types 재생성 | `supabase/migrations/*_provider_keys_azure.sql`, `supabase/types.ts` |
| PR-A2 | Azure proxy + provider key API + UI | `apps/server/src/proxy/azure.ts`, `apps/server/src/proxy/utils.ts`, `apps/server/src/api/providerKeys.ts`, `apps/web/app/settings/**/*.tsx`, `apps/server/src/app.ts`, `apps/server/src/proxy/*.test.ts` |
| PR-B1 | SDK provider override + Ollama docs | `packages/sdk/src/**`, `apps/web/app/docs/sdk/*` |
| PR-B2 (선택) | cost.ts ollama=null + 대시보드 self-hosted 배지 | `apps/server/src/lib/cost.ts`, `apps/web/components/requests/*.tsx` |

**PR-A1 먼저 머지 + production 적용** → 그 다음 PR-A2 (CLAUDE.md gotcha #21 의 마이그레이션-deploy 순서). PR-B는 PR-A와 독립.

---

## 4. 위험 / 미확인

| 위험 | 완화 |
|---|---|
| Azure v1 endpoint의 `model` 응답 필드가 deployment name이면 cost.ts 매핑 못 함 | 1.5 검증 단계에서 먼저 확인. deployment name이면 1.4 옵션 A1로 fallback |
| Azure content filter가 200 응답 안에서 `choices[0].finish_reason: "content_filter"`로 막힘 — 비용은 차지 vs 응답 없음 | OpenAI parser는 이미 finish_reason 무관하게 usage 읽음. 추가 작업 불필요. 단 대시보드에서 finish_reason 시각화 검토 (별도 issue) |
| Customer가 Azure resource URL을 `https://x.openai.azure.com/` (trailing slash) 또는 `x.openai.azure.com` (no scheme) 같이 입력 | provider key 등록 시 정규화: `new URL(input).origin`, 검증 실패 시 400 반환 |
| `provider_metadata jsonb` 추가가 기존 RLS 정책에 영향 줄 수 있음 | `provider_keys`는 service_role로만 접근 (CLAUDE.md). RLS bypass라 무영향. UI는 항상 `/api/v1/provider-keys` 경유 |
| Ollama SDK 변경(`provider?` 옵션) 추가 → SDK 메이저 버전 bump 필요한가 | 옵션 추가는 minor (`0.4.0 → 0.5.0`). TS SDK 0.4.0 → 0.5.0, Python SDK 0.3.0 → 0.4.0 |

---

## 5. 미정 결정 (사용자 확인 필요)

1. **Azure provider key UI 입력 form** — resource URL을 단일 텍스트로 받을지 (`https://x.openai.azure.com`) vs resource name만 받고 도메인 자동 결합할지 (`x` → `https://x.openai.azure.com`). 후자가 UX 단순하지만 `services.ai.azure.com` 같은 alternate domain 못 씀.
2. **Phase A 안에서 비스트리밍/스트리밍 둘 다 한 번에 vs 비스트리밍 먼저** — 한 번에 가는 게 자연스러움 (OpenAI 코드 그대로 복붙).
3. **Phase B의 SDK 변경을 TS만 먼저 vs TS+Python 동시** — Ollama 사용자는 Python이 더 많을 가능성. 동시 진행 권장.
4. **Phase C, D (LangGraph, CrewAI)** 는 이 plan 외부에서 별도 진행 — 동의?
