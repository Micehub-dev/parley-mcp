# Orchestrator-Agnostic Multi-LLM 토론 환경 설계안

## 결론

권장 형태는 `MCP 서버`를 중심으로 두고, 내부에서 `claude` CLI와 `gemini` CLI를 래핑하는 방식이다.

여기서 핵심 전제는 "`Codex`, `Claude`, `Gemini` 중 누가 오케스트레이터여도 같은 계약으로 동작해야 한다"는 점이다.

- `plugin`이나 `extension`은 각 벤더 전용 배포 형식이라 공통 오케스트레이션 계층으로 쓰기 어렵다.
- `MCP`는 Claude Code와 Gemini CLI가 모두 공식 지원하는 공통 확장 표준이다.
- Codex 쪽도 MCP 친화적으로 연결하기 좋기 때문에, 나중에 세 CLI를 같은 구조로 묶기 쉽다.
- 필요하면 이후에 같은 코어를 감싸는 `Claude plugin` 또는 `Gemini extension`을 추가할 수 있다.

즉, 구조는 다음이 가장 안정적이다.

1. 코어: `multi-llm-debate` 로컬 MCP 서버
2. 백엔드: `claude`, `gemini` CLI 래퍼
3. 클라이언트: Codex / Claude Code / Gemini CLI 중 아무 MCP 클라이언트
4. 선택 사항: Gemini extension / Claude plugin 은 배포 편의용 thin wrapper

## 왜 MCP가 가장 적합한가

### Claude 측

- Claude Code는 MCP를 "AI-tool integrations"를 위한 오픈 표준으로 공식 지원한다.
- Claude Code는 프로젝트 루트의 `.mcp.json` 또는 명령행으로 MCP 서버를 연결할 수 있다.
- Claude plugin도 MCP 서버를 번들링할 수 있지만, 결국 Claude 전용 포장 계층이다.

### Gemini 측

- Gemini CLI는 extension 안에 MCP 서버, context, commands, hooks, skills 를 함께 묶을 수 있다.
- Gemini 공식 문서도 "새로운 도구와 데이터 소스를 모델에 노출"할 때는 MCP server를 쓰라고 안내한다.
- 즉 Gemini extension은 코어가 아니라 배포 포맷이고, 실제 도구 실행 계층은 MCP로 두는 편이 재사용성이 높다.

### MCP 프로토콜 측

- MCP 사양은 서버가 `tools`, `resources`, `prompts` 를 제공하는 공통 계약을 정의한다.
- 같은 서버를 여러 종류의 클라이언트가 소비할 수 있게 설계되어 있어, 오케스트레이터 교체에 유리하다.
- 반면 각 클라이언트의 UI 상호작용 방식은 표준이 강제하지 않으므로, 정합성이 필요한 핵심 동작은 `tool` 계약에 실어야 한다.

## Orchestrator-Agnostic 설계 원칙

### 1. 상태는 클라이언트가 아니라 서버가 소유한다

토론 세션, topic board, thread, 요약, resume ID, 잠금 상태는 모두 MCP 서버가 저장해야 한다.

- 오케스트레이터는 상태를 "소유"하지 않고 "호출"만 한다.
- 세션을 다시 이어갈 때도 `debateSessionId` 와 서버 저장 상태만 있으면 된다.
- 특정 오케스트레이터의 로컬 메모리나 대화 문맥에 필수 상태를 숨겨두면 안 된다.

이 원칙이 있어야 Codex가 시작한 세션을 Claude나 Gemini가 이어받아도 동작이 끊기지 않는다.

### 2. 핵심 계약은 tool-first 여야 한다

MCP는 resources와 prompts도 제공할 수 있지만, 클라이언트마다 표현 방식이 다를 수 있다.

- 상태 변경: 반드시 `tool`
- 읽기 전용 조회: 가능하면 `resource` + `tool` 병행
- 편의 워크플로: 선택적으로 `prompt`

즉, correctness가 필요한 경로는 항상 tool 기반이어야 한다.

### 3. 자식 참가자 세션은 오케스트레이터와 격리해야 한다

오케스트레이터가 Claude나 Gemini일 때 가장 큰 위험은 자식 `claude` / `gemini` 프로세스가 다시 MCP 도구를 호출해 재귀 루프에 빠지는 것이다.

따라서 참가자 세션은 아래처럼 격리해야 한다.

- Claude participant:
  - `--tools ""` 로 built-in 도구 비활성화
  - `--strict-mcp-config` 로 상위 `.mcp.json` 상속 차단
  - `--json-schema` 또는 `--output-format json` 기반 구조화 출력 강제
- Gemini participant:
  - 전용 policy 파일로 MCP 도구와 불필요한 로컬 도구를 deny
  - 필요 시 전용 workspace 설정으로 extension / MCP 노출 최소화
  - `--output-format json` 기반 구조화 출력 사용

Gemini policy engine 문서에는 deny된 도구를 모델 메모리에서 완전히 제외할 수 있다고 명시되어 있어서, 토론 참가자를 "발언 전용" 에이전트로 만들기 좋다.

### 4. 동시성은 lease + version 으로 제어해야 한다

오케스트레이터가 바뀌면 "누가 지금 이 세션을 진행 중인가"가 중요해진다.

따라서 세션 상태에는 최소한 아래 필드가 필요하다.

- `stateVersion`
- `leaseOwner`
- `leaseExpiresAt`
- `lastWriter`
- `updatedAt`

권장 규칙:

- `debate_step` 호출 시 `expectedStateVersion` 을 같이 보낸다.
- 서버는 버전이 맞을 때만 갱신한다.
- 장시간 step 동안은 lease를 잡고, 끝나면 갱신 또는 해제한다.
- lease가 만료되면 다른 오케스트레이터가 이어받을 수 있다.

즉, 영구 owner가 아니라 "짧은 lease" 만 인정해야 orchestrator-agnostic 하다.

### 5. 출력은 자유 텍스트가 아니라 구조화 응답이어야 한다

오케스트레이터마다 프롬프트 스타일이 다르므로, 참가자 응답을 자유 텍스트만으로 처리하면 파싱 안정성이 떨어진다.

서버는 참가자에게 아래와 같은 응답 구조를 요구하는 편이 안전하다.

```json
{
  "stance": "agree | disagree | refine | undecided",
  "summary": "짧은 입장 요약",
  "arguments": ["핵심 논점 1", "핵심 논점 2"],
  "questions": ["남은 질문 1"],
  "proposed_next_step": "다음 행동"
}
```

Claude는 CLI에서 JSON schema 검증을 걸 수 있으므로 그 기능을 우선 활용하고, Gemini는 JSON 출력 후 서버에서 스키마 검증 및 재시도를 수행하는 방식이 현실적이다.

### 6. 워크스페이스 경계는 roots / workspaceId 로 명시해야 한다

워크스페이스별 topic board를 안전하게 다루려면, 세션이 어느 workspace에 속하는지 서버가 명확히 알아야 한다.

- `workspaceId`
- `workspaceRoot`
- 선택 사항: MCP roots 메타데이터

이 값을 세션 시작 시 고정하고 이후에는 변경하지 않는 편이 안전하다.

### 7. 클라이언트 특화 UX는 선택 사항이어야 한다

예를 들어 prompt를 slash command로 노출하는 방식은 클라이언트마다 다르다.

- Claude 전용 slash command에 의존하지 않는다.
- Gemini extension 전용 command에 의존하지 않는다.
- 핵심 기능은 언제나 동일한 MCP tool/resource 에서 제공한다.

클라이언트별 UX는 thin wrapper로만 추가한다.

## 요구사항별 설계

### 1. 형태 선택

추천: `MCP 서버`

비추천:

- Claude plugin 단독: Claude 전용이다.
- Gemini extension 단독: Gemini 전용이다.
- Codex 전용 local tool 단독: Gemini/Claude 쪽 재사용성이 낮다.

추천 보완:

- 추후 Gemini 사용성을 높이고 싶으면, 같은 MCP 서버를 포함하는 Gemini extension을 추가한다.
- 추후 Claude 설치 편의성을 높이고 싶으면, 같은 MCP 서버를 포함하는 Claude plugin을 추가한다.

### 2. 모델 선택 + 기본 모델

세션 생성 시 각 참가자별 모델을 선택 가능하게 하고, 생략 시 프로젝트 기본값을 적용한다.

예시 설정:

```json
{
  "debate": {
    "defaults": {
      "claudeModel": "sonnet",
      "geminiModel": "auto"
    },
    "allowedModels": {
      "claude": ["sonnet", "opus"],
      "gemini": ["auto", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-3-pro-preview", "gemini-3-flash-preview"]
    }
  }
}
```

실행 시:

- Claude: `claude --model <model>`
- Gemini: `gemini --model <model>`

주의:

- Gemini는 공식적으로 `Auto`가 권장 기본값이다.
- Claude는 로컬 help 기준으로 `sonnet`, `opus` 별칭 또는 전체 모델명을 받을 수 있다.
- 모델 "자동 나열"은 CLI별 안정성이 다를 수 있으므로, 1차 구현에서는 설정 파일 allowlist 기반 검증이 더 안전하다.

### 3. 최대 턴 수 + 기본값

세션별 `maxTurns`를 두고, 생략 시 `defaultMaxTurns`를 사용한다.

예시:

```json
{
  "debate": {
    "defaultMaxTurns": 8
  }
}
```

권장 동작:

- 1 turn = 한 라운드에서 각 참가자가 1회씩 발언 완료
- `maxTurns` 도달 시 오케스트레이터가 자동 종료
- 종료 직전 요약과 결론 초안을 생성

중요:

- 이 제한은 각 CLI의 내장 기능에 맡기지 말고, 오케스트레이터가 공통 규칙으로 강제하는 것이 좋다.
- Gemini는 공식적으로 `model.maxSessionTurns` 설정을 지원하지만, Claude와 동작을 맞추려면 상위 오케스트레이터에서 일괄 제어하는 편이 낫다.

### 4. 세션 컨텍스트 유지

핵심은 "매 턴마다 새 프로세스를 띄워도 같은 세션 ID로 resume" 하는 것이다.

세션 상태 예시:

```json
{
  "sessionId": "debate-20260312-001",
  "topic": "MCP vs plugin",
  "turn": 3,
  "maxTurns": 8,
  "participants": {
    "claude": {
      "model": "sonnet",
      "resumeId": "claude-session-id"
    },
    "gemini": {
      "model": "gemini-2.5-pro",
      "resumeId": "gemini-session-id"
    }
  }
}
```

실행 전략:

- 첫 턴
  - Claude: 새 세션 시작 후 session/resume ID 저장
  - Gemini: 새 세션 시작 후 session/resume ID 저장
- 후속 턴
  - Claude: `-r <session-id>` 또는 `-c` 기반으로 이어서 호출
  - Gemini: `--resume <session-id>` 기반으로 이어서 호출

이 방식으로 각 CLI의 자체 컨텍스트 윈도우와 대화 이력을 계속 유지할 수 있다.

### 5. 워크스페이스 단위 과거 토론 관리

이 요구도 `MCP 서버`에 매우 잘 맞는다.

핵심은 "실시간 토론 세션"과 "워크스페이스 지식 보드"를 분리하는 것이다.

- 실시간 토론 세션: 현재 진행 중인 Claude/Gemini 대화
- 워크스페이스 지식 보드: 과거 토론 주제, 상태, 주요 스레드, 결론, 후속 작업

권장 UI 메타포는 `Reddit + Redmine` 혼합형이다.

- Reddit 요소: 주제 중심 thread, 댓글형 흐름, 핵심 발언 묶음
- Redmine 요소: 상태값, 태그, 우선순위, 결론, 후속 action item

즉 "토론 게시판"처럼 보이되, 단순 로그 저장소가 아니라 추적 가능한 의사결정 시스템으로 만드는 편이 좋다.

## 권장 MCP 도구 설계

MCP 서버는 아래 정도의 도구를 제공하면 충분하다.

### `debate_start`

입력:

- `workspaceId`
- `topic`
- `claudeModel?`
- `geminiModel?`
- `maxTurns?`
- `systemPrompt?`
- `orchestrator?`

출력:

- `debateSessionId`
- 실제 적용된 모델
- 실제 적용된 기본 턴 수
- `stateVersion`
- `leaseOwner`

### `debate_step`

입력:

- `debateSessionId`
- `expectedStateVersion`
- `orchestratorRunId`
- `speakerOrder?`
- `userNudge?`

동작:

- 현재까지의 논점 요약을 각 CLI에 전달
- Claude 응답 수집
- Gemini 응답 수집
- turn 카운트 증가

출력:

- 현재 turn
- Claude 발언
- Gemini 발언
- 중간 합의점 / 충돌점
- 종료 여부
- 새 `stateVersion`

### `debate_state`

출력:

- 전체 세션 메타데이터
- 각 participant의 model / resumeId
- 남은 turn 수
- 현재 `stateVersion`
- 현재 `leaseOwner`

### `debate_claim_lease`

입력:

- `debateSessionId`
- `orchestratorRunId`
- `ttlSeconds?`

출력:

- `leaseOwner`
- `leaseExpiresAt`
- `stateVersion`

### `debate_finish`

출력:

- 전체 요약
- 합의점
- 쟁점
- 권장 결론
- 전체 transcript 위치

### `debate_list_workspaces`

출력:

- 관리 중인 workspace 목록
- 각 workspace의 topic 수
- 마지막 활동 시각

### `debate_list_topics`

입력:

- `workspaceId`
- `status?`
- `tag?`
- `query?`

출력:

- 최근 토론 주제 목록
- 각 주제의 상태
- 마지막 활동 시각
- 대표 결론 요약

### `debate_get_topic`

입력:

- `workspaceId`
- `topicId`

출력:

- 주제 메타데이터
- 연결된 세션 목록
- 주요 스레드 목록
- 결정 사항
- 미해결 쟁점

### `debate_create_topic`

입력:

- `workspaceId`
- `title`
- `body`
- `tags?`
- `status?`

출력:

- `topicId`

### `debate_add_thread`

입력:

- `workspaceId`
- `topicId`
- `title`
- `sourceSessionId?`
- `messages`

출력:

- `threadId`

### `debate_promote_summary`

입력:

- `workspaceId`
- `topicId`
- `sourceSessionId`

동작:

- 긴 세션 transcript에서 핵심 논점만 추출
- "주요 대화 스레드" 항목으로 승격
- 이후 검색 가능한 canonical summary로 저장

출력:

- 갱신된 topic summary
- 생성된 thread 목록

## MCP Surface 분리 원칙

오케스트레이터가 바뀌어도 같은 경험을 유지하려면, MCP surface 를 아래처럼 분리하는 편이 좋다.

### Tools

상태를 바꾸는 API다.

- `debate_start`
- `debate_claim_lease`
- `debate_step`
- `debate_finish`
- `debate_create_topic`
- `debate_add_thread`
- `debate_promote_summary`

### Resources

읽기 전용 지식 보드다. Reddit/Redmine 식 조회는 resources가 특히 잘 맞는다.

예시 URI:

- `debate://workspaces`
- `debate://workspace/{workspaceId}/topics`
- `debate://workspace/{workspaceId}/topic/{topicId}`
- `debate://workspace/{workspaceId}/topic/{topicId}/threads`
- `debate://workspace/{workspaceId}/session/{sessionId}/summary`

### Prompts

편의용 워크플로다. 예를 들어:

- `debate.review_topic`
- `debate.start_from_topic`
- `debate.challenge_decision`

다만 prompts는 UI 표현이 클라이언트마다 다를 수 있으므로, 정확성이 필요한 동작을 prompts에만 맡기면 안 된다.

## 저장 구조 권장안

프로젝트 안에 아래처럼 두는 것이 관리하기 쉽다.

```text
.multi-llm/
  config.json
  workspaces/
    default/
      topics/
        topic-001/
          topic.json
          threads.jsonl
          decision.md
      indexes/
        topics-by-updated.json
        open-topics.json
  sessions/
    debate-20260312-001/
      state.json
      transcript.jsonl
      summary.md
      lease.json
```

`state.json` 에는 아래를 저장한다.

- 각 CLI resume ID
- 각 participant model
- 기본 system prompt
- 현재 턴
- maxTurns
- 최근 요약
- `stateVersion`
- `leaseOwner`
- `leaseExpiresAt`
- `workspaceId`
- `workspaceRoot`
- `orchestratorAuditLog`

`topic.json` 에는 아래를 저장한다.

- `topicId`
- `workspaceId`
- `title`
- `body`
- `status`
- `tags`
- `createdAt`
- `updatedAt`
- `linkedSessionIds`
- `keyThreadIds`
- `decisionSummary`
- `openQuestions`
- `actionItems`
- `canonicalSummary`
- `statusHistory`

긴 대화에서 컨텍스트 비용이 커질 수 있으므로, 오케스트레이터는 매 턴 전체 transcript를 그대로 다시 넣기보다 아래를 함께 유지하는 것이 좋다.

- 원본 transcript
- rolling summary
- open questions
- agreed facts
- structured participant outputs

`orchestratorAuditLog` 는 아래 정도만 남기면 충분하다.

- `clientKind`: `codex | claude | gemini | other`
- `clientVersion`
- `runId`
- `startedAt`
- `completedAt`

즉, 각 CLI의 native session history는 유지하되, 오케스트레이터도 별도의 압축 요약 상태를 같이 보관해야 한다.

또한 topic 계층에는 아래의 "포럼형 인덱스"를 유지하는 것이 좋다.

- 토론 주제 목록
- 주제별 주요 스레드
- 최종 결론
- 반대 의견 요약
- 후속 검증 필요 항목

이 계층이 있어야 워크스페이스 수준에서 "지난번에 이 주제 어떻게 결론 났지?"를 빠르게 찾을 수 있다.

## 워크스페이스 보드 모델

권장 엔티티는 4개다.

### Workspace

- 하나의 코드 저장소 또는 연구 폴더 단위
- 예: `E:\research\Parley`

### Topic

- 큰 토론 주제
- 예: "MCP 서버 vs 전용 extension"

### Thread

- 주제 안의 하위 논점
- 예: "세션 유지 전략", "모델 선택 정책", "요약 압축 정책"

### Session

- 실제로 Claude/Gemini/Codex가 오간 개별 토론 실행 기록

관계는 아래처럼 두는 편이 좋다.

- 하나의 workspace는 여러 topic을 가진다.
- 하나의 topic은 여러 thread를 가진다.
- 하나의 topic은 여러 session을 참조할 수 있다.
- 하나의 thread는 하나 이상의 session 발언 일부를 인용할 수 있다.

## Reddit / Redmine 식 기능 매핑

### Reddit 식 기능

- 주제별 thread 보기
- 핵심 발언 pin
- 찬성 / 반대 / 보류 논점 분리
- 요약 우선 보기

### Redmine 식 기능

- 상태: `open`, `in_review`, `decided`, `archived`
- 태그: `architecture`, `research`, `implementation`
- 우선순위: `low`, `medium`, `high`
- 후속 작업과 담당자 필드
- 관련 세션 연결

실무적으로는 Reddit처럼 읽히고, Redmine처럼 추적 가능해야 한다.

## 검색과 회고를 위한 최소 기능

이 기능이 들어가면 유용성이 크게 올라간다.

- 토픽 제목/본문 검색
- 태그 필터
- 최근 활동순 정렬
- "결론 없는 주제"만 보기
- 특정 모델이 참여한 토론만 보기
- 특정 워크스페이스의 상위 논쟁 주제 보기

여기서 중요한 점은 전체 transcript 검색보다 "요약 인덱스 검색"이 먼저여야 한다는 것이다.

## 추천 구현 순서

### 1단계

- 기존 세션 저장
- topic 생성 / 조회
- session을 topic에 연결
- session 종료 시 summary 생성

### 2단계

- session 요약에서 key thread 추출
- open questions / action items 자동 생성
- topic board 목록 화면 또는 MCP 조회 도구 제공

### 3단계

- 유사 주제 병합 추천
- 중복 논쟁 탐지
- topic 간 링크 그래프
- "이전 결론을 뒤집는 새 근거" 감지

## 구현 기술 제안

권장 스택:

- Node.js + TypeScript
- MCP SDK
- CLI subprocess 래핑

이유:

- 두 CLI 모두 로컬 프로세스로 호출하기 쉽다.
- Windows 환경에서 subprocess 제어가 비교적 단순하다.
- Gemini extension과의 재사용도 쉽다.

## 참가자 실행 정책

오케스트레이터와 참가자는 같은 프로세스가 아니다. 서버는 참가자를 "발언 전용 subprocess" 로 실행해야 한다.

### Claude participant 권장 실행 원칙

- `--resume` 또는 `--continue` 로 같은 세션 유지
- `--model` 로 명시적 모델 선택
- `--output-format json` 또는 `--json-schema` 사용
- `--tools ""` 로 built-in 도구 비활성화
- `--strict-mcp-config` 로 상위 MCP 설정 상속 차단

### Gemini participant 권장 실행 원칙

- `--resume` 로 같은 세션 유지
- `--model` 로 명시적 모델 선택
- `--output-format json` 사용
- 전용 policy 파일로 MCP 도구와 불필요한 실행형 도구 deny

이 원칙을 지키면 오케스트레이터가 Claude이든 Gemini이든, 자식 참가자가 다시 도구를 호출해 자기 자신을 재귀적으로 증식시키는 문제를 크게 줄일 수 있다.

## 구현 우선순위

### 1차 MVP

- 로컬 MCP 서버 1개
- `claude` / `gemini` 비대화형 호출
- 모델 선택
- 기본 모델
- `maxTurns`
- 세션 resume ID 저장
- transcript 저장

### 2차

- rolling summary 압축
- 발언 스타일 조절
- moderator prompt
- 종료 시 자동 결론 도출

### 3차

- Gemini extension 패키징
- Claude plugin 패키징
- 웹 UI 또는 TUI

## 현재 판단

현재 요구사항과 추가 요구를 함께 만족하는 방향은 다음 한 줄로 정리된다.

`로컬 MCP 서버를 상태의 단일 소스로 두고, 어떤 MCP 클라이언트가 호출하더라도 같은 tool/resource 계약으로 claude/gemini 세션을 resume 하며 오케스트레이션한다.`

워크스페이스 보드 요구까지 포함하면 아래로 확장된다.

`MCP 서버가 실시간 토론 오케스트레이터이면서 동시에 워크스페이스별 토론 게시판/이슈 트래커 역할도 수행하게 만든다.`

## 참고 근거

- Claude Code MCP 문서: https://docs.anthropic.com/en/docs/claude-code/mcp
- Claude Code CLI reference: https://docs.anthropic.com/en/docs/claude-code/cli-reference
- Claude Agent SDK sessions: https://platform.claude.com/docs/en/agent-sdk/sessions
- Model Context Protocol specification: https://modelcontextprotocol.io/specification/2025-06-18
- Model Context Protocol roots: https://modelcontextprotocol.io/specification/draft/client/roots
- Gemini CLI extension guide: https://geminicli.com/docs/extensions/writing-extensions/
- Gemini CLI extension reference: https://geminicli.com/docs/extensions/reference/
- Gemini CLI MCP guide: https://geminicli.com/docs/tools/mcp-server/
- Gemini CLI session management: https://geminicli.com/docs/cli/session-management/
- Gemini CLI model selection: https://geminicli.com/docs/cli/model/
- Gemini CLI policy engine: https://geminicli.com/docs/reference/policy-engine
