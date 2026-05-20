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
| Azure proxy | ⬜ | | |
| Ollama TS | ⬜ | | |
| Ollama Python | ⬜ | | |

3개 다 통과 시 PR #125, #126 의 test plan 미체크 box 를 retroactively 체크 처리.
