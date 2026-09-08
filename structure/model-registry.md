---
created: 2026-09-09
tags: [cli-jaw, architecture, model-registry]
aliases: [model registry, 모델 레지스트리, live model discovery]
---

# Model registry and live discovery

> 어느 런타임의 모델 목록이 관측에서 오고 어느 것이 손으로 유지되는지, 그리고
> 모델별 effort 사다리가 어디서 좁혀지는지를 기술한다. 런타임 선택과 transport는
> [runtime integration](runtime-integration.md)이, 설정 표면은
> [server API](server_api.md)가 소유한다.

## 두 개의 층

모델 목록에는 정적 층과 라이브 층이 있다.

정적 층은 `src/cli/registry.ts`의 `CLI_REGISTRY`다. 모든 런타임의 기본 모델,
기본 effort, 그리고 프로브가 실패했을 때 쓰는 폴백 목록을 담는다. 이 층은 CLI를
실행하지 않고 네트워크도 쓰지 않으므로 항상 답한다.

라이브 층은 `src/cli/registry-live.ts`의 `buildLiveCliRegistry()`다. 런타임 소스를
읽어 정적 층 위에 덮어쓴다. 소스가 없거나 실패하면 정적 층이 그대로 남는다.

이 순서가 계약이다. **라이브 실패가 모델 선택 불가로 이어지면 안 된다.** 빈 목록을
덮어쓰면 `CodeSessionManager.validate`가 모든 모델을 거부하므로, 라이브 결과가
비어 있으면 병합하지 않는다.

## 런타임별 소스

| 런타임 | 라이브 소스 | 구현 |
|---|---|---|
| `codex` / `codex-app` | opencodex `GET /v1/models` | `src/cli/opencodex-models.ts` |
| `kiro-code` | `kiro-cli chat --list-models --format json` | `src/agent/kiro-models.ts` |
| `claude` / `claude-e` | 정적 (`src/cli/claude-models.ts`) | — |
| `cursor` | 정적 (`CURSOR_REGISTRY_MODELS`) | — |
| `grok` | 정적 | — |
| `agy` / `pi` / `opencode` | 정적 | — |

정적으로 남은 런타임도 발견 가능한 소스를 갖고 있다: `cursor-agent --list-models`와
`grok models`가 그것이다. 이들을 라이브 층으로 옮기는 것이 현재 진행 중인 작업이다.

## effort는 모델별로 좁힌다

opencodex는 모델마다 **다른** effort 집합을 광고한다. `gpt-5.6-sol`은 `ultra`까지
가고 `gpt-5.6-luna`는 `max`에서 멈추며, 라우팅된 `anthropic/*`는 effort를 아예
받지 않는다. 선택된 값은 그대로 wire에 실리므로
(`-c model_reasoning_effort=`, `src/agent/args.ts`), 소비자는 union이 아니라
모델별 집합으로 좁혀야 한다.

`registry-live.ts`가 이를 `effortsByModel`과 `defaultEffortByModel`로 노출한다.
`efforts`는 legacy 소비자를 위한 union으로 남지만, 그것을 그대로 쓰면 실제 사고가
난다: `gpt-5.6-sol`은 codex와 kiro 양쪽에 존재하는데 Kiro는
`low/medium/high/xhigh`만 받는다. 그래서 `ai-e`는 provider별로 다시 나눈
`effortsByModelByProvider`를 쓴다.

빈 union으로 넓히지 않는 규칙도 여기에 속한다. 모든 모델이 라우팅된 카탈로그에서는
union이 비는데, 그것을 그대로 반영하면 effort 컨트롤이 통째로 사라진다.

## Claude ultracode

`ultracode`는 Anthropic API의 effort 값이 아니라 Claude Code의 세션 설정이다.
Claude Code는 `/effort ultracode`를 받으면 effort를 `xhigh`로 정규화하고
`settings.ultracode = true`를 따로 전달한다. 그래서 cli-jaw도 같은 모양을 지켜야
한다: 사용자에게는 하나의 티어로 보이되, wire에는 xhigh와 플래그가 각각 나간다.

Claude Code 자신이 세 가지 조건을 요구한다. dynamic workflows가 켜져 있어야 하고,
모델이 xhigh를 지원해야 하며, 조직 정책이 xhigh를 막지 않아야 한다. 따라서
ultracode는 xhigh 가능한 모델에만 노출한다.

## 새 모델이 도착할 때

opencodex는 새 모델 도착을 명시적으로 다룬다
(`src/providers/new-model-policy.ts`). 기준선과 비교해 새 id를 찾고, 사라진 id는
연속 세 번 관측되지 않아야 제거한다. 한 번의 실패한 조회가 모델을 지우지 않게 하는
유예 장치다.

cli-jaw는 그보다 단순한 규칙을 쓴다. 성공한 프로브의 결과를 그대로 채택하고,
실패하면 이전 스냅샷을 유지한다. degraded 프로브가 정적 목록을 돌려주면 기존 라이브
스냅샷을 덮어쓰지 않는다 (`src/code-mode/providers/live-models.ts`).

## 기본값은 라이브로 바뀌지 않는다

`defaultModel`과 `defaultEffort`는 정적으로 남는다. `buildDefaultPerCli()`가
이 값으로 사용자 설정을 시드하므로, 라우팅 순서 변화가 사용자의 기본 런타임을 조용히
바꾸면 안 된다. 예외는 하나다: 라이브 카탈로그가 더 이상 제공하지 않는 기본값은 첫
세션에서 `validate()`에 걸리므로, 그때는 라이브 목록의 첫 모델로 물러선다.

## 관련 문서

- [runtime integration](runtime-integration.md) — transport 선택과 native adapter
- [server API](server_api.md) — `/api/cli-registry`, `/api/cli-status`
- [commands](commands.md) — 슬래시 커맨드에서의 모델 선택
