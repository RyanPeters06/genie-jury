# Genie Jury agent guide

## Read this first

Genie Jury is a live pitch arena, not a chatbot. A builder pitches out loud and
four specialist agents challenge the idea, research claims in a real browser,
argue with each other, and end with a constructive plan. The feeling to protect
is playful pressure, honest evidence, and a demo that holds a room.

Start with [docs/MULTI-AGENT.md](docs/MULTI-AGENT.md). The collaboration is the
product; the sky is the stage it happens on.

## Product rules

- The stage is a bright daytime sky and the four jurors dominate it. Panels sit
  at the edges and stay quiet until an agent actually does something.
- The supplied sprite sheet is the visual source of truth. Do not regenerate,
  restyle, or replace the characters. The upper row is listening, the lower row
  is speaking.
- **Never invent evidence.** A claim is verified, contested, or unproven, and an
  agent may only describe research a tool actually performed. This rule outranks
  everything else, including a better-sounding line.
- Browserbase must be legible on stage. When a browser is open the audience
  should know it is real, whose it is, and what it found.
- The Ally is constructive. The jurors may be sharp, never cruel.
- The mic stays open all session. Interruption works in both directions.

## The cast

| Juror | Role | Job |
| --- | --- | --- |
| Ember | The Builder | Scope, feasibility, and the smallest demo that proves value. |
| Gale | The Skeptic | Risky factual claims, checked in a live browser. Owns the browser. |
| Tide | The User | Who hurts, what they do today, what would make them switch. |
| Volt | The Jester | One humane roast that names the flaw everyone is circling. |

Plus the **Bailiff**, which decomposes the pitch and never speaks, and the
**Ally**, which synthesises and never argues.

Personalities live in one place: `JURORS` in `server/swarm/agents.ts`. Each
profile carries a mandate, a voice description, an explicit list of things that
juror never does, and its allowed ElevenLabs audio tags. Change a personality
there and it changes everywhere, including the voice delivery.

## Layout

```
server/
  index.ts        HTTP API and routing
  sessions.ts     session store and the Server-Sent Event fan-out
  browserbase.ts  Search API, live browser sessions, Stagehand
  elevenlabs.ts   per-juror voices and delivery profiles
  openai.ts       realtime secrets and live interjections
  swarm/
    types.ts      shared vocabulary
    ledger.ts     the blackboard, message bus, and run tree
    llm.ts        OpenAI adapter with a bounded tool loop
    tools.ts      what each agent can actually do
    agents.ts     personalities, investigation, speaking, voting
    deliberate.ts the swarmflow
src/
  App.tsx         the stage and the conversation loop
  lib/realtime.ts one microphone, open all session
  components/     Browserbase dock, jury room trace
```

## Working locally

```bash
npm install
cp .env.example .env.local
npm run dev:full      # Vite 5174, jury API 8790
npm run typecheck
npm run build
npm run lint
npm test
npm run demo:jury     # a full deliberation printed to the terminal
```

Vite uses 5174 to avoid the ordinary Vite port. The Node API defaults to 8790;
set `PORT` and `VITE_JURY_API_URL` together if another checkout is running.

## Guardrails

- Never commit `.env.local`, recordings, screenshots, or Browserbase session
  URLs. Never print a key.
- Keep the deterministic fallbacks working. With no keys at all, the whole flow
  must still run.
- Every new browser or model call needs a timeout. One hung request blocks the
  queue the jurors share and freezes the panel in front of an audience.
- Treat input validation as part of the product: never deliberate on an empty
  turn, greeting, mic check, or obvious side conversation. Return a clear,
  actionable prompt and preserve the builder's place instead of fabricating a
  verdict.
- Every screen needs an obvious recoverable exit. Setup screens have a back
  route, **Esc** exits an in-progress session safely, and provider failures
  must offer a usable fallback rather than a dead-end overlay.
- Build, lint, typecheck, and run `npm run demo:jury` before each logical commit.
- Do not deploy or create cloud resources unless asked.
