import type { Ledger } from './ledger.ts'
import { agentLoop, llmAvailable, structured } from './llm.ts'
import { executorOf, researchClaim, specsOf, toolsFor } from './tools.ts'
import type { Assignment, Claim, ClaimType, Finding, JurorId, JurorTurn, SwarmEnv, Verdict, Vote } from './types.ts'

/**
 * The people in the room.
 *
 * Each juror is a stage agent with a fixed personality, a fixed angle, and a
 * fixed toolset. The Bailiff (Leader) never speaks on stage; it decomposes the
 * pitch and assigns angles. The Ally never argues; it synthesises the ledger
 * into the smallest credible next build and asks each juror for a vote.
 */

export interface JurorProfile {
  id: JurorId
  name: string
  role: string
  cue: string
  /** The one question this juror exists to answer. */
  mandate: string
  /** How they talk. Fed to the model verbatim so the voice stays consistent across turns. */
  voice: string
  /** Things this juror never does. */
  never: string
  /** Claim types the Bailiff routes to this juror by default. */
  owns: ClaimType[]
  /** ElevenLabs delivery: v3 audio tags the juror is allowed to use, sparingly. */
  audioTags: string[]
  fallbackLine: string
}

export const JURORS: Record<JurorId, JurorProfile> = {
  ember: {
    id: 'ember', name: 'Ember', role: 'The Builder', cue: 'Sizing up the build',
    mandate: 'Can this be built and shown working by demo day, and what is the smallest version that proves the value?',
    voice: 'Warm, fast, hands-on senior engineer. Speaks in concrete nouns: repos, endpoints, latency, the one screen that matters. Uses "ship" and "cut" a lot. Encouraging but allergic to vagueness. Short sentences.',
    never: 'Never talks about market size, never roasts, never speculates about users. Never says "great idea".',
    owns: ['feasibility'],
    audioTags: ['[exhales]', '[thoughtful]', '[warmly]'],
    fallbackLine: 'The moment is strong. The scope is not. Pick one magical interaction and make it impossible to ignore. What is the single screen you would demo if you had one hour left?',
  },
  gale: {
    id: 'gale', name: 'Gale', role: 'The Skeptic', cue: 'Checking the receipts',
    mandate: 'Which factual claim in this pitch is most dangerous if wrong, and what does live evidence actually say about it?',
    voice: 'Calm, precise, slightly dry investigative journalist. Quotes the builder back to them. Distinguishes verified, contested, and unproven out loud. Uses "I looked" and "I could not find". Measured pace.',
    never: 'Never invents a source, competitor, statistic, or study. Never reports research that did not happen. Never says a claim is false without evidence; says unproven.',
    owns: ['market', 'competition'],
    audioTags: ['[pauses]', '[dryly]', '[curious]'],
    fallbackLine: 'You said nobody does this. I could not verify that yet, and unverified is not the same as true. If I searched right now, what would you expect me to find?',
  },
  tide: {
    id: 'tide', name: 'Tide', role: 'The User', cue: 'Thinking like your user',
    mandate: 'Who exactly has this problem, what are they doing about it today, and what would make them switch?',
    voice: 'Empathetic, curious, a little impatient on behalf of real people. First-person as the user: "When I…". Asks about the moment of pain, the workaround, and the switching cost. Conversational and specific.',
    never: 'Never discusses architecture or feasibility, never cites market sizes, never flatters.',
    owns: ['user', 'business'],
    audioTags: ['[sighs]', '[gently]', '[curious]'],
    fallbackLine: 'I would try this the night before demo day, when I need honesty and not encouragement. But tell me about the last time your user hit this problem. What did they actually do?',
  },
  volt: {
    id: 'volt', name: 'Volt', role: 'The Jester', cue: 'Preparing an inconvenient truth',
    mandate: 'What is the single clearest flaw everyone is dancing around, and can it be said in one line people will remember?',
    voice: 'Playful, quick, theatrical. One-liners, comic timing, then a sudden sincere beat. Kind underneath. References what the other jurors just said and lands the real point in plain words.',
    never: 'Never cruel, never mocks the person, only the idea. Never repeats another juror\'s exact point; escalates or reframes it. Never more than one joke before the real question.',
    owns: [],
    audioTags: ['[laughs]', '[mischievously]', '[sincerely]', '[gasps]'],
    fallbackLine: '[laughs] If your pitch says "AI-powered" before it says who has the problem, I am throwing the lamp. [sincerely] So, who is crying at 2 a.m. without this?',
  },
}

export const SPEAKING_ORDER: JurorId[] = ['gale', 'ember', 'tide', 'volt']

const isJuror = (value: unknown): value is JurorId => typeof value === 'string' && value in JURORS

const CLAIM_SCHEMA = {
  type: 'object',
  properties: {
    claim: { type: 'string' }, type: { type: 'string', enum: ['market', 'competition', 'feasibility', 'user', 'business'] },
    importance: { type: 'number' }, confidence: { type: 'number' }, researchQuery: { type: 'string' },
  },
  required: ['claim', 'type', 'importance', 'confidence', 'researchQuery'], additionalProperties: false,
}

// ---------------------------------------------------------------------------
// Bailiff — the Leader. Decomposes the pitch, assigns angles, never speaks.
// ---------------------------------------------------------------------------

export async function runBailiff(ledger: Ledger, env: SwarmEnv) {
  const live = await structured<{ claims: Array<Omit<Claim, 'id' | 'evidenceStatus'>>; assignments: Array<{ juror: JurorId; question: string; claimIndexes: number[]; reason: string }> }>(env, {
    instructions: `You are the Bailiff of Genie Jury, the coordinator of a four-juror panel that pressure-tests hackathon and startup pitches. You never speak on stage. Your job is task decomposition: extract the pitch's riskiest claims and assign each juror the one angle they should own so the four do not overlap.
Jurors and mandates:
${Object.values(JURORS).map((juror) => `- ${juror.name} (${juror.role}): ${juror.mandate} Default claim types: ${juror.owns.join(', ') || 'none; Volt gets the cross-cutting flaw'}.`).join('\n')}
Rules: 3 to 5 claims, ordered by importance (1 = fatal if wrong, 0 = cosmetic). Each claim gets a concrete web search query a journalist would type. Every juror gets exactly one assignment with a sharp question in that juror's mandate. Do not assign the same claim to more than two jurors.`,
    input: `Mode: ${ledger.mode}\nPitch:\n${ledger.pitch}`,
    schema: {
      name: 'bailiff_plan',
      schema: {
        type: 'object',
        properties: {
          claims: { type: 'array', items: CLAIM_SCHEMA },
          assignments: { type: 'array', items: { type: 'object', properties: { juror: { type: 'string', enum: ['ember', 'gale', 'tide', 'volt'] }, question: { type: 'string' }, claimIndexes: { type: 'array', items: { type: 'integer' } }, reason: { type: 'string' } }, required: ['juror', 'question', 'claimIndexes', 'reason'], additionalProperties: false } },
        },
        required: ['claims', 'assignments'], additionalProperties: false,
      },
    },
  })

  if (live && live.claims.length && live.assignments.length) {
    const claims = ledger.addClaims(live.claims.slice(0, 5).map((claim) => ({ ...claim, importance: clamp(claim.importance), confidence: clamp(claim.confidence), evidenceStatus: 'unproven' as const })))
    const seen = new Set<JurorId>()
    const assignments: Assignment[] = []
    for (const item of live.assignments) {
      if (!isJuror(item.juror) || seen.has(item.juror)) continue
      seen.add(item.juror)
      assignments.push({ juror: item.juror, question: item.question, reason: item.reason, claimIds: item.claimIndexes.map((index) => claims[index]?.id).filter((id): id is string => Boolean(id)) })
    }
    for (const juror of SPEAKING_ORDER) if (!seen.has(juror)) assignments.push(deterministicAssignment(juror, claims))
    ledger.assign(assignments)
    return { mode: 'live' as const }
  }

  const claims = ledger.addClaims(deterministicClaims(ledger.pitch))
  ledger.assign(SPEAKING_ORDER.map((juror) => deterministicAssignment(juror, claims)))
  return { mode: 'deterministic' as const }
}

function deterministicClaims(pitch: string): Array<Omit<Claim, 'id'>> {
  const sentences = pitch.split(/[.!?]/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 12).slice(0, 4)
  const types: ClaimType[] = ['competition', 'user', 'feasibility', 'market']
  return sentences.map((claim, index) => ({ claim, type: types[index] ?? 'business', importance: Math.max(.2, 1 - index * .2), confidence: .3, researchQuery: `${claim.slice(0, 80)} alternatives`, evidenceStatus: 'unproven' as const }))
}

function deterministicAssignment(juror: JurorId, claims: Claim[]): Assignment {
  const profile = JURORS[juror]
  const owned = claims.filter((claim) => profile.owns.includes(claim.type))
  const chosen = owned.length ? owned : juror === 'volt' ? claims.slice(0, 1) : claims.slice(0, 2)
  return { juror, question: profile.mandate, claimIds: chosen.map((claim) => claim.id), reason: `Default routing by claim type for ${profile.name}.` }
}

const clamp = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : .5))

// ---------------------------------------------------------------------------
// Stage 1 — investigate. Each juror works its assignment with tools.
// ---------------------------------------------------------------------------

type DraftFinding = Omit<Finding, 'id' | 'agent' | 'createdAt'>

export async function investigate(juror: JurorId, ledger: Ledger, env: SwarmEnv) {
  const profile = JURORS[juror]
  const assignment = ledger.assignmentFor(juror)
  const claims = ledger.claimsFor(juror)
  const tools = toolsFor(juror, ledger, env)

  const result = await agentLoop<{ findings: DraftFinding[] }>(env, {
    instructions: `You are ${profile.name}, ${profile.role}, on the Genie Jury panel. Your mandate: ${profile.mandate}
This is the private investigation stage; you are not speaking yet. Work your assignment with your tools, then return 1 to 3 structured findings. ${juror === 'gale' ? 'You MUST call research_claim on your highest-importance claim before answering; report only what the tool returned. If the opened page hides the answer behind a click (cookie wall, pricing tab, reviews), use act_on_page once.' : juror === 'volt' ? 'Read the ledger first; your job is the cross-cutting flaw. If your roast depends on a fact, file request_research.' : 'Use search_web to check the real web (existing products, libraries, or what users complain about), and browse_site when a snippet is not enough. If your angle depends on a factual claim being true, call request_research so Gale can verify it before the jury speaks.'} Use message_juror when you notice something outside your mandate that another juror should own. Findings are for the shared ledger, so be specific and refer to the builder's words. ${profile.never}`,
    input: `Pitch:\n${ledger.pitch}\n\nYour assignment from the Bailiff: ${assignment?.question ?? profile.mandate}\nReason: ${assignment?.reason ?? ''}\n\nClaims assigned to you:\n${claims.map((claim) => `- [${claim.id}] (${claim.type}, importance ${claim.importance.toFixed(2)}) ${claim.claim} | suggested query: ${claim.researchQuery}`).join('\n') || '- none; use read_ledger to pick one'}`,
    tools: specsOf(tools),
    maxToolCalls: juror === 'gale' ? 3 : 2,
    execute: executorOf(tools),
    schema: { name: 'investigation', schema: { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['risk', 'strength', 'question', 'evidence', 'scope-cut', 'user-test'] }, summary: { type: 'string' }, severity: { type: 'integer', enum: [1, 2, 3] }, claimId: { type: 'string' } }, required: ['kind', 'summary', 'severity', 'claimId'], additionalProperties: false } } }, required: ['findings'], additionalProperties: false } },
  })

  const drafts = result?.value.findings.slice(0, 3).map((finding) => ({ ...finding, claimId: finding.claimId || undefined })) ?? deterministicFindings(juror, ledger)
  return drafts.map((draft) => ledger.postFinding(juror, draft))
}

function deterministicFindings(juror: JurorId, ledger: Ledger): DraftFinding[] {
  const claim = ledger.claimsFor(juror)[0] ?? ledger.highestRiskClaim()
  const target = claim ? `"${claim.claim}"` : 'the pitch'
  switch (juror) {
    case 'ember': return [{ kind: 'scope-cut', summary: `Demo one interaction end to end before adding anything else; ${target} implies more surface than one weekend supports.`, severity: 2, claimId: claim?.id }]
    case 'gale': return [{ kind: 'evidence', summary: `${target} is unproven: no live source was captured, so it must be treated as an assumption, not a fact.`, severity: 3, claimId: claim?.id }]
    case 'tide': return [{ kind: 'user-test', summary: `The user's painful moment is not named; ask three target users what they did last time instead of ${target}.`, severity: 2, claimId: claim?.id }]
    default: return [{ kind: 'risk', summary: `The pitch leads with the solution, not the person with the problem. That is the flaw every other note points at.`, severity: 2, claimId: claim?.id }]
  }
}

/** Gale works the research queue other jurors filed during investigation. Handoff from the Bailiff. */
export async function serviceResearchRequests(ledger: Ledger, env: SwarmEnv, limit = 2) {
  const requests = ledger.inbox('gale', 'research.request').slice(0, limit)
  ledger.consume('gale', requests)
  const results = []
  for (const request of requests) {
    const query = String(request.payload.query ?? '')
    const claimId = typeof request.payload.claimId === 'string' ? request.payload.claimId : undefined
    const started = Date.now()
    const claim = claimId ? ledger.claims.find((item) => item.id === claimId)?.claim : undefined
    const evidence = ledger.addEvidence(await researchClaim({ query, claim, claimId, requestedBy: request.from }, ledger, env))
    ledger.recordTool({ agent: 'gale', tool: 'research_claim', args: { query, claimId, onBehalfOf: request.from }, result: { status: evidence.status, sourceUrl: evidence.sourceUrl, rationale: evidence.rationale }, ok: true, durationMs: Date.now() - started })
    ledger.send('gale', request.from, 'research.result', { query, status: evidence.status, title: evidence.title, sourceUrl: evidence.sourceUrl, excerpt: evidence.excerpt })
    ledger.postFinding('gale', { kind: 'evidence', summary: `${request.from} asked me to check "${query}": ${evidence.status}${evidence.title ? ` — ${evidence.title}` : ''}.`, severity: evidence.status === 'verified' ? 1 : 2, claimId })
    results.push(evidence)
  }
  return results
}

// ---------------------------------------------------------------------------
// Stage 2 — speak. One short spoken turn grounded in the ledger.
// ---------------------------------------------------------------------------

export interface SpeakOptions { replyingTo?: string; canResearch?: boolean }

export async function speak(juror: JurorId, ledger: Ledger, env: SwarmEnv, options: SpeakOptions = {}): Promise<JurorTurn> {
  const profile = JURORS[juror]
  const own = ledger.findingsBy(juror)
  const others = ledger.findingsExcept(juror).filter((finding) => finding.agent !== 'bailiff' && finding.agent !== 'ally')
  const inbox = ledger.inbox(juror)
  ledger.consume(juror, inbox)
  const evidence = ledger.evidence.filter((item) => own.some((finding) => finding.claimId && finding.claimId === item.claimId) || item.requestedBy === juror || juror === 'gale')
  const basedOn = { findingIds: own.map((finding) => finding.id), evidenceIds: evidence.map((item) => item.claimId ?? item.query ?? '').filter(Boolean), messagesFrom: [...new Set(inbox.map((message) => message.from))] }
  const fallback: JurorTurn = { juror, line: deterministicLine(juror, ledger, options), cue: profile.cue, basedOn }
  if (!llmAvailable(env)) return fallback

  const instructions = `You are ${profile.name}, ${profile.role}, speaking live on the Genie Jury stage to a builder who just pitched. Mandate: ${profile.mandate}
Voice: ${profile.voice}
${profile.never}
You are one person in a real conversation, not a narrator. Refer to the builder's actual words. Build on what the other jurors found instead of repeating it; if you use another juror's finding, name them naturally ("Gale checked that"). Evidence language is strict: verified, contested, or unproven; never claim a source that is not in the ledger.
Length: 18 to 56 words, one observation and one pointed question. ${juror === 'volt' ? 'Volt rule: exactly two sentences and at most 44 words. The first is one cheeky PG-13 roast of the IDEA, never the builder. The second is a sincere, useful question and must end with a question mark. No sexual content, slurs, profanity, or personal attacks.' : ''} Return the spoken text in "line". You may include at most two of these ElevenLabs delivery tags inline where a real person would breathe or react: ${profile.audioTags.join(' ')}. Never use other bracketed tags. "cue" is a 2 to 6 word stage caption. "basedOnFindingIds" lists ledger finding ids you drew on.`

  const input = [
    `Pitch:\n${ledger.pitch}`,
    options.replyingTo ? `The builder just answered you:\n"${options.replyingTo}"\nRespond to that answer directly; do not restart your original point.` : '',
    `Your assignment: ${ledger.assignmentFor(juror)?.question ?? profile.mandate}`,
    `Your findings:\n${own.map((finding) => `- [${finding.id}] (${finding.kind}, severity ${finding.severity}) ${finding.summary}`).join('\n') || '- none'}`,
    `Other jurors' findings:\n${others.map((finding) => `- [${finding.id}] ${JURORS[finding.agent as JurorId]?.name ?? finding.agent} (${finding.kind}): ${finding.summary}`).join('\n') || '- none yet'}`,
    `Messages to you:\n${inbox.map((message) => `- from ${message.from} (${message.kind}): ${JSON.stringify(message.payload)}`).join('\n') || '- none'}`,
    `Evidence in the ledger:\n${evidence.map((item) => `- ${item.status.toUpperCase()} ${item.query ?? ''} ${item.title ? `| ${item.title}` : ''} ${item.sourceUrl ? `| ${item.sourceUrl}` : ''}`).join('\n') || '- none captured'}`,
    ledger.builderAnswers.length ? `Earlier builder answers:\n${ledger.builderAnswers.map((answer) => `- to ${answer.toJuror}: "${answer.transcript}"`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')

  const schema = { name: 'juror_turn', schema: { type: 'object', properties: { line: { type: 'string' }, cue: { type: 'string' }, basedOnFindingIds: { type: 'array', items: { type: 'string' } } }, required: ['line', 'cue', 'basedOnFindingIds'], additionalProperties: false } }
  type Out = { line: string; cue: string; basedOnFindingIds: string[] }
  const validate = (value: unknown): value is Out => {
    if (typeof value !== 'object' || value === null || typeof (value as Out).line !== 'string' || typeof (value as Out).cue !== 'string') return false
    const line = (value as Out).line.trim()
    if (line.length < 12 || line.length > 520) return false
    const spoken = line.replace(/\[[^\]]{1,24}\]/g, '').replace(/\s{2,}/g, ' ').trim()
    const wordCount = spoken.split(/\s+/).filter(Boolean).length
    // A panelist should sound like a person in a live meeting, not a report.
    // Keeping every turn short also gives the builder a natural opening to cut in.
    if (wordCount < 8 || wordCount > (juror === 'volt' ? 44 : 56) || !/\?\s*$/.test(spoken)) return false
    if (juror !== 'volt') return true
    const sentences = spoken.match(/[^.!?]+[.!?]+/g) ?? []
    return sentences.length === 2
  }

  let out: Out | null = null
  if (options.canResearch && juror === 'gale') {
    const tools = toolsFor('gale', ledger, env).filter((tool) => tool.spec.name === 'research_claim')
    const looped = await agentLoop<Out>(env, { instructions: `${instructions}\nIf the builder's answer introduced a new factual claim, call research_claim once before you speak.`, input, tools: specsOf(tools), maxToolCalls: 1, execute: executorOf(tools), schema, validate })
    out = looped?.value ?? null
  } else {
    const value = await structured<Out>(env, { instructions, input, schema })
    out = value && validate(value) ? value : null
  }
  if (!out) return fallback
  const allowed = new Set(ledger.findings.map((finding) => finding.id))
  return { juror, line: sanitizeTags(out.line.trim(), profile.audioTags), cue: out.cue.trim().slice(0, 80) || profile.cue, basedOn: { ...basedOn, findingIds: out.basedOnFindingIds.filter((id) => allowed.has(id)) } }
}

/** Keep only this juror's whitelisted ElevenLabs tags; strip anything else in brackets. */
export function sanitizeTags(line: string, allowed: string[]) {
  const allowedSet = new Set(allowed.map((tag) => tag.toLowerCase()))
  let kept = 0
  return line
    .replace(/\[[^\]]{1,24}\]/g, (tag) => {
      if (allowedSet.has(tag.toLowerCase()) && kept < 2) { kept += 1; return tag }
      return ''
    })
    // A tag jammed against the previous sentence reads as one word to the voice model.
    .replace(/([^\s])(\[)/g, '$1 $2')
    .replace(/(\])([^\s.,!?])/g, '$1 $2')
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function deterministicLine(juror: JurorId, ledger: Ledger, options: SpeakOptions) {
  const profile = JURORS[juror]
  const finding = ledger.findingsBy(juror)[0]
  if (options.replyingTo) return `${finding ? finding.summary : profile.fallbackLine} You said "${options.replyingTo.slice(0, 80)}". What would prove that by demo day?`
  return finding ? `${finding.summary} ${profile.fallbackLine.split(/(?<=[.!?])\s/).pop() ?? ''}`.trim() : profile.fallbackLine
}

// ---------------------------------------------------------------------------
// Ally — synthesis. Reads everything, writes the smallest credible next build.
// ---------------------------------------------------------------------------

export async function runAlly(ledger: Ledger, env: SwarmEnv): Promise<Omit<Verdict, 'votes'>> {
  const fallback = deterministicVerdict(ledger)
  const live = await structured<Omit<Verdict, 'votes'>>(env, {
    instructions: `You are the Ally in Genie Jury. The four jurors have finished pressure-testing a pitch. You do not argue; you convert their findings and evidence into the smallest credible next build. Be concrete and kind. Headline is 3 to 7 words. Summary is one sentence. scopeCut is the one thing to remove. evidenceQuestion is the one claim to verify first (respect verified/contested/unproven). userTest is one test with real people this week. smallestNextBuild is what to build in the next 4 hours.`,
    input: `Pitch:\n${ledger.pitch}\n\nFindings:\n${ledger.findings.map((finding) => `- ${finding.agent} (${finding.kind}, sev ${finding.severity}): ${finding.summary}`).join('\n')}\n\nEvidence:\n${ledger.evidence.map((item) => `- ${item.status} ${item.query ?? ''} ${item.sourceUrl ?? ''}`).join('\n') || '- none'}\n\nBuilder answers:\n${ledger.builderAnswers.map((answer) => `- to ${answer.toJuror}: ${answer.transcript}`).join('\n') || '- none'}`,
    schema: { name: 'ally_verdict', schema: { type: 'object', properties: { headline: { type: 'string' }, summary: { type: 'string' }, smallestNextBuild: { type: 'string' }, scopeCut: { type: 'string' }, evidenceQuestion: { type: 'string' }, userTest: { type: 'string' } }, required: ['headline', 'summary', 'smallestNextBuild', 'scopeCut', 'evidenceQuestion', 'userTest'], additionalProperties: false } },
  })
  return live && live.headline ? live : fallback
}

function deterministicVerdict(ledger: Ledger): Omit<Verdict, 'votes'> {
  const pick = (agent: JurorId) => ledger.findingsBy(agent)[0]?.summary
  return {
    headline: 'A version worth building',
    summary: 'The jury found a real moment inside the pitch; the platform around it is the risk.',
    smallestNextBuild: pick('ember') ?? 'Build the one interaction you would demo with an hour left.',
    scopeCut: 'Everything that is not the demo moment.',
    evidenceQuestion: pick('gale') ?? 'Verify the claim the pitch depends on most before building around it.',
    userTest: pick('tide') ?? 'Watch three target users hit the problem and record what they do today.',
  }
}

export async function castVote(juror: JurorId, ledger: Ledger, env: SwarmEnv, verdict: Omit<Verdict, 'votes'>): Promise<{ vote: Vote; because: string }> {
  const profile = JURORS[juror]
  const own = ledger.findingsBy(juror)
  const fallback = deterministicVote(juror, ledger)
  const live = await structured<{ vote: Vote; because: string }>(env, {
    instructions: `You are ${profile.name}, ${profile.role}. Cast one vote on the pitch after hearing the Ally's plan. BUILD = go build the plan. PIVOT = the core needs to change. PROVE = verify a claim or run a user test first. ROASTED = the flaw is fatal as pitched (Volt's signature, others use it rarely). "because" is at most 12 words in your voice.`,
    input: `Ally plan: ${JSON.stringify(verdict)}\nYour findings: ${own.map((finding) => finding.summary).join(' | ') || 'none'}\nBuilder answers: ${ledger.builderAnswers.map((answer) => answer.transcript).join(' | ') || 'none'}`,
    schema: { name: 'juror_vote', schema: { type: 'object', properties: { vote: { type: 'string', enum: ['BUILD', 'PIVOT', 'PROVE', 'ROASTED'] }, because: { type: 'string' } }, required: ['vote', 'because'], additionalProperties: false } },
  })
  return live && ['BUILD', 'PIVOT', 'PROVE', 'ROASTED'].includes(live.vote) ? { vote: live.vote, because: live.because.slice(0, 90) } : fallback
}

function deterministicVote(juror: JurorId, ledger: Ledger): { vote: Vote; because: string } {
  const worst = Math.max(0, ...ledger.findingsBy(juror).map((finding) => finding.severity))
  if (juror === 'volt') return { vote: 'ROASTED', because: 'Lead with the person, not the lamp.' }
  if (juror === 'gale') return { vote: ledger.evidence.some((item) => item.status === 'verified') ? 'BUILD' : 'PROVE', because: 'Unproven is not the same as true.' }
  if (juror === 'ember') return { vote: worst >= 3 ? 'PIVOT' : 'BUILD', because: 'Cut to the one demo moment.' }
  return { vote: worst >= 2 ? 'PROVE' : 'BUILD', because: 'Ask three real users first.' }
}
