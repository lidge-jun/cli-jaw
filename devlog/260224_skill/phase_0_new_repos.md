# Phase 0 — 추가 스킬 레포 탐색 (2026-02-24)

> 기존 `skills_ref/` 54개와 **중복되지 않는** 유명 스킬 레포 & 개별 스킬 정리.

---

## 주요 레포 3대장

| 레포                                                                                  | ⭐ 규모                     | 특징                                                  |
| ------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------- |
| [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills)   | 380+ 스킬, 38 contributors | 가장 큰 커뮤니티. Claude/Codex/Gemini/Cursor 호환     |
| [ComposioHQ/awesome-codex-skills](https://github.com/ComposioHQ/awesome-codex-skills) | ~40 스킬                   | Codex 특화. Composio 앱 연동, 실무 워크플로 중심      |
| [openai/skills](https://github.com/openai/skills)                                     | 공식 Curated               | Codex 공식 카탈로그. 대부분 `skills_ref/`에 이미 있음 |

---

## 🏢 기업 공식 스킬 레포 (팀별)

### Anthropic (Claude 공식)
이미 `skills_ref/`에 대부분 포함. 누락 후보:

| 스킬                | 설명                     | 중복?    |
| ------------------- | ------------------------ | -------- |
| `algorithmic-art`   | p5.js 제너러티브 아트    | ❌ 새로움 |
| `canvas-design`     | PNG/PDF 시각 디자인      | ❌ 새로움 |
| `slack-gif-creator` | Slack용 GIF 생성         | ❌ 새로움 |
| `brand-guidelines`  | 브랜드 컬러/타이포 적용  | ❌ 새로움 |
| `internal-comms`    | 상태 보고서/뉴스레터/FAQ | ❌ 새로움 |

> 출처: [anthropics/skills](https://github.com/anthropics/skills)

### Vercel Engineering
| 스킬                    | 설명                     | 중복? |
| ----------------------- | ------------------------ | ----- |
| `react-best-practices`  | React 패턴/모범사례      | ❌     |
| `web-design-guidelines` | 웹 디자인 가이드라인     | ❌     |
| `composition-patterns`  | React 컴포넌트 합성 패턴 | ❌     |
| `next-best-practices`   | Next.js 권장 패턴        | ❌     |
| `next-cache-components` | Next.js 캐싱 전략        | ❌     |
| `next-upgrade`          | Next.js 버전 업그레이드  | ❌     |
| `react-native-skills`   | RN 성능 가이드           | ❌     |

> 출처: [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills), [vercel-labs/next-skills](https://github.com/vercel-labs/next-skills)

### Cloudflare
| 스킬                                | 설명                                   | 중복?                           |
| ----------------------------------- | -------------------------------------- | ------------------------------- |
| `agents-sdk`                        | 스테이트풀 AI 에이전트 빌드            | ❌                               |
| `building-mcp-server-on-cloudflare` | 리모트 MCP 서버 + OAuth                | ❌                               |
| `durable-objects`                   | RPC + SQLite + WebSocket               | ❌                               |
| `web-perf`                          | Core Web Vitals 감사                   | ❌                               |
| `wrangler`                          | Workers/KV/R2/D1/Vectorize/Queues 통합 | `cloudflare-deploy`와 일부 겹침 |

> 출처: [cloudflare/skills](https://github.com/cloudflare/skills)

### HuggingFace
| 스킬                         | 설명                          | 중복? |
| ---------------------------- | ----------------------------- | ----- |
| `hugging-face-cli`           | HF Hub CLI (모델/데이터셋/잡) | ❌     |
| `hugging-face-model-trainer` | TRL: SFT, DPO, GRPO, GGUF     | ❌     |
| `hugging-face-datasets`      | 데이터셋 관리 + SQL 쿼리      | ❌     |
| `hugging-face-evaluation`    | vLLM/lighteval 모델 평가      | ❌     |
| `hugging-face-trackio`       | ML 실험 추적 대시보드         | ❌     |

> 출처: [huggingface/skills](https://github.com/huggingface/skills)

### Trail of Bits (보안)
| 스킬                     | 설명                             | 중복? |
| ------------------------ | -------------------------------- | ----- |
| `static-analysis`        | CodeQL + Semgrep + SARIF         | ❌     |
| `differential-review`    | 보안 관점 diff 리뷰              | ❌     |
| `semgrep-rule-creator`   | Semgrep 룰 작성                  | ❌     |
| `insecure-defaults`      | 하드코딩된 시크릿/약한 암호 탐지 | ❌     |
| `property-based-testing` | 다언어 속성 기반 테스트          | ❌     |
| `modern-python`          | uv + ruff + ty + pytest 모범사례 | ❌     |

> 출처: [trailofbits/skills](https://github.com/trailofbits/skills)

### OpenAI 공식 (신규만)
| 스킬                      | 설명                                | 중복?                           |
| ------------------------- | ----------------------------------- | ------------------------------- |
| `security-best-practices` | 언어별 보안 취약점 리뷰             | ❌                               |
| `security-ownership-map`  | 파일별 소유자 매핑 + 버스팩터       | ❌                               |
| `security-threat-model`   | 리포별 위협 모델 생성               | ❌                               |
| `figma` (fetch-only)      | Figma에서 디자인 컨텍스트/에셋 추출 | `figma-implement-design`과 별도 |

> 출처: [openai/skills](https://github.com/openai/skills)

### fal.ai
| 스킬             | 설명                                        | 중복?                                      |
| ---------------- | ------------------------------------------- | ------------------------------------------ |
| `fal-generate`   | fal.ai 이미지/비디오 생성                   | `imagegen`/`nano-banana-pro`와 다른 플랫폼 |
| `fal-audio`      | fal.ai TTS/STT                              | `speech`/`transcribe`와 다른 플랫폼        |
| `fal-image-edit` | AI 이미지 편집 (스타일 전환, 오브젝트 제거) | ❌                                          |
| `fal-upscale`    | AI 업스케일링                               | ❌                                          |

> 출처: [fal-ai-community/skills](https://github.com/fal-ai-community/skills)

---

## 🌐 커뮤니티 인기 스킬 (개별)

### 생산성 / 협업
| 스킬                    | 레포                                                                                               | 설명                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `whatsapp`              | [gokapso/agent-skills](https://github.com/gokapso/agent-skills)                                    | WhatsApp 연동 (메시지 전송, webhook, 자동화) |
| `email-draft-polish`    | [ComposioHQ](https://github.com/ComposioHQ/awesome-codex-skills/tree/master/email-draft-polish)    | 이메일 초안 작성/톤 조절                     |
| `invoice-organizer`     | [ComposioHQ](https://github.com/ComposioHQ/awesome-codex-skills/tree/master/invoice-organizer)     | 인보이스 데이터 추출/정리                    |
| `support-ticket-triage` | [ComposioHQ](https://github.com/ComposioHQ/awesome-codex-skills/tree/master/support-ticket-triage) | 고객 티켓 분류/우선순위                      |
| `file-organizer`        | [ComposioHQ](https://github.com/ComposioHQ/awesome-codex-skills/tree/master/file-organizer)        | 파일 정리/이름 변경 자동화                   |
| `changelog-generator`   | [ComposioHQ](https://github.com/ComposioHQ/awesome-codex-skills/tree/master/changelog-generator)   | git commit → 체인지로그 생성                 |

### 개발 / 테스트
| 스킬               | 레포                                                                                           | 설명                               |
| ------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------- |
| `ios-simulator`    | [conorluddy/ios-simulator-skill](https://github.com/conorluddy/ios-simulator-skill)            | iOS 시뮬레이터 제어                |
| `video-downloader` | [ComposioHQ](https://github.com/ComposioHQ/awesome-codex-skills/tree/master/video-downloader)  | 영상 다운로드 (yt-dlp 등)          |
| `postgres`         | [sanjay3290/ai-skills](https://github.com/sanjay3290/ai-skills/tree/main/skills/postgres)      | PostgreSQL 읽기 전용 쿼리          |
| `deep-research`    | [sanjay3290/ai-skills](https://github.com/sanjay3290/ai-skills/tree/main/skills/deep-research) | Gemini Deep Research 에이전트 활용 |
| `kreuzberg`        | [kreuzberg-dev/kreuzberg](https://github.com/kreuzberg-dev/kreuzberg)                          | 62+ 포맷 텍스트/테이블 추출        |

### 에이전트 / 컨텍스트 엔지니어링
| 스킬                      | 레포                                                                                                                          | 설명                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `context-compression`     | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering) | 컨텍스트 압축 전략                                   |
| `memory-systems`          | 위와 동일                                                                                                                     | 단기/장기/그래프 메모리 아키텍처                     |
| `multi-agent-patterns`    | 위와 동일                                                                                                                     | 오케스트레이터/P2P/계층 패턴                         |
| `data-structure-protocol` | [k-kolomeitsev/data-structure-protocol](https://github.com/k-kolomeitsev/data-structure-protocol)                             | 그래프 기반 장기 메모리                              |
| `superpowers` (모음)      | [obra/superpowers](https://github.com/obra/superpowers)                                                                       | TDD, 디버깅, 서브에이전트, git worktrees 등 20+ 스킬 |

### 보안 / 특화
| 스킬               | 레포                                                                           | 설명                                     |
| ------------------ | ------------------------------------------------------------------------------ | ---------------------------------------- |
| `apple-hig-skills` | [raintree-technology](https://github.com/raintree-technology/apple-hig-skills) | Apple HIG 14개 스킬 (iOS/macOS/visionOS) |
| `home-assistant`   | [komal-SkyNET](https://github.com/komal-SkyNET/claude-skill-homeassistant)     | Home Assistant 워크플로 관리             |
| `clawsec`          | [prompt-security](https://github.com/prompt-security/clawsec)                  | 보안 스킬 (드리프트 탐지, 자동 감사)     |
| `aws-skills`       | [zxkane/aws-skills](https://github.com/zxkane/aws-skills)                      | AWS 인프라 자동화                        |
| `terraform`        | [hashicorp/agent-skills](https://github.com/hashicorp/agent-skills)            | HCL 코드/모듈/프로바이더 생성            |

---

## 📊 채택 우선순위 추천

### Tier 1 — 즉시 가져올 만한 것 (범용, 의존성 적음)
1. **`algorithmic-art`** — p5.js 아트 → `frontend-design`과 시너지
2. **`changelog-generator`** — git commit → 릴리스 노트. 매일 쓸 수 있음
3. **`security-best-practices`** — 코드 보안 리뷰, openai 공식
4. **`email-draft-polish`** — 이메일 작성/톤 조절
5. **`video-downloader`** — yt-dlp 래퍼, `video-frames`와 시너지
6. **`file-organizer`** — 파일 정리 자동화
7. **`modern-python`** — uv+ruff+pytest 모범사례 (TrailOfBits)

### Tier 2 — 프로젝트 성장 시
8. **`deep-research`** — 멀티스텝 리서치 에이전트
9. **`context-compression`** — 긴 세션 컨텍스트 관리
10. **`superpowers`** (obra) — TDD, 디버깅, 서브에이전트 패턴
11. **`whatsapp`** — 텔레그램 이후 메신저 확장 시
12. **`postgres`** — DB 쿼리 스킬
13. **`apple-hig-skills`** — Apple 앱 개발 시

### Tier 3 — 특정 기술 스택 사용 시
14. **Vercel/Next.js 시리즈** — Next.js 프로젝트 진행 시
15. **HuggingFace 시리즈** — ML 모델 학습/평가 시
16. **Trail of Bits 보안 시리즈** — 보안 감사 필요 시
17. **fal.ai 시리즈** — fal.ai 미디어 생성 시
18. **Terraform/AWS** — 인프라 자동화 시

---

## 체크리스트

- [x] 주요 레포 3곳 웹 탐색
- [x] 기존 54개 스킬과 중복 비교
- [x] 비중복 후보 정리 (기업 공식 + 커뮤니티)
- [x] 채택 우선순위 Tier 분류
- [ ] Tier 1 스킬 실제 다운로드 (별도 phase)
