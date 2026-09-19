# Genie Jury

**Pitch your idea. Face the jury.**

Genie Jury is a live, evidence-backed idea stress test for hackathon builders. Instead of a chatbot that validates every idea, four AI jurors interrogate its assumptions, research the real world, and hand the builder an actionable verdict.

## Current prototype

The local Vite app already contains the complete demo narrative:

1. A cinematic landing page introduces Ember, Gale, Tide, and Volt.
2. A builder enters a hackathon or startup pitch.
3. The jury arena presents each juror's challenge, including a visible evidence state.
4. The Ally delivers a constructive "salvage plan" and a shareable verdict.

Run it with:

```bash
npm install
npm run dev
```

## Product principle

Every challenge must be labelled as one of the following:

- **Verified** — supported by an inspectable source.
- **Contested** — credible sources conflict or the signal is inconclusive.
- **Unproven** — a critical claim that needs user research or a test.

This is the difference between a fun roleplay and an honest decision tool.

## Build plan

### Milestone 1 — cinematic prototype ✅

- Responsive React interface and original CSS-rendered genie characters.
- Hackathon/startup mode, pitch intake, deliberation arena, juror sequencing, and verdict flow.
- A deterministic fallback scenario so the demo cannot fail if a sponsor API is slow.

### Milestone 2 — evidence engine

- Use the OpenAI Responses API to extract testable claims from a pitch into structured JSON.
- A Browserbase worker opens targeted searches and primary sources for the three most important claims.
- Store a small evidence dossier: title, URL, source excerpt, capture time, confidence, and screenshot.
- Give Gale only sourced findings; never let it invent competitors or market facts.

### Milestone 3 — real Council coordination

- **Gale / Skeptic:** selects the most dangerous unsupported claim and requests research.
- **Ember / Builder:** tests time, dependencies, and technical scope.
- **Tide / User:** tests the specific user, alternative, and switching reason.
- **Volt / Jester:** turns the highest-signal flaw into a humane, memorable roast.
- **Moderator:** receives all deliberations, picks the next interruption, tracks unanswered questions, and asks the Ally for the smallest credible pivot.

For the Huawei submission, persist the agents' messages, evidence handoffs, and moderator decision so the coordination is demonstrable rather than described.

### Milestone 4 — live performance

- Capture pitch audio, transcribe it, and interrupt only at safe sentence boundaries.
- Give each juror a distinct ElevenLabs voice.
- Animate the active juror and surface a Browserbase evidence card while they challenge the pitch.
- Let the builder answer before the Moderator routes the next question.

### Milestone 5 — deployment and reliability

- Deploy the orchestration runtime to Cloudflare Workers.
- Use a Durable Object or D1 to retain the pitch, agent messages, evidence states, and final verdict for each session.
- Add Sentry tracing/logs around research and model calls; keep a static demo scenario as a fallback.

## Sponsor map

| Track | Meaningful use |
| --- | --- |
| OpenAI + Codex | Responses API runs structured claim extraction, deliberation, and Ally synthesis; Codex supports implementation/testing. |
| Browserbase | Gale researches pitch claims and returns inspectable evidence cards. |
| Huawei multi-agent | Separate role-specific agents exchange evidence through a moderator. |
| ElevenLabs | Jurors have responsive, character-specific voices. |
| Cloudflare | Worker-based orchestration and durable session memory. |
| Sentry | Trace the live research/model flow and use the findings to improve the app. |

## Demo script

> "Before this hackathon, I spent too long asking chatbots whether my ideas were good. They were helpful. They were also much too agreeable. So I built Genie Jury: four genies that make you prove your idea before you build it."

Pitch a deliberately bold claim. Let Gale interrupt with a Browserbase receipt. Let Volt make it funny. Close on the Ally's smallest next build.
