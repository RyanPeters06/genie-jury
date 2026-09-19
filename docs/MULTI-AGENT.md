# The swarm

Genie Jury is four specialist agents, a coordinator, and a synthesiser that
collaborate on one job: decide whether a pitch is worth building. They are not
one prompt wearing four hats. Each agent has a different mandate, a different
toolset, and a different view of the shared state, and they hand work to each
other during the run.

The vocabulary deliberately mirrors openJiuwen / JiuwenSwarm: a **Leader** that
decomposes the task, **stage agents** that work in parallel, **handoffs**
between stages, a **message bus**, and an inspectable **run tree**.

## The cast

| Agent | Role | Mandate | Tools |
| --- | --- | --- | --- |
| **Bailiff** | Leader | Extract the riskiest claims, give each juror one angle so they do not overlap. Never speaks on stage. | structured extraction |
| **Ember** | The Builder | Can this ship by demo day, and what is the smallest version that proves it? | `read_ledger` `search_web` `browse_site` `request_research` `message_juror` |
| **Gale** | The Skeptic | Which claim is most dangerous if wrong, and what does live evidence say? | `read_ledger` `research_claim` `act_on_page` `search_web` `message_juror` |
| **Tide** | The User | Who has this problem, what do they do today, what would make them switch? | `read_ledger` `search_web` `browse_site` `request_research` `message_juror` |
| **Volt** | The Jester | What is the one flaw everyone is dancing around? | `read_ledger` `request_research` `message_juror` |
| **Ally** | Synthesiser | Turn the ledger into the smallest credible next build. Never argues. | reads the whole ledger |

Only Gale gets `research_claim` and `act_on_page`. That is deliberate: the live
browser is Gale's, so when the audience sees a browser open on stage they always
know whose hands are on it. Volt gets no web tools at all, because Volt's job is
to read what everyone else found and name the flaw they are circling.

## The shared ledger

Every agent reads and writes one `Ledger` object. Nothing an agent knows about
another agent's work arrives by copying text between prompts; it arrives through
this object. The ledger holds:

- **claims** the Bailiff extracted, each with an importance and an evidence status
- **assignments** binding one juror to one question
- **evidence** with its status, source URL, rationale, and screenshot
- **findings** each juror posts, typed and severity-rated
- **messages** between agents
- **tool calls** with arguments, results, and durations
- **builder answers** from the live conversation

Because the collaboration is state rather than prose, it can be replayed,
inspected, and put on screen. That is what the jury room panel in the UI shows.

## The message bus

Agents address each other by name. Three message kinds carry real work:

- `handoff` — the Bailiff gives a juror its question and the claims it owns.
- `research.request` — Ember, Tide, or Volt hit a factual claim outside their
  mandate and file it for Gale. Gale services the queue in a dedicated stage,
  runs the live browser, and replies with `research.result`. This is the load-
  bearing collaboration: a juror who cannot check a fact does not guess, it asks
  the juror who can.
- `finding.shared` — a juror hands an angle to whoever owns it, and every
  speaking juror's line is delivered to Volt before Volt speaks.

Each agent has an inbox and marks messages consumed, so nothing is read twice.

## The swarmflow

```
run
├─ stage: decompose         Bailiff extracts claims, assigns four angles, sends four handoffs
├─ stage: investigate       Ember ∥ Gale ∥ Tide ∥ Volt, each in its own tool loop
├─ handoff: research queue  Gale services the research requests the others filed
├─ stage: speak             Gale ∥ Ember ∥ Tide speak, then Volt, who has heard all three
└─ stage: verdict           Ally synthesises ∥ four jurors vote on the plan
```

Stages are deterministic; the agents inside a stage are not. Turns are published
the moment they are ready, so the panel starts talking while the verdict stage is
still running.

## What a real run looks like

From `npm run demo:jury` on the pitch *"Loop is a wearable that reads your
emotions. Nobody else is doing this. Every therapist will want it."*

| | |
| --- | --- |
| Wall time | 46s |
| Tool calls | 10 |
| Messages between agents | 15 |
| Findings posted | 11 |
| Evidence items | 5 |

The collaboration that produced:

- The Bailiff split the pitch into five claims and gave Gale the competition
  angle, Ember feasibility, Tide the user, Volt the cross-cutting flaw.
- Gale searched, opened a source in the live browser, and found **Ovomind**, a
  real emotion-reading wearable company, marking "nobody else is doing this"
  **contested**.
- Ember independently found a Penn State source on a multi-signal sticker and
  marked the feasibility claim **verified**.
- Tide found **Sense-IT**, a wearable therapists already use in aggression
  therapy, which is a sharper answer to "what do they do today" than any
  competitor list.
- Volt filed a research request, Gale serviced it, and Volt's spoken line then
  cited Gale by name: *"Loop's 'nobody else is doing this' line trips on
  reality — like Gale pointed out, Ovomind's dancing in the same spotlight."*

Four agents, four different real sources, one line that depends on another
agent's tool call. That is the difference between a swarm and a prompt chain.

## Failure behaviour

The demo must never hang or lie.

- Every browser operation races a deadline. A page that never settles is
  abandoned, not waited on, so it cannot block the queue the jurors share.
- Every model call has a request timeout and a deterministic fallback. With no
  API key at all the full flow still runs from scripted findings.
- The investigation stage has a hard deadline. If it overruns, the jury speaks
  from whatever is already on the ledger.
- Evidence with no reachable source is **unproven**. No agent may describe
  research that did not happen, and the evidence clerk only sees text that was
  actually fetched.

## Reusing this

The swarm in `server/swarm/` does not know it is a jury. `types.ts` and
`ledger.ts` are a general blackboard with a message bus and a run tree;
`llm.ts` is a provider adapter with a bounded tool loop; `tools.ts` binds tools
to agents. To build a different panel, change the profiles in `agents.ts` and
the stage order in `deliberate.ts`. The web tools, the streaming, the run tree,
and the failure handling come along unchanged.
