# Architecture — local and deploy-ready

## Runtime topology

```text
Vite browser (5173) -> local Jury Worker (8790) -> OpenAI / ElevenLabs
                                           -> local research runner (8788) -> Browserbase
```

The Worker owns sessions, validates requests, protects provider credentials, and normalizes evidence. The research runner is a local Node process because Browserbase cloud-browser control uses CDP/Playwright and does not belong in the browser or an edge-only runtime. Nothing in this repository is publicly deployed by default.

## Provider responsibilities

| Provider | Purpose | Client exposure |
| --- | --- | --- |
| OpenAI Realtime | Builder transcription through a short-lived token. | Ephemeral token only. |
| OpenAI Responses | Strict claim extraction and juror deliberation. | Never exposes the key. |
| Browserbase | Gale's live research browser and evidence capture. | Only normalized evidence. |
| ElevenLabs | One streamed juror voice at a time. | Proxied audio only. |

## Environment boundaries

`VITE_JURY_API_URL` is the only browser-visible configuration. `OPENAI_API_KEY`, `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, `ELEVENLABS_API_KEY`, voice IDs, and local-runner settings belong in ignored `.dev.vars`. No raw microphone audio is sent to or stored by the Worker; finalized text is the only transcript payload retained in a session.

## API contract

- `GET /health` reports Worker availability.
- `GET /health/services` reports safe service states without values or keys.
- `POST /sessions` creates a short-lived pitch session.
- `POST /sessions/:id/events` accepts finalized transcript and stage events.
- `POST /sessions/:id/realtime-token` mints a short-lived OpenAI token.
- `POST /sessions/:id/research` returns normalized claim and evidence data.
- `POST /sessions/:id/juror-audio` streams validated ElevenLabs audio for one approved juror line.

Sessions retain final pitch text, event history, structured claims, and normalized evidence. They never retain raw audio, credentials, or full Browserbase connection URLs.
