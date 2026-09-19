# Genie Jury voice casting

`scripts/cast-voices.mjs` queried the account voice collection and the English shared Voice Library, then rendered `eleven_v3` auditions into `tmp/auditions/`. Shared-library voices were research only: the script does not add, save, or modify them. The final cast uses account-available voices so the live demo does not depend on a library import.

## Final cast

| Juror | Voice | Voice ID | Why it fits |
| --- | --- | --- | --- |
| Ember, The Builder | Liam — Energetic, Social Media Creator | `TX3LPaxmHKxFdv7VOQHJ` | Liam is a young American male voice with confident energy and warmth. He cuts through a pitch quickly, which suits Ember’s hands-on “ship it or cut it” pressure without sounding like an angry judge. |
| Gale, The Skeptic | Alice — Clear, Engaging Educator | `Xb7hH8MSUJpSbSDYk0k2` | Alice is a middle-aged British female voice with clear, professional diction. Her different register and measured accent make Gale immediately legible as the calm investigative counterweight to Ember. |
| Tide, The User | Hope — Smooth, Engaging and Kind | `WAhoMTNdLdMoq1j3wf3I` | Hope is a young American female voice described as soft, conversational, and emotionally attentive. That makes Tide’s first-person user questions warm but still personal enough to ask for a real painful moment. |
| Volt, The Jester | Harry — Fierce Warrior | `SOYHLrjzK2X1ezoPC6cr` | Harry is a young American character voice with a rougher, animated timbre than Liam. It gives Volt a theatrical entrance and comic contrast; the low-stability setting lets the sincere beat land after the joke. |

The cast deliberately separates accent, gender, age, and timbre: Ember is energetic American male, Gale is measured British female, Tide is soft American female, and Volt is a rougher animated American male. The final decision should still be confirmed by a human listening pass with headphones before the demo; the audition files are intentionally left in untracked `tmp/auditions/`.

## Delivery settings

| Juror | Model | Stability | Similarity boost | Style | Speed |
| --- | --- | ---: | ---: | ---: | --- |
| Ember | `eleven_v3` | `0.5` | `0.78` | `0.18` | Not sent: Eleven v3 does not support numeric speed control. For Flash fallback, use `1.04`. |
| Gale | `eleven_v3` | `0.5` | `0.82` | `0.06` | Not sent: Eleven v3 does not support numeric speed control. For Flash fallback, use `0.92`. |
| Tide | `eleven_v3` | `0.5` | `0.75` | `0.14` | Not sent: Eleven v3 does not support numeric speed control. For Flash fallback, use `0.96`. |
| Volt | `eleven_v3` | `0.0` | `0.72` | `0.42` | Not sent: Eleven v3 does not support numeric speed control. For Flash fallback, use `1.08`. |

V3 stability is intentionally discrete: `0.0` is creative, `0.5` is natural, and `1.0` is robust. Only Volt uses `0.0`; the other three need reliable delivery during a live pitch.

## Audition results and latency

The same juror-specific line was used for every candidate for that juror. Successful v3 request latencies:

| Juror | Candidate | Measured synthesis latency |
| --- | --- | ---: |
| Ember | Jessica / Sarah / Liam | 3978 ms / 5131 ms / 3543 ms |
| Gale | Alice / Lily / Matilda | 4028 ms / 4410 ms / 4397 ms |
| Tide | Jessica / Hope / Sarah | 5038 ms / 5990 ms / 4211 ms |
| Volt | Liam / Harry / Jessica | 2414 ms / 3764 ms / 3462 ms |

No ElevenLabs audition request failed, so there is no failure status/body to report. The chosen final-file Scribe v2 verification requests took 428 ms (Ember), 382 ms (Gale), 415 ms (Tide), and 382 ms (Volt).

## V3 audio-tag verification

Each audition deliberately retained its bracketed V3 tags. We transcribed the selected MP3s with ElevenLabs Scribe v2 with audio-event tagging enabled. This can prove whether a tag’s literal words were spoken, but it cannot fully grade tone such as “dryly” or “gently”; listen to the MP3s before judging.

| Juror | Tags tested | Result |
| --- | --- | --- |
| Ember | `[exhales]` | Worked as non-verbal delivery: Scribe returned `[sighs]`, not the word “exhales.” |
| Gale | `[pauses]`, `[dryly]` | Neither tag was read aloud. Scribe emitted no matching audio event, so their tonal effect is unverified rather than claimed as proven. |
| Tide | `[gently]` | Not read aloud. Tone cannot be verified from a transcript, so use human listening as the acceptance check. |
| Volt | `[laughs]`, `[sincerely]` | `[laughs]` was transcribed literally, meaning this voice/model combination spoke the tag aloud; it is not acceptable for production. `[sincerely]` was not spoken, but its tone remains unverified. Replace Volt’s bracketed tags with natural dialogue punctuation or a short written stage direction in a preceding sentence. |

## Fallback advice

Use `eleven_v3` for short prerecorded hero lines and the final showcase after a human audition approves the delivery. For live interruptions, use `eleven_flash_v2_5` with the per-juror fallback speeds above: it is far more suitable for turn-taking latency. If V3 is unavailable on the account, keep the same four casts, remove bracket tags from the request text, and rely on punctuation plus the documented Flash settings; never surface a tag that may be spoken aloud to the builder.
