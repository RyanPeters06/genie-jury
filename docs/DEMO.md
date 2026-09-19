# Genie Jury demo runbook

## Start locally

```bash
npm install
copy .env.example .env.local
copy .dev.vars.example .dev.vars
npm run dev:full
```

Open `http://127.0.0.1:5173`. The app should show **CONNECTED** once the Worker health check succeeds on port 8790. If a provider is missing, the interface remains usable and reports the fallback honestly.

To run the opt-in provider verification (it consumes a small amount of API usage):

```bash
$env:LIVE_API_SMOKE=1
npm run smoke:live
```

## 90-second narrative

> “Before this hackathon, I spent too long asking chatbots if my ideas were good. They were helpful, but too agreeable. Genie Jury is the honest teammate I wanted: four genies make me prove an idea before I build it.”

1. Enter the sky and start a short pitch about a bold, testable idea.
2. Let Gale identify the most dangerous claim and show an evidence state.
3. Advance through Ember's scope cut, Tide's user challenge, and Volt's memorable roast.
4. Close on the Ally's smallest credible next build.

## Sponsor story

- **OpenAI + Codex:** realtime transcription, structured claim extraction, and implementation support.
- **Browserbase:** Gale collects inspectable external evidence rather than inventing validation.
- **ElevenLabs:** distinct juror delivery makes the live interaction feel performed rather than read.
- **Multi-agent framing:** four roles receive the same pitch but challenge different unresolved questions.

## Manual acceptance checklist

- The four sprites have clean transparent edges over the daytime stage.
- Idle and speaking poses switch only for the active juror.
- Typed pitch works with every provider disabled.
- Voice denial returns to typed fallback without losing the pitch.
- Connected mode creates a session, returns evidence status, and plays at most one juror voice.
- No key, raw audio, or Browserbase session URL is visible in the browser or repository.
