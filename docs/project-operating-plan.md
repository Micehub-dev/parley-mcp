# Parley Project Operating Plan

## 1. PM 관점의 프로젝트 정의

### 제품 목표

Parley의 1차 목표는 `Codex`, `Claude`, `Gemini` 중 어느 클라이언트가 오케스트레이터가 되더라도 같은 계약으로 멀티 에이전트 토론을 시작, 진행, 재개, 종료할 수 있는 `orchestrator-agnostic MCP server`를 만드는 것이다.

### 성공 조건

- 토론 세션의 시작, 진행, 종료가 도구 계약 기준으로 안정적으로 재현된다.
- `lease + stateVersion` 기반 동시성 제어가 실제 운영에서 충돌 없이 동작한다.
- `claude` / `gemini` CLI 참가자 래퍼가 동일한 세션 계약 하에 교체 가능하다.
- 워크스페이스 단위로 토픽, 스레드, 결론, 오픈 질문을 축적할 수 있다.
- 이후 `plugin`, `extension`, `UI`, `search`, `memory`, `analytics`로 확장 가능한 정보 구조를 초기에 망치지 않는다.

### 이번 분기의 산출물

- MVP MCP 서버
- 세션/토픽 저장 구조
- Claude/Gemini 참가자 어댑터 1차
- moderator prompt 및 structured output 체계
- topic board / summary / search 기반의 운영 최소 기능

## 2. 반드시 남겨야 할 소통 문서

PM 관점에서는 문서를 많이 만드는 것보다, 의사결정과 리스크가 사라지지 않도록 최소 문서를 꾸준히 유지하는 편이 중요하다. 이 프로젝트에서 유지해야 하는 문서는 아래 8개다.

### A. Product Brief

목적: 왜 이 프로젝트를 하는지, 누구를 위한 것인지, 무엇을 하지 않을지 고정한다.

필수 항목:

- 문제 정의
- 사용자 유형: Codex 사용자, Claude Code 사용자, Gemini CLI 사용자, 내부 운영자
- 핵심 가치 제안
- non-goals
- 성공 지표

권장 위치:

- `docs/product-brief.md`

### B. MCP Contract Spec

목적: 팀 전체가 `tool/resource/prompt` 계약을 같은 언어로 보게 만든다.

필수 항목:

- 각 tool의 입력/출력 스키마
- 상태 전이 규칙
- 오류 코드/오류 메시지 원칙
- idempotency 규칙
- lease/stateVersion 규칙
- resource/prompt 공개 범위

권장 위치:

- `docs/mcp-contract-spec.md`

### C. Sprint Brief

목적: 이번 스프린트에서 무엇을 끝내는지와 무엇을 의도적으로 미루는지 명확히 한다.

필수 항목:

- sprint goal
- committed scope
- stretch scope
- exit criteria
- owner
- dependencies

권장 위치:

- `docs/sprints/YYYY-Sprint-N.md`

### D. Weekly Status Report

목적: 바쁜 주에도 팀과 이해관계자가 프로젝트 상태를 3분 안에 파악하도록 한다.

필수 항목:

- green / yellow / red 상태
- 지난주 완료
- 이번주 계획
- blocker
- 의사결정 필요 항목

권장 위치:

- `docs/status/weekly-YYYY-MM-DD.md`

### E. Decision Log

목적: “왜 그렇게 했는지”를 잃지 않는다. 특히 MCP 확장, 저장 구조, participant isolation 같은 주제는 반드시 남겨야 한다.

필수 항목:

- 결정 제목
- 결정일
- 배경
- 선택지
- 최종 결정
- 영향

권장 위치:

- `docs/decisions/ADR-xxxx-title.md`

### F. Risk Register

목적: 일정 지연보다 더 큰 문제인 구조적 리스크를 조기에 관리한다.

필수 항목:

- risk description
- probability
- impact
- mitigation
- owner
- target review date

권장 위치:

- `docs/risk-register.md`

### G. Integration Test Matrix

목적: 어떤 조합이 실제로 동작하는지를 명확히 관리한다.

필수 항목:

- orchestrator 종류
- participant 조합
- OS
- transport
- expected behavior
- test status

권장 위치:

- `docs/test-matrix.md`

### H. Release Checklist

목적: “기능은 됐는데 운영 준비가 안 된 상태”로 배포하지 않게 막는다.

필수 항목:

- backward compatibility
- migration 여부
- observability
- docs update
- sample configs
- rollback plan

권장 위치:

- `docs/release-checklist.md`

## 3. 소통 리듬과 회의 운영

### 일일 운영

- Daily async update: 매 영업일 오전 10시 KST까지
- 형식: 어제 한 일 / 오늘 할 일 / blocker 1줄
- 채널: 팀 채팅 + 주간 status 문서 반영

### 주간 운영

- 월요일: sprint planning, 45분
- 수요일: architecture / risk review, 30분
- 금요일: demo + retro, 45분

### 격주 운영

- stakeholder review, 30분
- 범위: 일정, 위험, 다음 스프린트 진입 조건, 확장 의사결정

### 문서 원칙

- 회의가 끝나면 반드시 한 문서만 source of truth로 남긴다.
- 구두 결정은 24시간 내 decision log로 승격한다.
- “누가 owner인지 모르는 일”은 backlog에 올리지 않는다.

## 4. 우선순위 관리 원칙

이 프로젝트는 일반적인 기능 앱이 아니라 “계약 안정성”이 제품성보다 먼저 와야 한다. 그래서 우선순위는 `사용자 가치`보다 먼저 `프로토콜 신뢰성`을 본다.

### 우선순위 계층

#### P0. 계약 안정성

출시를 막는 항목이다.

- 세션 state 정합성
- lease 충돌 방지
- stateVersion mismatch 처리
- participant 결과 스키마 검증
- resume/replay 안전성
- 파일 저장 손상 및 복구 전략

#### P1. 기본 사용자 가치

MVP 완성도를 좌우한다.

- `debate_start`, `debate_step`, `debate_finish` end-to-end
- `claude` / `gemini` subprocess 래핑
- rolling summary
- topic 연결
- structured conclusion 생성

#### P2. 운영 효율

처음 고객이 생기면 빨리 필요해진다.

- 검색
- topic board
- open questions / action item 자동 생성
- audit trail
- 운영자용 진단 도구

#### P3. 확장성과 채널 확장

있으면 좋지만 MVP를 막지 않는다.

- Gemini extension packaging
- Claude plugin packaging
- Web UI / TUI
- ranking / recommendation
- cross-topic graph

### backlog 운영 규칙

- 한 스프린트에서 P0 미해결 항목이 남아 있으면 새로운 P2/P3를 받지 않는다.
- 새로운 요청은 `Now / Next / Later` 세 버킷으로 먼저 분류하고, 그 다음 P0-P3를 부여한다.
- 우선순위가 갈릴 때는 다음 순서로 판단한다.

1. 데이터 손상 가능성이 있는가
2. 여러 클라이언트 간 계약 불일치를 만드는가
3. 재현 가능한 데모를 막는가
4. 운영자가 수동 개입해야 하는가
5. 나중에 구조 변경 비용이 커지는가

## 5. 일정 운영 방식

기준일은 `2026-03-12`이고, 이후는 2주 스프린트로 운영한다. 현재 저장소 초기화와 TypeScript MCP 서버 골격은 Sprint 0 범위의 일부가 이미 진행된 상태로 본다.

### Sprint 0: Bootstrap

기간: `2026-03-12` ~ `2026-03-20`

목표:

- 저장소 초기화
- TypeScript MCP 서버 골격
- 기본 저장 구조 확정
- PM/설계/리스크 문서 틀 만들기

완료 조건:

- `npm run build` / `npm run typecheck` green
- 기본 MCP tools 호출 가능
- 운영 문서의 source-of-truth 위치 확정

### Sprint 1: Core Session Engine

기간: `2026-03-23` ~ `2026-04-03`

목표:

- 세션 lifecycle 완성
- `debate_start`, `debate_state`, `debate_claim_lease`, `debate_finish` 안정화
- state schema 고정
- 오류 모델 정의

완료 조건:

- 상태 전이 테스트 통과
- lease 충돌 시나리오 재현 가능
- contract spec 1.0 작성

### Sprint 2: Participant Adapter MVP

기간: `2026-04-06` ~ `2026-04-17`

목표:

- `claude` / `gemini` subprocess adapter 연결
- structured participant response 강제
- resume ID 저장 및 재사용

완료 조건:

- 실제 CLI 호출 기반 `debate_step` 동작
- participant output validation green
- adapter failure fallback 정책 문서화

### Sprint 3: Moderation and Summary

기간: `2026-04-20` ~ `2026-05-01`

목표:

- moderator prompt
- rolling summary
- session 종료 시 conclusion / disagreement / open question 자동 정리

완료 조건:

- 긴 세션에서도 prompt 크기 제어 가능
- summary 품질 기준 정의
- 종료 시 human-readable summary 산출

### Sprint 4: Workspace Memory and Topic Board

기간: `2026-05-04` ~ `2026-05-15`

목표:

- topic 생성/조회/연결
- thread 추출
- canonical summary 승격
- workspace 단위 검색 가능 최소 구조

완료 조건:

- topic board metadata 유지
- session과 topic 링크 무결성 검증
- 검색/목록 시나리오 데모 가능

### Sprint 5: Reliability and Operator Tooling

기간: `2026-05-18` ~ `2026-05-29`

목표:

- audit log
- operator diagnostics
- replay / recovery 절차
- 통합 테스트 매트릭스 운영

완료 조건:

- 실패 케이스 복구 runbook 작성
- 운영자 관찰성 확보
- 최소 3개 orchestrator scenario 검증

### Sprint 6: Packaging and External Surfaces

기간: `2026-06-01` ~ `2026-06-12`

목표:

- Gemini extension / Claude plugin 방향성 정리
- Web UI 또는 TUI 진입 설계
- release candidate 준비

완료 조건:

- 확장 surface 문서화
- 배포 체크리스트 충족
- RC demo 가능

## 6. 스프린트별 Epic 분해

### Epic 1. Core Orchestration

범위:

- session model
- lifecycle
- lease
- versioning
- error handling

완료 기준:

- 어떤 orchestrator가 호출해도 동일한 session semantics 유지

### Epic 2. Participant Runtime

범위:

- `claude` adapter
- `gemini` adapter
- resume semantics
- output normalization

완료 기준:

- adapter 차이가 상위 tool 계약에 노출되지 않음

### Epic 3. Knowledge Persistence

범위:

- topic
- thread
- decision
- summary
- search index

완료 기준:

- “지난번 결론이 뭐였지?”를 세션 밖에서 바로 찾을 수 있음

### Epic 4. Operator Experience

범위:

- logs
- diagnostics
- repair tooling
- test matrix

완료 기준:

- 운영자가 실패 원인을 수동 추적하지 않아도 됨

### Epic 5. Ecosystem Expansion

범위:

- plugin / extension
- transport expansion
- UI
- analytics

완료 기준:

- MCP core를 깨지 않고 외부 채널로 확장 가능

## 7. MCP 확장 요구사항 분석

초기 설계는 이미 좋다. 다만 장기적으로는 단순한 tool 묶음이 아니라 `stateful collaboration platform`으로 확장할 수 있어야 한다. 그래서 MCP 확장은 아래 7개 축으로 관리해야 한다.

### 7.1 Session State Machine 확장

현재 필요한 것:

- `debate_start`
- `debate_state`
- `debate_claim_lease`
- `debate_step`
- `debate_finish`

다음 확장:

- `debate_resume`
- `debate_abort`
- `debate_release_lease`
- `debate_rewind_step`
- `debate_reconcile_state`

요구사항:

- idempotent retry
- stale lease 처리
- partial failure after subprocess completion
- step 중간 실패 복구

### 7.2 Participant Abstraction 확장

현재는 `claude`, `gemini` 두 참가자면 충분하지만, 실제 제품화 단계에서는 participant를 “벤더 이름”이 아니라 “capability contract”로 봐야 한다.

확장 방향:

- `participantKind` 추상화
- adapter capability discovery
- model-specific policy layer
- sandbox / tool denylist / permission profile

추가 요구사항:

- 참가자별 출력 차이를 normalization
- 참가자별 max context / retry / timeout 전략
- cost and latency metadata 수집

### 7.3 Structured Output and Moderation 확장

핵심은 자유 텍스트 대화를 저장하는 것이 아니라, “비교 가능한 주장 단위”를 남기는 것이다.

확장 방향:

- 주장 claim schema
- evidence schema
- disagreement schema
- moderator verdict schema
- confidence / uncertainty 필드

추가로 필요한 tool:

- `debate_extract_claims`
- `debate_score_consensus`
- `debate_generate_conclusion`

### 7.4 Workspace Knowledge Layer 확장

세션이 늘어나면 실제 가치의 중심은 실시간 토론이 아니라 축적된 지식 검색으로 이동한다.

확장 방향:

- topic graph
- canonical summary
- thread promotion
- duplicate topic detection
- open question tracking

추가로 필요한 tool/resource:

- `debate_search_topics`
- `debate_search_threads`
- `debate_link_topics`
- `debate_list_open_questions`
- resource: workspace digest
- resource: topic summary

### 7.5 Operator and Observability 확장

MCP 서버가 여러 orchestrator 아래서 돌기 시작하면, “왜 이 상태가 됐는지” 설명하는 기능이 제품 기능만큼 중요해진다.

확장 방향:

- event timeline
- audit trail
- correlation id
- subprocess stdout/stderr capture
- structured error taxonomy

추가 요구사항:

- session별 diagnostic bundle
- replay mode
- redaction policy

### 7.6 Security and Policy 확장

특히 Claude/Gemini 하위 프로세스를 띄우는 구조에서는 보안 요구사항이 뒤늦게 붙으면 비용이 커진다.

필수 요구사항:

- workspace boundary enforcement
- allowed roots 명시
- secret redaction
- participant tool restriction
- policy profile per orchestrator

추가로 필요한 기능:

- read-only mode
- approved command allowlist
- external network access policy

### 7.7 Distribution Surface 확장

MCP 코어는 유지하되, 배포 surface는 여러 개가 될 수 있다.

확장 방향:

- stdio transport
- streamable HTTP transport
- plugin/extension wrapper
- local desktop UI
- hosted coordination service

판단 원칙:

- 외부 surface는 thin wrapper여야 한다.
- 상태 소유권은 항상 코어 서버에 있어야 한다.
- surface별 custom UX는 허용하되, 계약은 fork하지 않는다.

## 8. 요구사항 우선순위 맵

### 지금 바로 요구되는 것

- session correctness
- lease/version correctness
- adapter isolation
- structured output validation
- summary persistence

### 6주 안에 필요한 것

- workspace search
- topic board
- operator diagnostics
- replay / recovery
- cross-client test matrix

### 그 다음 단계에서 필요한 것

- plugin / extension packaging
- web UI
- topic graph
- ranking / recommendation
- multi-workspace governance

## 9. 리스크와 대응

### 리스크 1. CLI 별 행동 차이로 contract가 흔들릴 수 있음

대응:

- adapter layer에서 normalization
- participant output schema 강제
- golden transcript test 유지

### 리스크 2. lease 충돌과 partial failure가 데이터 정합성을 깨뜨릴 수 있음

대응:

- step atomicity 정의
- append-only audit trail
- repair tool 제공

### 리스크 3. summary 품질이 낮으면 장기 기억 구조가 오히려 오염됨

대응:

- summary acceptance 기준 정의
- canonical promotion을 자동이 아닌 승인 가능한 단계로 운영

### 리스크 4. 너무 이른 UI 개발이 코어를 흔들 수 있음

대응:

- UI는 Sprint 6 이전에 thin wrapper 수준으로만 허용
- core contract freeze 전까지 UX 최적화 금지

## 10. 바로 실행할 다음 액션

### 이번 주 안에 할 일

- `docs/product-brief.md` 작성
- `docs/mcp-contract-spec.md` 초안 작성
- `docs/risk-register.md` 작성
- Sprint 1 brief 생성
- state transition test 목록 정의

### 다음 구현 우선순위

1. `debate_step`에 실제 participant subprocess 연결
2. output schema validator 추가
3. session/state error taxonomy 정리
4. contract spec과 코드 스키마 동기화

