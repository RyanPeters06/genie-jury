# Architecture

## Processes

```
browser (Vite, 5174)
  |  mic audio  ──────────────────────────────►  OpenAI Realtime (WebRTC, direct)
  |  REST + Server-Sent Events
  v
jury API (Node, 8790)
  ├─► OpenAI Responses      agents, tool loops, structured output
  ├─► Browserbase           Search API, live browser sessions, Stagehand
  └─► ElevenLabs            one streamed juror voice at a time
```

Two processes, no build step on the server: Node runs the TypeScript directly.

Microphone audio never touches the jury API. The browser holds a short-lived
client secret minted server-side and streams audio straight to OpenAI over
WebRTC; only finalised text comes back through the app. The API keeps no audio
and no raw recordings.

## Why a single Node process

The live browser session, the agent driving it, and the event stream the stage
subscribes to live in one Node process. That is what makes the Browserbase live
view on stage possible while keeping provider credentials off the client.

## Session lifecycle

A session is one pitch. It holds the transcript, the deliberation ledger, the
interjection budget, the event history, and the Browserbase browser. Sessions
live in memory for six hours and are released explicitly when the verdict lands.

| Route | Purpose |
| --- | --- |
| `GET /health`, `GET /health/services` | availability, and which providers are configured (never values) |
| `GET /jurors` | the cast and their mandates |
| `POST /sessions` | start a pitch |
| `GET /sessions/:id/stream` | Server-Sent Events: every agent step, message, tool call, and browser event |
| `POST /sessions/:id/realtime-token` | mint a short-lived OpenAI transcription secret |
| `POST /sessions/:id/interject` | decide whether a juror cuts into the pitch right now |
| `POST /sessions/:id/deliberate` | run the whole swarm |
| `POST /sessions/:id/respond` | the builder answered a juror; that juror replies |
| `POST /sessions/:id/juror-audio` | stream one juror line as speech |
| `POST /sessions/:id/finish` | release the browser and close the session |

## The live event stream

Everything the swarm does is emitted as it happens: run-tree nodes opening and
closing, findings posted, evidence added, messages between agents, and every
browser action. The stage subscribes once and drives three things from it: the
Browserbase dock, the jury room trace, and the jurors speaking as soon as their
turn is ready rather than when the whole run finishes.

Events are numbered and replayed on reconnect, so a dropped connection mid-demo
catches up instead of losing the session.

### Pitch validity gate

Creating a voice session is allowed with an empty transcript, but deliberation
is not. Before agents, browser calls, or scoring begin, `POST /deliberate`
rejects empty input, a greeting/microphone check, and fragments that do not yet
describe an idea. It returns `422 invalid-pitch` with a short next-step message
and emits `pitch.invalid`; the client returns to pitching or the typed form and
keeps the session recoverable. A valid short idea is intentionally accepted —
this gate prevents false confidence, not unusual founders.

## Browserbase

Three Browserbase capabilities, deliberately split by owner and cost:

- **Search API** — real titles and URLs for a query. Any juror can use it for a
  quick lead, without opening a browser.
- **Fetch API** — Ember and Tide read ordinary pages in the background without
  queuing behind the on-stage browser. A thin JavaScript-rendered response
  falls back to a live capture rather than silently becoming bad evidence.
- **Live browser session** — Gale owns the single cloud Chrome the audience
  watches through its live-view URL. Gale opens sources, captures screenshots,
  and takes an interactive Stagehand pass on the first research call so the
  audience sees a real browser action, not just a loaded tab.
- **Stagehand** — natural-language actions on the open page when the answer is
  behind a click: dismiss the cookie wall, open pricing, expand the reviews.

When an OpenAI key is present the session is launched by Stagehand so its
extension is installed and actions work. Without one, the session is created
through the REST API and driven over CDP instead, which still gives the live
view, the page text, and screenshots. Gale remains the live-view owner, so the
stage always tells one coherent research story while Fetch keeps background
reading fast.

### Evidence honesty

Evidence is **verified**, **contested**, or **unproven**. Only the evidence
clerk assigns those statuses after adjudicating a claim against returned text.
A fetched, searched, or live page read without that judgement is an observation
and stays `unproven`; it cannot change a claim status. The stage also displays
whether the receipt was read LIVE, FETCHED, or found through SEARCH.

## Voices

Each juror has its own ElevenLabs voice and delivery profile. Eleven v3 handles
the showcase lines; it rejects `previous_text` and ignores numeric `speed`, so
its request shape deliberately omits both. If it is unavailable, the app falls
back to **Flash v2.5** with tags removed and its per-juror speed setting, so the
jury never goes silent. See [voice casting](VOICES.md) for the listening-pass
notes and the final cast.

## Failure behaviour

The stage must never hang and must never claim evidence it does not have.

- Every browser operation races a deadline, so a page that never settles is
  abandoned rather than waited on. Without this one hung page blocks the queue
  the jurors share and freezes the whole panel.
- Every model call has a request timeout and a deterministic fallback.
- The investigation stage has a hard deadline; if it overruns, the jury speaks
  from what is already on the ledger.
- With no keys at all, the full flow still runs end to end on scripted findings
  and the browser's own speech synthesis.
- A failed juror audio request falls back to browser speech rather than silence.
- Invalid input is a recoverable state, not an outage: no agent run, score, or
  invented verdict is produced. The UI explains what is missing and gives the
  builder a Back or Exit route.
- Ending before a verdict closes the microphone, cancels audio, releases the
  remote session, and returns to the welcome screen; only a completed session
  goes to the verdict screen.

## Security boundaries

`VITE_JURY_API_URL` is the only browser-visible configuration. API keys live in
ignored `.env.local` and never leave the server. The API allows only the local
dev origins plus an explicit `PUBLIC_APP_ORIGIN`. Juror audio requests are
bounded in length and restricted to known jurors. Browserbase session IDs are
exposed to the stage only as the live-view URL needed to render the iframe, and
sessions are explicitly released when the verdict lands.
