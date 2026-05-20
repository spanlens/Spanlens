# LangGraph SDK Integration — Plan

**작성일**: 2026-05-20
**범위**: TS (`@spanlens/sdk@0.6.0`) + Python (`spanlens==0.5.0`) 동시
**관련 cycle**: Integrations Expansion (Azure + Ollama) 후속, 첫 번째 framework integration cycle

---

## 0. TL;DR

LangGraph 는 LangChain 위에 얹힌 graph orchestration 라이브러리 — node = function, edge = transition, state = channel. **자체 callback 체계가 따로 있지 않고 LangChain 의 `BaseCallbackHandler` 를 재사용**한다. 따라서:

- **TS 측**: 기존 `createSpanlensCallbackHandler` 를 **확장** (현재 `handleLLMStart` / `handleLLMEnd` 만 구현 → `handleChainStart/End`, `handleToolStart/End`, `handleRetrieverStart/End` 추가). `parentRunId` 를 이용해 자동으로 span tree 구성.
- **Python 측**: LangChain 통합이 아직 없음 → **새로 추가**. TS 와 동일 contract.
- **별도 `@spanlens/sdk/langgraph` 모듈 안 만듦.** 같은 handler 가 LangChain / LangGraph / LCEL 어떤 것에든 attach 가능 — docs 에서 LangGraph 사용 예시만 별도 섹션으로 강조.

PR breakdown 4개 + 검증 1개. 총 약 **5~7일 작업량** 예상 (TS 기능 + Python 신규 + tests + docs).

---

## 1. 왜 LangGraph

### Customer pull

| 신호 | 비고 |
|---|---|
| LangChain 0.3.0+ 의 표준 agent 패턴 | 단순 chain 너머 multi-step / multi-agent 워크플로 사용자가 LangGraph 로 이주 중 |
| Anthropic / OpenAI 의 "agentic SDK" 흐름 | LangGraph 가 가장 성숙한 OSS 옵션. Helicone / Langfuse / LangSmith 모두 우선 지원 |
| Spanlens 의 "AgentOps" 포지셔닝 | CLAUDE.md 의 정식 명 = Spanlens(AgentOps). 멀티 에이전트 trace 가 핵심 강점이라면 LangGraph 미지원은 신뢰 hole |

### 우선순위 (Integrations Expansion §4 plan 에서 별도 cycle 로 분리한 항목)

1. **LangGraph** ⭐️ (이 plan) — LangChain 기반이라 작업량 비교적 작음 + 사용자 수 큼
2. CrewAI — Python only, agent lifecycle hook
3. DSPy — 사용자 수 작음, 나중
4. PostHog — 카테고리 다름 (product analytics)
5. AWS Bedrock — effort 큼

---

## 2. 현재 상태

### TS SDK (`@spanlens/sdk@0.5.0`)

`packages/sdk/src/integrations/langchain.ts` 에 `createSpanlensCallbackHandler` 있음. **범위가 좁음**:

| 핸들러 | 구현됨? |
|---|---|
| `handleLLMStart` / `handleChatModelStart` | ✅ |
| `handleLLMEnd` / `handleLLMError` | ✅ |
| `handleChainStart` / `handleChainEnd` / `handleChainError` | ❌ |
| `handleToolStart` / `handleToolEnd` / `handleToolError` | ❌ |
| `handleRetrieverStart` / `handleRetrieverEnd` / `handleRetrieverError` | ❌ |
| `handleAgentAction` / `handleAgentEnd` | ❌ |

→ 현재 LangChain 사용자는 LLM 호출 1개만 span 으로 잡힘. LangGraph 같이 노드 5개 + 툴 3개 워크플로면 **노드 구조가 dashboard 에 전혀 안 보임**.

### Python SDK (`spanlens==0.4.0`)

`packages/sdk-python/spanlens/integrations/` 에 langchain 통합 **없음**. 직접 instrumentation 만 가능 (`observe_openai` 등).

---

## 3. LangGraph 통합 메커니즘

### LangGraph 가 callback 을 emit 하는 방식

LangGraph 는 자체 callback 체계가 아니라 **LangChain 의 `BaseCallbackHandler` 를 그대로 재사용**한다.

```ts
const graph = workflow.compile()
const result = await graph.invoke(
  { input: 'hi' },
  { callbacks: [handler] }, // ← 같은 RunnableConfig.callbacks
)
```

호출 chain:
1. graph 자체가 한 `handleChainStart` (runId=A, parentRunId=undefined) 발생
2. 각 노드가 또 `handleChainStart` (runId=B, parentRunId=A) — 노드 함수 실행 시작
3. 노드 안 LLM 호출이 `handleLLMStart` (runId=C, parentRunId=B)
4. 노드 안 툴 호출이 `handleToolStart` (runId=D, parentRunId=B)
5. 각각 대응하는 `handle*End` 가 mirror 순서로 발생

**핵심**: `parentRunId` 가 항상 채워짐 → 우리는 `runId → SpanHandle` map 하나만 유지하면 자동으로 트리 구성 가능.

### Span 매핑 규약

| LangChain 이벤트 | Spanlens span type | name 예시 |
|---|---|---|
| `handleChainStart` (top-level) | `custom` | `chain.LangGraph` (graph 이름) |
| `handleChainStart` (node) | `custom` | `chain.<nodeName>` |
| `handleLLMStart` / `handleChatModelStart` | `llm` | `llm.ChatOpenAI` |
| `handleToolStart` | `tool` | `tool.<toolName>` |
| `handleRetrieverStart` | `retrieval` | `retrieval.<retrieverName>` |
| `handleAgentAction` | (metadata 만, span 안 만듦) | — |

### Output / usage 추출

- LLM: 기존 `parseLangChainResult` 재사용 (`llmOutput.tokenUsage`)
- Chain: `handleChainEnd` 의 `outputs` 그대로 `span.end({ output })`
- Tool: `handleToolEnd` 의 `output` 그대로
- Retriever: documents 배열을 `output` 으로 (조정 가능)

---

## 4. 구현 방향

### 옵션 A — 기존 `createSpanlensCallbackHandler` 확장 ⭐️

- TS: 같은 함수에 chain/tool/retriever 핸들러 추가. 기존 호출 호환 유지.
- Python: 미러링한 `create_spanlens_callback_handler` 신규.
- 사용자 코드 변경: 0 (이미 callbacks 에 attach 한 경우 자동 enrich).

장점:
- 한 import 로 LangChain + LangGraph + LCEL 전부 커버
- 백워드 호환 (기존 0.5.0 사용자는 LLM span 만 보이던 게 더 풍부해짐)
- `runId/parentRunId` 트리가 LangGraph 의 노드 구조와 1:1

단점:
- handler 로직이 커짐 (LLM 만 다루던 ~140 줄 → ~350 줄 추정)

### 옵션 B — 별도 `@spanlens/sdk/langgraph` 모듈

- LangChain 과 LangGraph 가 다른 사용자라고 가정. 별도 wrapper.

장점:
- LangGraph 사용자가 docs 에서 더 찾기 쉬움
- 향후 LangGraph 전용 metadata (state diff, step number) 추가 시 격리

단점:
- 코드 중복 (handler 본질은 동일)
- 두 곳 다 maintain — drift 위험
- 사용자 입장 "어느 걸 써야 하나" 혼란

### 결정: **옵션 A 채택**

이유:
1. LangGraph 가 LangChain callback 을 그대로 쓰는 게 LangGraph 팀의 의도된 설계
2. Helicone / LangSmith / Langfuse 도 동일 패턴 (단일 handler)
3. 향후 LangGraph 전용 metadata 가 필요해질 때 `handler.options.langgraph: true` 같은 추가 옵션으로 분기 가능 — 처음부터 분리할 필요 없음

→ docs 에 **LangGraph 사용 예시 섹션**만 따로 만들어서 discoverability 챙김.

---

## 5. 공개 API 설계

### TS — 확장된 `createSpanlensCallbackHandler`

```ts
import { SpanlensClient } from '@spanlens/sdk'
import { createSpanlensCallbackHandler } from '@spanlens/sdk/langchain'
import { StateGraph } from '@langchain/langgraph'

const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
const handler = createSpanlensCallbackHandler({ client })

const workflow = new StateGraph(...)
  .addNode('plan',    planNode)
  .addNode('execute', executeNode)
  .addEdge('plan', 'execute')

const graph = workflow.compile()
const result = await graph.invoke(
  { input: 'plan a trip to Tokyo' },
  { callbacks: [handler] }, // ← 한 줄
)
```

대시보드 trace 구조:
```
trace: langchain_run
└─ span chain.LangGraph
   ├─ span chain.plan
   │  └─ span llm.ChatOpenAI (model, tokens)
   └─ span chain.execute
      ├─ span tool.search (input/output)
      └─ span llm.ChatOpenAI
```

### 추가 옵션 (필요 시)

```ts
createSpanlensCallbackHandler({
  client,
  trace,                          // 기존
  traceName: 'rag_pipeline',      // 기존
  captureChains: true,            // 신규 (default true) — chain spans on/off
  captureTools: true,             // 신규 (default true)
  captureRetrieval: true,         // 신규 (default true)
  maxInputBytes: 16_384,          // 신규 — span.input 크기 제한 (state object 큰 경우 대비)
  maxOutputBytes: 16_384,         // 신규
})
```

### Python — 신규 모듈 `spanlens.integrations.langchain`

```python
from spanlens import SpanlensClient
from spanlens.integrations.langchain import SpanlensCallbackHandler
from langgraph.graph import StateGraph

client = SpanlensClient(api_key=os.environ['SPANLENS_API_KEY'])
handler = SpanlensCallbackHandler(client=client)

graph = workflow.compile()
result = graph.invoke(
    {'input': 'plan a trip'},
    config={'callbacks': [handler]},
)
```

Python 측은 `SpanlensCallbackHandler` 클래스 (LangChain `BaseCallbackHandler` 상속) — Python LangChain 컨벤션.

---

## 6. PR 분할

| PR | 범위 | 예상 작업 | 의존 |
|---|---|---|---|
| **A1** | TS handler 확장 (chain/tool/retriever + runId 트리) + 기존 LLM 호환 유지 + 12 신규 unit tests | 1.5d | — |
| **A2** | TS LangGraph dedicated docs 섹션 (`/docs/sdk#langgraph`) + smoke 스크립트 추가 | 0.5d | A1 |
| **B1** | Python `SpanlensCallbackHandler` 신규 + tests (TS A1 와 동일 contract) | 2d | — |
| **B2** | Python LangGraph 예시 docs + smoke | 0.5d | B1 |
| **C** | SDK 버전 bump + npm/PyPI publish (sdk-v0.6.0, python-sdk-v0.5.0) | 0.5d | A2 + B2 |

A1 + B1 병렬 가능. 끝나면 A2/B2 → C. 총 wall-clock ~5d.

---

## 7. 테스트 전략

### TS unit tests (PR A1 의 일부)

`packages/sdk/src/__tests__/integrations-langgraph.test.ts` 신규. mocked LangChain callback 발생 패턴:

| 시나리오 | 검증 |
|---|---|
| 단일 chain 시작/종료 | span 1개 type='custom', name 매칭 |
| 중첩 chain (parent + child) | child.parent_span_id = parent.spanId |
| chain 안 LLM start/end | LLM span 이 chain 의 child, usage 파싱 |
| chain 안 tool start/end | tool span 이 chain 의 child, input/output 캡처 |
| retriever start/end | retrieval span, documents 가 output 으로 |
| 에러 발생 (handleChainError) | span status='error', errorMessage 채움 |
| 동시 실행 2개 run (다른 runId) | 서로 간섭 없음 (Map lookup 검증) |
| `captureTools: false` | tool 이벤트 무시되는지 |
| `maxInputBytes` 초과 시 input truncate 처리 | 잘림 표시 (`{ truncated: true, ... }`) |
| LangGraph 시나리오 (graph → 노드 → LLM 3-level) | 3-depth span tree 정확히 형성 |
| handleChainEnd 가 handleChainStart 전에 (out-of-order) | silent ignore (방어적) |
| handleChainEnd 가 두 번 호출 | 두 번째는 ignore (idempotent) |

### Python unit tests (PR B1 의 일부)

pytest 기반. 동일 시나리오 12개 미러링. respx + 가짜 callback emit fixture.

### Smoke (PR A2 / B2)

`docs/plans/integrations-expansion-smoke-tests.md` 에 **§5 LangGraph smoke** 추가:

```
- 의존: @langchain/langgraph@latest + 1 LLM provider key (OpenAI 무관)
- TS 스크립트: 2-node graph (plan → execute) 만들고 invoke
- 기대: /traces 에 trace 1개, span 5개 (graph/plan/execute/llm/tool) — depth + 부모-자식 관계 정확
- Python: 동일 절차
```

---

## 8. 위험 / 미확정

| 위험 | 완화 |
|---|---|
| LangChain JS callback 패키지가 자주 breaking change | duck-typed (직접 `@langchain/core` import 안 함) — 기존 langchain.ts 도 그 방식. 유지 |
| LangGraph 가 노드를 병렬 실행할 때 runId 가 같은 parent 아래 여러 child 가 동시에 열림 | Map<runId, SpanHandle> 은 runId 가 unique 라 안전. parent 가 닫히기 전에 child 들이 닫히는 흐름은 기존 SpanHandle 가 받아냄 |
| `output` / `input` 객체가 매우 큼 (graph state) | `maxInputBytes` / `maxOutputBytes` 옵션 + truncate marker. 기본 16KB |
| 동일 trace 에 100+ span (큰 graph) | 현재 server `/ingest/traces/:id/spans` 처리량 OK. P3.8 sampling 도 trace 단위라 손해 없음 |
| handleChainStart 의 `runType` 이 `chain`/`tool`/`retriever` 등 다양 | `runType` 으로 분기 가능 — 다만 LangGraph 노드는 그냥 `chain` 으로 옴. `metadata.langgraph_node` 같은 식별자가 있는지 검증 필요 (구현 시 LangGraph 실제 payload 로 확인) |
| Python LangChain `BaseCallbackHandler` 추상 메서드 시그니처가 TS 와 미묘하게 다름 (e.g. `inputs: Dict[str, Any]`) | 둘 다 구현 시 양쪽 spec 별도 확인. Helicone/Langfuse 오픈소스 reference 검토 |

---

## 9. 사용자 확인 사항

1. **옵션 A (단일 handler 확장) OK?** vs B (별도 `@spanlens/sdk/langgraph` 모듈)
2. **`maxInputBytes` / `maxOutputBytes` default** — 16KB 가 적정?
3. **버전 bump 형식**:
   - TS: `0.5.0 → 0.6.0` (minor — backward compatible)
   - Python: `0.4.0 → 0.5.0` (minor)
   - 또는 신규 기능 강조해서 둘 다 1.0.0?
4. **PR 순서 선호**: TS 먼저 (A1→A2) → Python (B1→B2) 직렬 vs 병렬 진행
5. **CrewAI 후속 cycle 도 같은 plan 패턴으로 진행할지** — LangGraph 끝나면 별도 plan 작성?

---

## 10. 참고

- LangChain JS `BaseCallbackHandler` 시그니처: `langchain-ai/langchainjs/libs/langchain-core/src/callbacks/base.ts`
- LangChain Python `BaseCallbackHandler` 시그니처: `langchain-ai/langchain/libs/core/langchain_core/callbacks/base.py`
- LangGraph JS: `@langchain/langgraph` (npm)
- LangGraph Python: `langgraph` (PyPI)
- Helicone LangGraph integration: 단일 handler 패턴 (확인 필요)
- Langfuse LangGraph integration: 단일 handler 패턴
- 기존 Spanlens 코드: `packages/sdk/src/integrations/langchain.ts`, `packages/sdk/src/__tests__/integrations.test.ts`
