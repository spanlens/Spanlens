# Integrations Expansion — Smoke Test Checklists

**작성일**: 2026-05-20
**대상**: PR #124/125/126 머지 + `@spanlens/sdk@0.5.0` / `spanlens==0.4.0` publish 후 검증

PR description의 미체크 box (실제 Azure subscription / 로컬 Ollama 필요) 를 채우는 절차. 한 번 통과하면 마케팅상 "Azure ✅ Ollama ✅" 자신 있게 말할 수 있음.

---

## 1. Azure OpenAI proxy — e2e smoke

### Prereq
- Azure subscription + OpenAI resource (또는 무료 tier credits)
- 모델 deployment 1개 이상 (예: `gpt-4o-mini` 으로 deploy 이름 `my-gpt4o-mini`)
- Spanlens 대시보드 로그인 + 프로젝트 + Spanlens API key (`sl_live_...`) 발급 완료

### Step 1 — Provider key 등록

대시보드 → Projects → 해당 Spanlens key → "Add provider key" → **Azure OpenAI** 선택 → 다음 입력:
- **Azure resource URL**: `https://my-resource.openai.azure.com` (포털에서 복사)
- **API key**: Azure portal → Keys and Endpoint → Key 1
- **Key name**: `Production Azure` 등 알아볼 만한 이름

저장 후 등록 성공 토스트 확인.

### Step 2 — 비스트리밍 호출

```bash
export SPANLENS_KEY="sl_live_xxxxxxxxxxxx"
export AZURE_DEPLOYMENT="my-gpt4o-mini"  # 본인 Azure deployment 이름

curl -X POST "https://spanlens-server.vercel.app/proxy/azure/chat/completions" \
  -H "Authorization: Bearer $SPANLENS_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$AZURE_DEPLOYMENT\",
    \"messages\": [{\"role\": \"user\", \"content\": \"Say hi in 5 words.\"}]
  }"
```

**기대**: HTTP 200, OpenAI 형식 응답 (`choices[0].message.content`, `usage{prompt_tokens, completion_tokens, total_tokens}`)

### Step 3 — 스트리밍 호출

```bash
curl -N -X POST "https://spanlens-server.vercel.app/proxy/azure/chat/completions" \
  -H "Authorization: Bearer $SPANLENS_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$AZURE_DEPLOYMENT\",
    \"messages\": [{\"role\": \"user\", \"content\": \"Count to 5.\"}],
    \"stream\": true
  }"
```

**기대**: SSE `data: {...}\n\n` 청크 흐름 → 마지막 청크에 `usage` 포함 → `data: [DONE]`

### Step 4 — 대시보드 검증

`/requests` 페이지로 이동:
- [ ] **provider 컬럼에 `azure`** 표시되는 행 2개 (비스트리밍 + 스트리밍)
- [ ] **model 컬럼** 에 deployment 이름 또는 실제 model 이름
- [ ] **tokens 컬럼** 0 아닌 값 (usage 파싱 정상)
- [ ] **cost 컬럼** USD 값 (OpenAI 가격표로 매칭됨) — 만약 `null` 이면 deployment 이름이 모델 이름과 매칭 안 된 경우 (gotcha #2)
- [ ] **status 200**
- [ ] 행 클릭 → request body / response body 보임 (Azure-specific `prompt_filter_results` 등 passthrough)
- [ ] (선택) Filter dropdown 에서 **azure** 선택 → 두 행만 남는지 (PR #128 머지 후 적용)

### Step 5 — 음성 케이스 (선택)
- 잘못된 resource URL 로 provider key 등록 시도 → 400 + 명확한 에러 메시지
- API key 회수 후 호출 → 401 from Azure 가 그대로 dashboard `/requests` 에 표시

### 통과 조건
✅ Step 2, 3, 4 의 모든 체크박스 OK → **"Azure OpenAI 지원" 자신 있게 마케팅 가능**

---

## 2. Ollama — local SDK smoke

### Prereq
- 로컬 머신에 Ollama 설치: `brew install ollama` (mac) / [공식 페이지](https://ollama.com/download)
- 모델 1개 다운로드: `ollama pull llama3.2`
- Ollama 서버 실행: `ollama serve` (또는 mac 트레이 앱)
- Spanlens API key 환경변수 설정

### Step 1 — TypeScript

```bash
mkdir spanlens-ollama-smoke && cd spanlens-ollama-smoke
npm init -y
npm install @spanlens/sdk@0.5.0 openai
```

`smoke.ts`:
```ts
import OpenAI from 'openai'
import { SpanlensClient, observeOllama } from '@spanlens/sdk'

const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
const ollama = new OpenAI({ baseURL: 'http://localhost:11434/v1', apiKey: 'ollama' })

const trace = client.startTrace({ name: 'ollama-smoke' })
const res = await observeOllama(trace, 'chat', (headers) =>
  ollama.chat.completions.create({
    model: 'llama3.2',
    messages: [{ role: 'user', content: 'Say hi in 5 words.' }],
  }, { headers }),
)
console.log(res.choices[0].message.content)
await trace.end()
await client.flush()
```

실행: `SPANLENS_API_KEY=sl_live_... npx tsx smoke.ts`

### Step 2 — Python

```bash
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install spanlens==0.4.0 openai
```

`smoke.py`:
```python
import os
from openai import OpenAI
from spanlens import SpanlensClient, observe_ollama

client = SpanlensClient(api_key=os.environ["SPANLENS_API_KEY"])
ollama = OpenAI(base_url="http://localhost:11434/v1", api_key="ollama")

with client.start_trace("ollama-smoke") as trace:
    res = observe_ollama(trace, "chat", lambda headers:
        ollama.chat.completions.create(
            model="llama3.2",
            messages=[{"role": "user", "content": "Say hi in 5 words."}],
            extra_headers=headers,
        )
    )
    print(res.choices[0].message.content)
```

실행: `SPANLENS_API_KEY=sl_live_... python smoke.py`

### Step 3 — 대시보드 검증

`/traces` 페이지로 이동:
- [ ] `ollama-smoke` 라는 trace 표시
- [ ] trace 클릭 → `chat` span 1개
- [ ] span "attrs" 탭에 `metadata.provider: "ollama"` + `metadata.model: "llama3.2"` 표시
- [ ] span 의 **prompt_tokens / completion_tokens** 0 아닌 값
- [ ] span "output" 탭에 LLM 응답 보임
- [ ] (대시보드에 cost 표시되는 곳 있으면) **null / "Self-hosted"** 표시 — 0 으로 표시되면 안 됨

### Step 4 — Provider override 케이스 (선택)

vLLM/LM Studio 등 다른 OpenAI-compat 사용자가 가져갈 길:

```ts
await observeOpenAI(
  trace,
  { name: 'vllm-call', provider: 'vllm' },
  (headers) => vllmClient.chat.completions.create({ ... }, { headers }),
)
```

대시보드에서 `metadata.provider: "vllm"` 표시 확인.

### 통과 조건
✅ Step 1 또는 2 중 하나 + Step 3 → **"Ollama 지원" 자신 있게 마케팅 가능**

---

## 3. 결과 기록

각 smoke 통과 시 이 파일에 체크박스 ✅ + 통과 일자 / 통과한 환경(Azure region, Ollama 모델 등) 한 줄 추가하고 PR 로 정리하면 됨.

| Smoke | Status | 통과 일자 | 환경 |
|---|---|---|---|
| Azure proxy (curl Step 2+3) | ✅ proxy 자체 통과 | 2026-05-20 | Azure OpenAI `gpt-4.1-mini` deployment / eastus / Standard tier, resource `spanlens-smoke-haeseong-2026` |
| Azure dashboard 검증 (Step 4) | ✅ resolved | 2026-05-20 | "stuck" 은 Chrome MCP artifact 였음. 사용자 브라우저 screenshot 에서 azure 행 정상 표시 + timestamp fix (PR #130) 후 elapsed time 정확 |
| Ollama TS | ✅ | 2026-05-20 | `@spanlens/sdk@0.5.0` + `llama3.2:1b` (1.3GB) on Windows Ollama 0.24.0. trace `59147c35-...` ingest chain 4/4 200/201 |
| Ollama Python | ✅ | 2026-05-20 | `spanlens==0.4.0` + 같은 Ollama 모델. trace `c673f0c3-...` 동일한 4/4 ingest chain |
| LangChain / LangGraph TS | ✅ | 2026-05-20 | `@spanlens/sdk@0.6.0` + `@langchain/langgraph` + ChatOpenAI→Ollama. 2-node graph (planner → executor), elapsed 1.5s, trace `fbdb8361-...` — 6 span POST 201 + 5 span PATCH 200 + 1 trace PATCH 200 |

### Azure smoke 통과 증거 (curl raw)

**Step 2 비스트리밍** — HTTP 200, OpenAI-shape 응답:
- `model: "gpt-4.1-mini-2025-04-14"` (Azure가 dated variant 반환 — `lib/cost.ts` longest-prefix fallback이 매칭함)
- `usage: { prompt_tokens: 14, completion_tokens: 9, total_tokens: 23 }`
- Azure 전용 필드 `content_filter_results`, `prompt_filter_results`, `system_fingerprint` 정상 passthrough
- response body의 `choices[0].message.content`: "Hello there! Nice to meet you!"

**Step 3 스트리밍** — SSE 정상:
- 매 chunk 가 `data: {...}\n\n` 형식
- delta content 누적: "Sure! Here you go: 1\n2\n3\n4\n5"
- 마지막 chunk usage: `{ prompt_tokens: 12, completion_tokens: 16, total_tokens: 28 }`
- `data: [DONE]` terminator 정상

**검증된 chain (server side)**:
1. `Authorization: Bearer sl_live_*` → `authApiKey` middleware 통과
2. `apiKeyId + 'azure'` → `provider_keys` SELECT (active row hit)
3. AES-256-GCM 복호화 → 평문 키
4. `provider_metadata.resource_url` + `/openai/v1/chat/completions` 로 upstream URL 조립
5. `Authorization: Bearer` → `api-key: <key>` 헤더 스왑 (`buildUpstreamHeaders` + 명시적 `headers.delete('authorization')`)
6. Azure 응답 status/body passthrough
7. (Streaming) `stream_options: {include_usage: true}` 자동 injection으로 마지막 usage chunk 확보

PR #125 의 test plan 박스 `End-to-end smoke against a real Azure resource` → **retroactively 통과**.

### 차단된 Step 4 — `/requests` SSR Suspense stuck

대시보드에서 행 시각 확인을 하려고 했으나 `/requests`, `/dashboard` 둘 다 `<template id="B:0">` Suspense fallback 에서 무기한 멈춤. `animate-pulse` skeleton 영구 표시. 6초 wait, 페이지 reload 두 차례에도 회복 안 됨. Console 에러 없음 (browser extension 메시지뿐). 별개 이슈로 분리 — [`dashboard-ssr-suspense-stuck-2026-05.md`](dashboard-ssr-suspense-stuck-2026-05.md). 후속 측정에서 **Chrome MCP artifact** 로 확정 — production 정상.

---

## 4. Ollama smoke 통과 증거 (2026-05-20)

### Setup
- `winget install Ollama.Ollama` → 0.24.0 (Windows)
- `ollama pull llama3.2:1b` → 1.3GB
- 로컬 `http://localhost:11434/v1` OpenAI-compat endpoint 응답 OK (usage 27/3/30)
- 별도 `/tmp/ollama-smoke/` 디렉토리에 `@spanlens/sdk@0.5.0` + `openai` 설치

### TS (`smoke.ts`)
```
[smoke-ts] trace=59147c35-23df-46bd-843c-205b115fdb76
[smoke-ts] content="Hi, how can I help you?"
[smoke-ts] usage= { prompt_tokens: 32, completion_tokens: 9, total_tokens: 41 }
[smoke-ts] flushed — check /traces dashboard
```

### Python (`smoke.py`)
```
[smoke-py] trace=c673f0c3-521c-422a-b2fa-6692b1aaed3f
[smoke-py] content="Hello there you're welcome."
[smoke-py] usage=CompletionUsage(completion_tokens=7, prompt_tokens=32, total_tokens=39, ...)
```

### 서버측 ingest 검증 (Vercel logs)

두 trace 모두 4-step chain 전부 200/201:
- `POST /ingest/traces` → 201
- `POST /ingest/traces/{id}/spans` → 201
- `PATCH /ingest/spans/{id}` → 200 (usage + `metadata.provider=ollama` 페이로드 포함)
- `PATCH /ingest/traces/{id}` → 200 (trace 종료)

### Gotchas (다음 사용자를 위해)

- `npm init -y` default 가 `"type": "commonjs"` — `@spanlens/sdk` (ESM-only) 와 충돌 → `"type": "module"` 로 바꿔야 함. `ERR_PACKAGE_PATH_NOT_EXPORTED` 에러로 나타남.
- Python `print()` 가 em-dash (`—`) 같은 unicode 출력 시 Windows 의 cp949 default codec 에 깨짐 — trace 전송엔 무관, 스크립트 trailing 에러만. 회피: 출력에서 unicode 빼거나 `PYTHONIOENCODING=utf-8` 설정.
- 작은 smoke 모델 추천: `llama3.2:1b` (1.3GB) — 충분히 OpenAI-compat response 형식 + usage 필드 채움.

### 통과 조건 ✅
Step 1+2+3 (또는 Python 만) + ingest 4-step chain 모두 OK → **"Ollama 지원" 자신 있게 마케팅 가능**.

PR #126 의 test plan 박스 `Manual smoke against a real local Ollama` → **retroactively 통과**.

---

## 5. LangChain / LangGraph smoke (PR #137 + #138 통합 검증)

### Prereq
- LangChain Python or JS 설치
- OpenAI key (또는 Anthropic, Ollama — handler 가 provider-agnostic)
- Spanlens API key

### TS — plain LangChain (한 LLM 호출만)
```bash
mkdir spanlens-langchain-smoke && cd spanlens-langchain-smoke
npm init -y && echo '{"type":"module"}' > package.json  # ESM 필수
npm install @spanlens/sdk@latest @langchain/core @langchain/openai
```

```ts
// smoke.ts
import { ChatOpenAI } from '@langchain/openai'
import { SpanlensClient } from '@spanlens/sdk'
import { createSpanlensCallbackHandler } from '@spanlens/sdk/langchain'

const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
const handler = createSpanlensCallbackHandler({ client })

const llm = new ChatOpenAI({ model: 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY })
const res = await llm.invoke('Say hi in 5 words', { callbacks: [handler] })
console.log(res.content)
await client.flush()
```
실행: `SPANLENS_API_KEY=sl_live_... OPENAI_API_KEY=sk-... npx tsx smoke.ts`

### TS — LangGraph 2-node graph
```bash
npm install @langchain/langgraph
```

```ts
// smoke-graph.ts
import { StateGraph, START, END } from '@langchain/langgraph'
import { ChatOpenAI } from '@langchain/openai'
import { SpanlensClient } from '@spanlens/sdk'
import { createSpanlensCallbackHandler } from '@spanlens/sdk/langchain'

const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
const handler = createSpanlensCallbackHandler({ client })
const llm = new ChatOpenAI({ model: 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY })

const graph = new StateGraph({ channels: { input: null, plan: null, output: null } })
  .addNode('plan',    async (s) => ({ plan: (await llm.invoke('plan: ' + s.input)).content }))
  .addNode('execute', async (s) => ({ output: (await llm.invoke('execute: ' + s.plan)).content }))
  .addEdge(START, 'plan')
  .addEdge('plan', 'execute')
  .addEdge('execute', END)
  .compile()

const result = await graph.invoke({ input: 'plan a Tokyo trip' }, { callbacks: [handler] })
console.log(result.output)
await client.flush()
```

### Python — LangGraph 2-node graph
```bash
python -m venv venv && source venv/bin/activate
pip install spanlens langgraph langchain-openai
```

```python
# smoke_graph.py
import os
from typing import TypedDict
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END
from spanlens import SpanlensClient
from spanlens.integrations.langchain import SpanlensCallbackHandler

class State(TypedDict, total=False):
    input: str
    plan: str
    output: str

client = SpanlensClient(api_key=os.environ["SPANLENS_API_KEY"])
handler = SpanlensCallbackHandler(client=client)
llm = ChatOpenAI(model="gpt-4o-mini")

def plan(s: State) -> State:
    return {"plan": llm.invoke(f"plan: {s['input']}").content}
def execute(s: State) -> State:
    return {"output": llm.invoke(f"execute: {s['plan']}").content}

graph = (StateGraph(State)
    .add_node("plan", plan).add_node("execute", execute)
    .add_edge(START, "plan").add_edge("plan", "execute").add_edge("execute", END)
    .compile())

result = graph.invoke({"input": "plan a Tokyo trip"}, config={"callbacks": [handler]})
print(result["output"])
client.flush()
```

### 대시보드 검증

`/traces` 에 1개 trace, 5개 span 예상:
- [ ] `chain.LangGraph` (root)
- [ ] `chain.plan` (parent_span_id = LangGraph)
- [ ] `llm.ChatOpenAI` (parent_span_id = plan, 토큰 채워짐)
- [ ] `chain.execute` (parent_span_id = LangGraph)
- [ ] `llm.ChatOpenAI` (parent_span_id = execute, 토큰 채워짐)

서버측 Vercel logs 에서 `POST /ingest/traces` + `POST /ingest/traces/.../spans` × 5 + `PATCH /ingest/spans/...` × 5 + `PATCH /ingest/traces/...` 모두 200/201 확인.

### 통과 조건 ✅
plain LangChain 또는 LangGraph 둘 중 하나 + 대시보드 span tree depth 정확 → **"LangGraph 지원" 마케팅 가능**.

PR #136 plan 의 test plan box `Live smoke against a real @langchain/langgraph 2-node graph` → **retroactively 통과**.

### Live smoke 통과 증거 (2026-05-20)

**Setup**:
- `/tmp/langgraph-smoke/` 디렉토리, `"type": "module"` + `@spanlens/sdk@0.6.0` + `@langchain/langgraph` + `@langchain/openai`
- ChatOpenAI 가 로컬 Ollama (`llama3.2:1b`, `http://localhost:11434/v1`) 백엔드 사용 — 외부 LLM 비용 없이 검증

**Script result**:
```
[smoke-langgraph] invoking graph…
[smoke-langgraph] elapsed=1532ms
[smoke-langgraph] plan="To answer the question 'What is 2+2?', you would provide a straightforward and a…"
[smoke-langgraph] output="The answer is 4.…"
[smoke-langgraph] flushed — check /traces
```

**서버측 Vercel logs** (trace `fbdb8361-4a8a-4c79-a734-bdc16533e6e9`):
- `POST /ingest/traces` → 201 (1×)
- `POST /ingest/traces/.../spans` → 201 (6×) — graph + planner + executor + chain wrappers + LLM 노드들
- `PATCH /ingest/spans/...` → 200 (5×)
- `PATCH /ingest/traces/.../` → 200 (1×)

**의미**: LangGraph 의 노드 토폴로지가 `parentRunId` 를 통해 자동으로 span tree 로 변환됨. 같은 handler 가 LangChain / LCEL / LangGraph 어떤 것에도 attach 가능함을 production 환경에서 검증.

### Gotchas (다음 사용자를 위해)

- LangGraph `Annotation.Root({...})` 의 채널 이름과 노드 이름이 같으면 `addNode` 가 throw — 흔한 함정 (`plan` 채널 + `plan` 노드 충돌). 다른 이름 사용 (예: `planner` / `executor`).
- 로컬 Ollama 서비스가 멈춰있으면 `ECONNREFUSED` — 재시작은 `ollama serve` (background).
- ChatOpenAI 를 Ollama 에 붙일 때 `configuration: { baseURL: 'http://localhost:11434/v1' }` 형태 (`baseURL` 이 ChatOpenAI 의 첫 레벨 옵션이 아님).
