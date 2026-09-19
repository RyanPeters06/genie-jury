# Genie Jury

**Pitch your idea out loud. Four AI jurors interrupt you, open a real browser to check your claims, argue with each other, and hand you the smallest next thing worth building.**

Most builders ask a chatbot whether their idea is good and get a flattering answer. Genie Jury is the useful opposite: a live panel that pressure-tests a pitch the way a room of sharp people would, and refuses to claim evidence it did not actually gather.

## What happens in a session

1. **You pitch.** Your microphone opens once and stays open for the whole session.
2. **They cut in.** Say "nobody else is doing this" and Gale interrupts mid-sentence to say a browser is opening. Say "AI-powered" before naming a human and Volt will not let it pass.
3. **They split up.** A Bailiff agent breaks the pitch into claims and gives each juror a different angle so the four do not overlap.
4. **They actually research.** Gale opens a live cloud browser on screen, searches, opens the best source, screenshots it, and rules the claim verified, contested, or unproven. The other jurors file research requests that Gale services and reports back on.
5. **They argue.** Volt speaks last, having received every other juror's line, and builds on what they found instead of repeating it.
6. **You talk back.** Start speaking over any juror and they stop mid-sentence and answer you.
7. **The Ally lands it.** One scope cut, one claim to verify, one user test, one thing to build in the next four hours, and four votes.

Evidence is never invented. A claim is **verified**, **contested**, or **unproven**, and the source is on screen with a screenshot.

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run dev:full
```

Open http://localhost:5174. The intro screen shows which providers are live.

Every secret stays server-side in ignored `.env.local`. The browser bundle only ever sees `VITE_JURY_API_URL`, short-lived transcription tokens, normalised evidence, and audio.

## Useful commands

```bash
npm run dev:full            # Vite on 5174 and the jury API on 8790
npm run typecheck           # server and browser
npm run build
npm run lint
npm test
npm run demo:jury           # one pitch through the full swarm, printed as a report
node scripts/explore-browserbase.ts   # live check of every Browserbase capability
```

`npm run demo:jury` is the fastest way to see the collaboration without the UI. It prints the claims, who was assigned what, every tool call, every message between agents, the evidence with its sources, what each juror said, the verdict, and the run tree.

## How it is built

| Provider | What it does here |
| --- | --- |
| **OpenAI** | Realtime keeps the mic open and transcribes; Responses runs every agent, their tool loops, and all structured output. |
| **Browserbase** | Search API for real sources, live cloud browser sessions the audience watches, Stagehand for clicking through a page when the answer sits behind a cookie wall. |
| **ElevenLabs** | One expressive v3 voice per juror, with inline audio tags and per-juror delivery profiles. |

No agent framework. The swarm is roughly 700 lines of TypeScript, so every part of the collaboration is inspectable.

## Read next

- [Multi-agent design](docs/MULTI-AGENT.md) — the Bailiff, the shared ledger, the message bus, the run tree
- [Architecture](docs/ARCHITECTURE.md) — processes, API, provider boundaries, failure behaviour
- [Demo runbook](docs/DEMO.md) — the 90-second script and what to do when a provider misbehaves
- [Agent handoff guide](AGENTS.md)
