import { castVote, investigate, JURORS, runAlly, runBailiff, serviceResearchRequests, SPEAKING_ORDER, speak } from './agents.ts'
import { Ledger } from './ledger.ts'
import { llmAvailable } from './llm.ts'
import type { DeliberationResult, JurorId, JurorTurn, LedgerSnapshot, RunNode, SwarmEnv, SwarmRuntime, Verdict } from './types.ts'

/**
 * The swarmflow. Deterministic stages, handoffs between them, parallel agents
 * inside a stage. Mirrors the JiuwenSwarm Leader / stage agents / handoff
 * pattern.
 *
 *   run
 *   |- stage: decompose        Bailiff extracts claims and assigns each juror an angle
 *   |- stage: investigate      Ember, Gale, Tide, Volt work in parallel with their own tools
 *   |- handoff: research queue Gale services the research requests the others filed
 *   |- stage: speak            Gale, Ember, Tide speak; then Volt, who has heard everyone
 *   \- stage: verdict          The Ally synthesises while each juror votes
 *
 * Each spoken turn is published the moment it is ready, so the stage can start
 * talking while the verdict stage is still running.
 */
export async function deliberate(pitch: string, mode: 'Hackathon' | 'Startup', env: SwarmEnv, runtime?: SwarmRuntime): Promise<DeliberationResult> {
  const ledger = new Ledger(pitch, mode, runtime)
  const startedAt = new Date().toISOString()
  const runId = crypto.randomUUID()
  const root = ledger.node('run', 'system', 'Genie Jury deliberation', { runId, mode, live: llmAvailable(env) })
  ledger.setDefaultParent(root)

  await ledger.span('stage', 'bailiff', 'Decompose the pitch', async (node) => {
    ledger.trackAgentSpan('bailiff', node)
    const result = await runBailiff(ledger, env)
    ledger.finish(node, 'done', { mode: result.mode, claims: ledger.claims.length, assignments: ledger.assignments.map((assignment) => `${assignment.juror}: ${assignment.question}`) })
    for (const assignment of ledger.assignments) ledger.send('bailiff', assignment.juror, 'handoff', { question: assignment.question, claimIds: assignment.claimIds })
    ledger.trackAgentSpan('bailiff', null)
  })

  await ledger.span('stage', 'system', 'Investigate in parallel', async (stage) => {
    await Promise.all(SPEAKING_ORDER.map((juror) => ledger.span('agent', juror, `${JURORS[juror].name} investigates`, async (node) => {
      ledger.trackAgentSpan(juror, node)
      const findings = await investigate(juror, ledger, env)
      ledger.finish(node, 'done', { findings: findings.map((finding) => finding.summary) })
      ledger.trackAgentSpan(juror, null)
    }, { parent: stage })))
  })

  await ledger.span('handoff', 'gale', 'Gale services the research queue', async (node) => {
    ledger.trackAgentSpan('gale', node)
    const results = await serviceResearchRequests(ledger, env)
    ledger.finish(node, results.length ? 'done' : 'skipped', { serviced: results.length, statuses: results.map((item) => item.status) })
    ledger.trackAgentSpan('gale', null)
  })

  const turns: JurorTurn[] = []
  const publish = (turn: JurorTurn) => runtime?.emit({ type: 'juror.turn', at: new Date().toISOString(), data: { ...turn } })

  await ledger.span('stage', 'system', 'Jurors speak', async (stage) => {
    const first = SPEAKING_ORDER.filter((juror) => juror !== 'volt')
    const spoken = await Promise.all(first.map((juror) => ledger.span('agent', juror, `${JURORS[juror].name} speaks`, async (node) => {
      ledger.trackAgentSpan(juror, node)
      const turn = await speak(juror, ledger, env)
      ledger.trackAgentSpan(juror, null)
      return turn
    }, { parent: stage })))
    // Publish in speaking order so the stage never plays Ember before Gale.
    for (const juror of first) {
      const turn = spoken.find((item) => item.juror === juror)
      if (!turn) continue
      turns.push(turn)
      publish(turn)
    }
    for (const turn of spoken) ledger.send(turn.juror, 'volt', 'finding.shared', { line: turn.line }, stage)
    const volt = await ledger.span('agent', 'volt', 'Volt speaks last, having heard everyone', async (node) => {
      ledger.trackAgentSpan('volt', node)
      const turn = await speak('volt', ledger, env)
      ledger.trackAgentSpan('volt', null)
      return turn
    }, { parent: stage })
    turns.push(volt)
    publish(volt)
  })

  const verdict = await ledger.span('stage', 'ally', 'Verdict and votes', async (node) => {
    ledger.trackAgentSpan('ally', node)
    const plan = await runAlly(ledger, env)
    for (const juror of SPEAKING_ORDER) ledger.send('ally', juror, 'vote.request', { headline: plan.headline })
    const votes = await Promise.all(SPEAKING_ORDER.map((juror) => ledger.span('agent', juror, `${JURORS[juror].name} votes`, () => castVote(juror, ledger, env, plan), { parent: node })))
    const full: Verdict = { ...plan, votes: Object.fromEntries(SPEAKING_ORDER.map((juror, index) => [juror, votes[index]])) as Verdict['votes'] }
    ledger.finish(node, 'done', { headline: full.headline, votes: Object.fromEntries(Object.entries(full.votes).map(([juror, vote]) => [juror, vote.vote])) })
    ledger.trackAgentSpan('ally', null)
    return full
  })

  ledger.finish(root)
  const ordered = SPEAKING_ORDER.map((juror) => turns.find((turn) => turn.juror === juror)).filter((turn): turn is JurorTurn => Boolean(turn))
  return { runId, mode: llmAvailable(env) ? 'live' : 'deterministic', ledger: ledger.snapshot(), runTree: ledger.runTree, turns: ordered, verdict, startedAt, endedAt: new Date().toISOString() }
}

/**
 * The builder answered a juror. That juror replies using the whole ledger:
 * its own findings, the other jurors' findings, and any evidence. Gale may run
 * one more live search if the answer introduced a new factual claim.
 */
export async function respond(previous: DeliberationResult, juror: JurorId, transcript: string, env: SwarmEnv, runtime?: SwarmRuntime): Promise<{ turn: JurorTurn; result: DeliberationResult }> {
  const ledger = Ledger.fromSnapshot(previous.ledger, previous.runTree, runtime)
  ledger.recordBuilderAnswer(juror, transcript)
  ledger.send('builder', juror, 'builder.answer', { transcript })
  const turn = await ledger.span('agent', juror, `${JURORS[juror].name} replies to the builder`, async (node) => {
    ledger.trackAgentSpan(juror, node)
    const reply = await speak(juror, ledger, env, { replyingTo: transcript, canResearch: juror === 'gale' })
    ledger.trackAgentSpan(juror, null)
    return reply
  }, { parent: null })
  const turns = previous.turns.map((item) => (item.juror === juror ? turn : item))
  return { turn, result: { ...previous, ledger: ledger.snapshot(), runTree: ledger.runTree, turns, endedAt: new Date().toISOString() } }
}

export function rehydrate(snapshot: LedgerSnapshot, runTree: RunNode[], runtime?: SwarmRuntime) { return Ledger.fromSnapshot(snapshot, runTree, runtime) }
