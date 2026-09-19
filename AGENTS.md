# Genie Jury agent guide

## Read this first

Genie Jury is a hackathon pitch arena, not a generic chatbot. A builder pitches an idea to four cloud-seated jurors who challenge the idea, research claims, and end with a constructive recovery plan. The desired feeling is playful pressure, honest feedback, and a memorable live demo.

## Product rules

- The pitch stage is a bright daytime sky; the four jurors dominate the screen.
- The supplied sprite sheet is the visual source of truth. Do not regenerate, restyle, or replace the characters. Idle uses the upper row; speaking uses the matching lower row.
- Gale may report only verified, contested, or unproven evidence. Never invent research receipts.
- Keep the live pitch screen minimal: jurors, speaker cues, one line of transcript, and essential controls.
- The Ally is constructive after the jury challenges the builder.

## Jurors

| Juror | Role | Job |
| --- | --- | --- |
| Ember | The Builder | Scope, dependencies, and shipping reality. |
| Gale | The Skeptic | Risky factual claims and research evidence. |
| Tide | The User | User urgency, alternatives, and switching behavior. |
| Volt | The Jester | A humane roast that exposes the clearest flaw. |

## Working locally

```bash
npm install
npm run dev:full
npm run build
npm run lint
npm run worker:typecheck
```

Copy `.env.example` to `.env.local` for the Vite-to-Worker URL. Keep service keys only in ignored `.dev.vars`; never print, commit, or put them in browser code. `README.md` links to the complete product, architecture, and demo documents.

## Guardrails

- Do not commit `.env.local`, `.dev.vars`, recordings, service responses containing credentials, or Browserbase session URLs.
- Do not deploy or create cloud resources unless the user explicitly asks.
- Preserve deterministic/browser fallbacks when a sponsor service is unavailable.
- Build, lint, and typecheck before each logical commit; push complete milestones only.
