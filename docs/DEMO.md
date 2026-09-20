# Demo runbook

## Before you walk up

```bash
npm run dev:full
```

Open http://localhost:5174 and check the intro screen's provider strip: four
green dots means OpenAI, Browserbase, ElevenLabs, and the jury API are all live.
If one is amber the demo still runs, but say so rather than hoping nobody
notices.

Use headphones or keep the laptop speakers low. The microphone stays open the
whole session, and although echo cancellation is on and there is a short guard
after each juror starts talking, a loud room speaker can still make a juror
interrupt itself.

Have a second pitch ready in case the first one gets a quiet jury.

## The pitch to give

Deliberately plant the hooks. This one reliably triggers an interruption, a
contested claim, and a scope cut:

> "Loop is a wearable that reads your emotions. Nobody else is doing this.
> Every therapist will want it. We use AI to detect stress from heart rate, and
> we also do journaling, and we also do social features."

- "Nobody else is doing this" → Gale cuts in and opens a browser.
- "Every therapist" → Tide asks which therapist, and what they do today.
- "and we also… and we also…" → Ember calls the scope creep.

## The 90 seconds

| Time | What happens | What to say |
| --- | --- | --- |
| 0:00 | Intro screen, four jurors on clouds | "I got tired of chatbots telling me my ideas were great." |
| 0:10 | Turn on the mic, start pitching | Deliver the pitch above, naturally. |
| 0:20 | **A juror cuts you off mid-sentence** | Let it happen. Do not talk over it. This is the moment the room wakes up. |
| 0:30 | Finish the pitch | "That is the whole pitch." |
| 0:35 | **A real browser opens on stage** | "That is a live cloud browser. Gale is checking the claim I just made." |
| 0:50 | Gale speaks with the source on screen | Point at the source and the verdict chip. |
| 1:00 | Ember and Tide speak, each citing a different source | "Four agents, four different sources. They split the work up." |
| 1:10 | **Interrupt a juror by talking over them** | Answer Tide's question mid-sentence. They stop and reply to you. |
| 1:20 | Volt lands the roast, citing Gale by name | "Volt speaks last because it has heard everyone else." |
| 1:30 | Verdict: cut, prove, test, build, four votes | "One scope cut, one claim to verify, one test, one thing to build tonight." |

If you have a spare fifteen seconds, open the jury room panel and scroll the
trace: tool calls, messages between agents, findings. That is the multi-agent
story in one screen.

## What to say about each track

- **Multi-agent** — a Bailiff decomposes the pitch and assigns four
  non-overlapping angles; jurors file research requests to the one agent with a
  browser and cite each other by name; every step is in an inspectable run tree.
- **OpenAI** — Realtime holds the mic open for barge-in in both directions;
  Responses runs every agent's bounded tool loop and all structured output.
- **Browserbase** — search, a live browser the audience watches, screenshots as
  receipts, and Stagehand clicking through pages when the answer is behind a
  cookie wall.
- **ElevenLabs** — four distinct v3 voices with per-juror delivery profiles and
  inline audio tags, with prosody carried across turns.

## If something goes wrong

| Symptom | What to do |
| --- | --- |
| Microphone blocked | The app drops to the typed pitch automatically. Keep talking over it. |
| A juror interrupts itself | Turn the speakers down; press **M** to mute and read the lines aloud. |
| The browser dock stays empty | Gale only opens a browser for a claim worth checking. Use the pitch above. |
| Deliberation feels slow | It is about 45 seconds. Narrate the Browserbase dock while it works; that is the show. |
| A provider is down | The jury still runs on fallbacks. Say which provider is out rather than pretending. |
| You only said a greeting or mic check | The jury asks for the product, person, and problem instead of pretending it evaluated an idea. Continue speaking or use the typed fallback. |
| You need to leave a screen | Use the visible Back link before pitching; **Esc** or **End session** safely returns an unfinished call to welcome. |
| Everything is broken | `npm run demo:jury` prints a full deliberation in the terminal. |

## Keys

**Space** starts the pitch · **M** mutes the jury · **Esc** ends the session
