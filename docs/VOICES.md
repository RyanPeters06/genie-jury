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

These are the live values in `DELIVERY` in `server/elevenlabs.ts`, and this table
is their documentation. They were tuned for these specific voices and do not
transfer if a juror is recast, so change both together.

| Juror | Model | Stability | Similarity boost | Style | Speed |
| --- | --- | ---: | ---: | ---: | ---: |
| Ember | `eleven_v3` | `0.5` | `0.78` | `0.18` | `1.04`, fallback only |
| Gale | `eleven_v3` | `0.5` | `0.82` | `0.06` | `0.92`, fallback only |
| Tide | `eleven_v3` | `0.5` | `0.75` | `0.14` | `0.96`, fallback only |
| Volt | `eleven_v3` | `0.0` | `0.72` | `0.42` | `1.08`, fallback only |

V3 stability is intentionally discrete: `0.0` is creative, `0.5` is natural, and `1.0` is robust. Only Volt uses `0.0`; the other three need reliable delivery during a live pitch.

Speed is omitted on v3, which has no numeric rate control; pacing there comes
from the tags and the punctuation. It is sent only when a request falls back to
Flash. Worth knowing: the API **accepts** a `speed` field on a v3 request rather
than rejecting it, so sending one looks like it works and quietly does nothing.

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

Each audition deliberately retained its bracketed V3 tags. We transcribed the selected MP3s with ElevenLabs Scribe with audio-event tagging enabled.

**How to read a Scribe transcript, because this is easy to get backwards.** With
`tag_audio_events` enabled, Scribe writes a bracketed marker such as `[laughs]`
when it *hears a non-verbal sound*. That marker is Scribe's own annotation of the
audio, not a transcription of the word. If a voice had actually read the tag out
loud, the transcript would contain the bare word `laughs` with no brackets. So a
bracketed marker in the output is evidence the tag **worked**, and it is the
opposite of a defect.

An earlier revision of this document read those markers the wrong way round and
concluded Volt spoke its tag aloud. That was wrong, and acting on it would have
stripped the tags from the most expressive juror in the cast.

| Juror | Tags tested | Result |
| --- | --- | --- |
| Ember | `[exhales]` | Performed. Scribe annotated a `[sighs]` event, and the word "exhales" never appears. |
| Gale | `[pauses]`, `[dryly]` | Not read aloud. Neither produces a detectable non-verbal sound, so there is nothing for Scribe to annotate and their tonal effect stays unverified rather than claimed. |
| Tide | `[gently]` | Not read aloud. Tone cannot be graded from a transcript, so human listening is the acceptance check. |
| Volt | `[laughs]`, `[sincerely]` | Performed. Scribe annotated a laugh event on both the cast voice and the previous one, and the bare word "laughs" appears in neither transcript. `[sincerely]` is not read aloud; its tone stays unverified. **Keep Volt's tags.** |

What a transcript cannot settle is whether `[dryly]` actually sounds dry. Tone
still needs a human listening pass with headphones before the demo.

## Fallback advice

The server asks for `eleven_v3` first and falls back to `eleven_flash_v2_5` on
any failure, which is what `synthesize` in `server/elevenlabs.ts` implements.
Flash is the right fallback for a live panel: much lower latency for
turn-taking, and unlike v3 it accepts `previous_text`, so prosody carries across
a turn boundary.

The two request shapes genuinely differ, and getting it wrong fails silently:

| | `eleven_v3` | `eleven_flash_v2_5` |
| --- | --- | --- |
| Audio tags | kept, and performed | stripped before sending |
| `previous_text` / `next_text` | rejected with a 400 | sent |
| `speed` | accepted but ignored, so omitted | sent |

A v3 request that carries `previous_text` returns 400 and silently degrades the
whole panel to the fallback voice with its tags removed. That is exactly the bug
this project shipped once already, so treat a sudden drop in expressiveness as a
request-shape problem before blaming the cast. The `X-Voice-Model` response
header reports which model actually produced the audio.
