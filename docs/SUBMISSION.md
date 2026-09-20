# Genie Jury submission kit

## Elevator description (60 words)

Genie Jury is a live pitch arena for hackathon builders who need honest feedback before the real judges arrive. Pitch an idea out loud to Ember, Gale, Tide, and Volt: four distinct AI jurors who interrupt, challenge assumptions, research risky claims in a live browser, disagree, and score the pitch. Leave with evidence, four votes, and a concrete plan.

## 90-second live demo

**0:00–0:10 — Start with the builder.** Open Genie Jury, say: “I’m building an AI calendar that will save every student ten hours a week.” Point out that this is a live voice conversation, not a chat window.

**0:10–0:25 — First interruption.** Let Ember interrupt mid-pitch: “Ten hours is a big promise. What is the one screen you can ship this weekend?” Briefly answer as the builder. Emphasize the speaking animation and distinct ElevenLabs voice.

**0:25–0:45 — Put Gale on the web.** Say “Nobody is doing this for student clubs.” Gale flags the claim, opens a real Browserbase research session on screen, and returns with a cited competitor or marks it unproven. Say: “The system does not pretend it found proof when it did not.”

**0:45–1:03 — Let the panel disagree.** Tide asks for one stressed club organizer and their current workaround. Volt roasts the vague “AI-powered” framing, then agrees with Ember that the one-flow demo is the real test. The disagreement shows four specialists, not four copies of one chatbot.

**1:03–1:25 — Reveal the scorecard.** End the session. Show the four 100-point juror scores, each with two transparent criteria, plus the recovery plan. Call out the difference between Gale’s evidence score and Tide’s user score.

**1:25–1:30 — Close.** “Genie Jury turns encouragement into a rehearsal room: one user, one claim, one proof, one unforgettable demo.”

## How did Codex help you build this?

**TODO — personalize this before submission.** Answer these questions in your own words, then replace this note with one concise paragraph:

- What could you not build alone in the hackathon timeframe?
- Which design, debugging, service-integration, testing, or visual iteration did Codex materially accelerate?
- What concrete problem did Codex help you discover or solve?
- Which implementation decisions remained yours, and how did you validate them?

## Sponsor tracks

### Hack the North finalists

Genie Jury turns the high-stakes, familiar hackathon pitch into a playful sky-world performance that is immediately understandable in a live demo. Its combination of imposing animated jurors, real browser evidence, voice interruption, and a useful recovery plan is designed for originality, UX, technical depth, and a memorable wow moment.

### OpenAI API prize

OpenAI Realtime transcribes the builder’s live pitch, while the Responses API drives distinct, structured interventions and the final scorecard. Codex helped transform the concept into a polished end-to-end experience, including agent orchestration, resilience fallbacks, testing, sprite recovery, and local service diagnostics.

### MLH: Best Use of ElevenLabs

ElevenLabs gives each juror a deliberately cast, emotionally distinct voice so the panel is recognizable by ear before the builder even looks at the screen. The demo makes audio essential: interruptions, pauses, comic timing, disagreement, and the final verdict become a real conversation rather than text read aloud.

### Huawei openJiuwen multi-agent challenge

Genie Jury is a working multi-agent system, not four prompts in a row, and the collaboration is inspectable on screen while it happens.

A Bailiff agent acts as the Leader. It decomposes the pitch into ranked claims and assigns each juror one non-overlapping angle, so the four specialists cover build feasibility, evidence verification, user pain, and the cross-cutting flaw without repeating each other. The four then investigate in parallel, each with a different toolset, writing findings to a shared ledger rather than passing text between prompts.

The load-bearing collaboration is delegation. Only Gale holds the live browser, so a juror that hits a factual claim outside its own mandate files a research request on the message bus; Gale services that queue and reports back verified, contested, or unproven. Volt speaks last, having received every other juror's line, and builds on what they found instead of restating it. An Ally then synthesises the whole ledger into one plan while each juror votes on it.

Every stage, tool call, inter-agent message, and finding lands in a run tree that streams to the stage live, so a judge can watch the decomposition and the handoffs rather than taking our word for them. One measured run produced ten tool calls, fifteen messages between agents, eleven findings, and four independent sources, including one juror citing another by name on stage because it had received that juror's evidence.

The vocabulary deliberately mirrors openJiuwen and JiuwenSwarm: a Leader that decomposes, stage agents that run in parallel, explicit handoffs between stages, a message bus, and a run tree. `docs/MULTI-AGENT.md` documents the design, and `npm run demo:jury` prints a full deliberation with all of it laid out.

### Browserbase

Browserbase is what lets the jury say "I looked" and mean it. Gale opens a real cloud browser on stage, and the audience watches it search, open the best source, and screenshot it while the verdict chip updates underneath. Three capabilities carry different weight: the Search API finds real sources for any juror, the live session is the one the audience sees, and Stagehand clicks through the page when the answer sits behind a cookie wall or a pricing tab. No human types a query at any point; the agents decide what is worth checking and delegate the web work among themselves. The evidence language is strict, so the most valuable thing the browser can come back with is "unproven".
