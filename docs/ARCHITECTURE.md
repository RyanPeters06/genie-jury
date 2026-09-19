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

## Browserbase

Three capabilities, chosen per agent:

- **Search API** — real titles and URLs for a query. Fast enough for any agent
  to use freely, about 0.4s.
- **Live browser session** — a cloud Chrome the audience watches through its
  live-view URL, embedded on stage. Used to open a source, read it, and
  screenshot it. About 3s to open, 2s per page.
- **Stagehand** — natural-language actions on the open page when the answer is
  behind a click: dismiss the cookie wall, open pricing, expand the reviews.

When an OpenAI key is present the session is launched by Stagehand so its
extension is installed and actions work. Without one, the session is created
through the REST API and driven over CDP instead, which still gives the live
view, the page text, and screenshots. The jurors share one browser and their use
of it is serialised, so the live view always shows one coherent story.

## Voices

Each juror has its own ElevenLabs voice and its own delivery profile: stability,
similarity, style, and speed tuned to the personality. Lines are written for
Eleven v3, which performs inline audio tags such as `[laughs]` and `[pauses]`.
Jurors may only use tags from their own whitelist, at most two per line, and
anything else in brackets is stripped before the text reaches the API. If v3 is
unavailable the request falls back to Multilingual v2 with the tags removed, so
the jury never goes silent.

Eleven v3 requests deliberately omit `previous_text` and `next_text`: that
model rejects both fields. If the fallback v2 model is used, the server may pass
them after stripping delivery tags.

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

## Security boundaries

`VITE_JURY_API_URL` is the only browser-visible configuration. API keys live in
ignored `.env.local` and never leave the server. The API allows only the local
dev origins plus an explicit `PUBLIC_APP_ORIGIN`. Juror audio requests are
bounded in length and restricted to known jurors. Browserbase session IDs are
exposed to the stage only as the live-view URL needed to render the iframe, and
sessions are explicitly released when the verdict lands.
