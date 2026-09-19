export interface Env {
  JURY_SESSIONS: DurableObjectNamespace
  DB?: D1Database
  OPENAI_API_KEY?: string
  OPENAI_MODEL?: string
  OPENAI_REALTIME_MODEL?: string
  BROWSERBASE_API_KEY?: string
  BROWSERBASE_PROJECT_ID?: string
  ELEVENLABS_API_KEY?: string
  ELEVENLABS_EMBER_VOICE_ID?: string
  ELEVENLABS_GALE_VOICE_ID?: string
  ELEVENLABS_TIDE_VOICE_ID?: string
  ELEVENLABS_VOLT_VOICE_ID?: string
  RESEARCH_RUNNER_URL?: string
  PUBLIC_APP_ORIGIN?: string
}

type Stage = 'mic-ready' | 'user-speaking' | 'researching' | 'juror-speaking' | 'awaiting-answer' | 'verdict'
type EventType = 'session.created' | 'transcript.final' | 'research.started' | 'evidence.added' | 'juror.queued' | 'juror.speaking' | 'verdict.ready'
type JurorId = 'ember' | 'gale' | 'tide' | 'volt'

interface JuryEvent { id: string; type: EventType; createdAt: string; data: Record<string, unknown> }
interface JurySessionRecord { id: string; mode: 'Hackathon' | 'Startup'; pitch: string; stage: Stage; activeJuror: string | null; events: JuryEvent[]; createdAt: string; updatedAt: string; expiresAt: string }
interface Claim { claim: string; type: 'market' | 'competition' | 'feasibility' | 'user' | 'business'; importance: number; confidence: number; researchQuery: string; evidenceStatus: 'verified' | 'contested' | 'unproven' }
interface Evidence { status: 'verified' | 'contested' | 'unproven'; sourceUrl?: string; title?: string; excerpt?: string; capturedAt: string; screenshotCaptured: boolean }
interface AgentTurn { juror: JurorId; line: string; cue: string }
interface JuryCriterion { label: string; score: number; max: number }
interface JuryScore { juror: JurorId; score: number; summary: string; action: string; criteria: JuryCriterion[] }
interface JuryEvaluation { overall: number; headline: string; recoveryPlan: string; jurors: JuryScore[] }

const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const LIVE_RESEARCH_BUDGET_MS = 6_000
const JUROR_GENERATION_BUDGET_MS = 5_500
const JUROR_LINES: Record<JurorId, string> = {
  ember: 'The moment is strong. The scope is not. Pick one magical interaction and make it impossible to ignore.',
  gale: 'You said nobody does this. I found close alternatives—but none with your exact hackathon wedge.',
  tide: 'I would use this before demo day, when I need an honest teammate instead of an encouraging chatbot.',
  volt: 'That pitch has more AI glitter than an overstuffed hackathon slide. Who is awake at 2 a.m. without this?',
}

const JUROR_BRIEFS: Record<JurorId, { cue: string; role: string; focus: string }> = {
  ember: { cue: 'Pressure-testing the build', role: 'Ember, the Builder', focus: 'Find the smallest shippable proof of value. Challenge unclear scope, technical hand-waving, and unowned execution.' },
  gale: { cue: 'Checking the receipts', role: 'Gale, the Skeptic', focus: 'Challenge factual claims using supplied evidence only. Call unsupported claims unproven; never invent a source or competitor.' },
  tide: { cue: 'Speaking for the user', role: 'Tide, the User Advocate', focus: 'Force specificity about the user, their painful moment, why they would care, and what makes this easier than the current workaround.' },
  volt: { cue: 'Delivering the useful roast', role: 'Volt, the Jester', focus: 'Open with one cheeky, demo-safe PG-13 roast that makes a room laugh—think hackathon pizza, buzzword soup, or a feature list held together with duct tape—then pivot to the most important unresolved weakness. Never use slurs, sexual humor, personal attacks, or profanity.' },
}

const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), { ...init, headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers } })
const failure = (message: string, status = 400) => json({ error: message }, { status })

function cors(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('Origin')
  const allowed = new Set(['http://127.0.0.1:5173', 'http://localhost:5173', env.PUBLIC_APP_ORIGIN].filter(Boolean))
  if (!origin || !allowed.has(origin)) return { Vary: 'Origin' }
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin' }
}

function withCors(response: Response, request: Request, env: Env) {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(cors(request, env))) headers.set(key, value)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function voiceFor(juror: JurorId, env: Env) {
  return { ember: env.ELEVENLABS_EMBER_VOICE_ID, gale: env.ELEVENLABS_GALE_VOICE_ID, tide: env.ELEVENLABS_TIDE_VOICE_ID, volt: env.ELEVENLABS_VOLT_VOICE_ID }[juror]
}

function serviceHealth(env: Env) {
  return {
    openai: env.OPENAI_API_KEY ? 'configured' : 'missing',
    realtime: env.OPENAI_API_KEY ? 'configured' : 'missing',
    browserbase: !env.BROWSERBASE_API_KEY ? 'missing-key' : !env.BROWSERBASE_PROJECT_ID ? 'missing-project' : 'configured',
    elevenlabs: !env.ELEVENLABS_API_KEY ? 'missing-key' : !voiceFor('ember', env) ? 'missing-voices' : 'configured',
    researchRunner: env.RESEARCH_RUNNER_URL ? 'configured' : 'local-default',
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request, env) })
    const url = new URL(request.url)
    const segments = url.pathname.split('/').filter(Boolean)
    let response: Response
    if (request.method === 'GET' && url.pathname === '/health') response = json({ ok: true, service: 'genie-jury-worker' })
    else if (request.method === 'GET' && url.pathname === '/health/services') response = json({ ok: true, services: serviceHealth(env) })
    else if (request.method === 'POST' && url.pathname === '/sessions') {
      const body = await request.json<{ mode?: 'Hackathon' | 'Startup'; pitch?: string }>().catch(() => null)
      if (!body?.pitch?.trim()) response = failure('A pitch is required.')
      else {
        const id = env.JURY_SESSIONS.newUniqueId()
        response = await env.JURY_SESSIONS.get(id).fetch('https://jury.internal/initialize', { method: 'POST', body: JSON.stringify({ id: id.toString(), mode: body.mode ?? 'Hackathon', pitch: body.pitch.trim() }) })
      }
    } else if (segments[0] === 'sessions' && segments[1]) {
      let id: DurableObjectId
      try { id = env.JURY_SESSIONS.idFromString(segments[1]) } catch { return withCors(failure('Unknown session.', 404), request, env) }
      const routeTail = segments.slice(2).join('/')
      if (request.method === 'POST' && routeTail === 'realtime-token') response = await createRealtimeToken(env)
      else if (request.method === 'POST' && routeTail === 'juror-audio') response = await createJurorAudio(request, env)
      else response = await env.JURY_SESSIONS.get(id).fetch(new Request(`https://jury.internal/${routeTail}`, request))
    } else response = failure('Route not found.', 404)
    return withCors(response, request, env)
  },
} satisfies ExportedHandler<Env>

export class JurySession {
  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/initialize') {
      const body = await request.json<{ id: string; mode: 'Hackathon' | 'Startup'; pitch: string }>()
      const now = new Date().toISOString()
      const session: JurySessionRecord = { id: body.id, mode: body.mode, pitch: body.pitch, stage: 'mic-ready', activeJuror: null, events: [], createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() }
      this.append(session, 'session.created', { mode: session.mode })
      await this.save(session)
      return json(session, { status: 201 })
    }
    const session = await this.state.storage.get<JurySessionRecord>('session')
    if (!session) return failure('Session has not been initialized.', 404)
    if (Date.parse(session.expiresAt) < Date.now()) return failure('This pitch session has expired. Start a new jury session.', 410)
    if (request.method === 'GET' && url.pathname === '/') return json(session)
    if (request.method === 'GET' && url.pathname === '/events') return json({ events: session.events })
    if (request.method === 'POST' && url.pathname === '/events') return this.appendEvent(request, session)
    if (request.method === 'POST' && url.pathname === '/research') return this.research(session)
    if (request.method === 'POST' && url.pathname === '/turn') return this.prepareJurorTurn(request, session)
    if (request.method === 'POST' && url.pathname === '/evaluation') return this.prepareEvaluation(session)
    return failure('Route not found.', 404)
  }

  private async appendEvent(request: Request, session: JurySessionRecord) {
    const body = await request.json<{ type?: EventType; data?: Record<string, unknown>; stage?: Stage; activeJuror?: string | null }>().catch(() => null)
    if (!body?.type) return failure('An event type is required.')
    this.append(session, body.type, body.data ?? {})
    if (body.stage) session.stage = body.stage
    if (body.activeJuror !== undefined) session.activeJuror = body.activeJuror
    await this.save(session)
    return json(session)
  }

  private append(session: JurySessionRecord, type: EventType, data: Record<string, unknown>) {
    session.events.push({ id: crypto.randomUUID(), type, data, createdAt: new Date().toISOString() })
    session.updatedAt = new Date().toISOString()
  }

  private async research(session: JurySessionRecord): Promise<Response> {
    session.stage = 'researching'
    this.append(session, 'research.started', { owner: 'gale' })
    const claims = await extractClaims(session.pitch, this.env)
    const highestRisk = claims.sort((a, b) => b.importance - a.importance)[0]
    const evidence = highestRisk ? await researchClaim(highestRisk, this.env) : undefined
    this.append(session, 'evidence.added', { claims, evidence: evidence ?? { status: 'unproven', capturedAt: new Date().toISOString(), screenshotCaptured: false } })
    session.stage = 'juror-speaking'
    session.activeJuror = 'gale'
    this.append(session, 'juror.queued', { juror: 'gale', reason: 'highest-risk claim research completed' })
    await this.save(session)
    return json({ session, claims, evidence })
  }

  private async prepareJurorTurn(request: Request, session: JurySessionRecord): Promise<Response> {
    const body = await request.json<{ juror?: JurorId; transcript?: string }>().catch(() => null)
    if (!body?.juror || !JUROR_BRIEFS[body.juror]) return failure('A valid juror is required.')
    const transcript = body.transcript?.trim() || session.pitch
    this.append(session, 'transcript.final', { transcript })

    let evidence: Evidence | undefined
    if (body.juror === 'gale') {
      this.append(session, 'research.started', { owner: 'gale' })
      // Research should inform Gale, never make the builder wait through a
      // slow model or cloud-browser round trip. A deterministic claim is an
      // honest fallback and will be marked unproven if evidence is not ready.
      const claims = deterministicClaims(`${session.pitch}\nLatest builder response: ${transcript}`)
      const highestRisk = claims.sort((a, b) => b.importance - a.importance)[0]
      evidence = highestRisk ? await researchClaimWithinBudget(highestRisk, this.env) : undefined
      this.append(session, 'evidence.added', { claims, evidence: evidence ?? { status: 'unproven', capturedAt: new Date().toISOString(), screenshotCaptured: false } })
    }

    const latestEvidence = evidence ?? [...session.events].reverse().find((event) => event.type === 'evidence.added')?.data.evidence
    const turn = await generateJurorTurnWithinBudget(body.juror, session.pitch, transcript, latestEvidence, this.env)
    session.stage = 'juror-speaking'
    session.activeJuror = body.juror
    this.append(session, 'juror.queued', { juror: body.juror, reason: 'live agent turn prepared' })
    this.append(session, 'juror.speaking', { ...turn })
    await this.save(session)
    return json(turn)
  }

  private async prepareEvaluation(session: JurySessionRecord): Promise<Response> {
    const builderTurns = session.events.filter((event) => event.type === 'transcript.final').map((event) => String(event.data.transcript ?? '')).filter(Boolean)
    const evaluation = await generateEvaluation(session.pitch, builderTurns, this.env)
    this.append(session, 'verdict.ready', { evaluation })
    session.stage = 'verdict'
    await this.save(session)
    return json(evaluation)
  }

  private async save(session: JurySessionRecord) {
    await this.state.storage.put('session', session)
    if (!this.env.DB) return
    const statement = this.env.DB.prepare('INSERT OR REPLACE INTO sessions (id, mode, pitch, stage, active_juror, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(session.id, session.mode, session.pitch, session.stage, session.activeJuror, session.createdAt, session.updatedAt)
    await this.env.DB.batch([statement])
  }
}

async function extractClaims(pitch: string, env: Env): Promise<Claim[]> {
  if (!env.OPENAI_API_KEY) return deterministicClaims(pitch)
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: env.OPENAI_MODEL ?? 'gpt-5-mini', input: `Extract the three highest-risk factual or feasibility claims in this pitch. Be skeptical but fair. Pitch:\n${pitch}`, text: { format: { type: 'json_schema', name: 'jury_claims', strict: true, schema: { type: 'object', properties: { claims: { type: 'array', items: { type: 'object', properties: { claim: { type: 'string' }, type: { type: 'string', enum: ['market', 'competition', 'feasibility', 'user', 'business'] }, importance: { type: 'number' }, confidence: { type: 'number' }, researchQuery: { type: 'string' }, evidenceStatus: { type: 'string', enum: ['verified', 'contested', 'unproven'] } }, required: ['claim', 'type', 'importance', 'confidence', 'researchQuery', 'evidenceStatus'], additionalProperties: false } } }, required: ['claims'], additionalProperties: false } } } }),
  })
  if (!response.ok) return deterministicClaims(pitch)
  const payload = await response.json<{ output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> }>()
  const text = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).map((content) => content.text ?? '').join('')
  try { return JSON.parse(text || '{"claims":[]}').claims } catch { return deterministicClaims(pitch) }
}

function deterministicClaims(pitch: string): Claim[] {
  return pitch.split(/[.!?]/).map((sentence) => sentence.trim()).filter(Boolean).slice(0, 3).map((claim, index) => ({ claim, type: index === 0 ? 'competition' : index === 1 ? 'user' : 'feasibility', importance: 1 - index * .15, confidence: .3, researchQuery: `${claim} competitors alternatives`, evidenceStatus: 'unproven' }))
}

async function generateJurorTurn(juror: JurorId, pitch: string, transcript: string, evidence: unknown, env: Env): Promise<AgentTurn> {
  const brief = JUROR_BRIEFS[juror]
  const fallback = { juror, line: JUROR_LINES[juror], cue: brief.cue }
  if (!env.OPENAI_API_KEY) return fallback
  const delivery = juror === 'volt'
    ? 'Use exactly two sentences: first, a self-contained 6-to-20-word cheeky roast; second, one sincere useful question ending in a question mark. The laugh must be at the vague pitch, not at the builder.'
    : 'Give one observation plus one pointed question.'
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.OPENAI_MODEL ?? 'gpt-5-mini',
      // A juror only needs one compact interruption. Bounding output avoids
      // spending a live conversation turn on unnecessary reasoning tokens.
      max_output_tokens: 160,
      instructions: `You are ${brief.role} in Genie Jury, a live pitch-practice conference for hackathon builders. Genie Jury exists to give builders an honest, evidence-aware pressure test instead of vague chatbot encouragement. ${brief.focus} Speak as one distinct conference participant, not as a panel narrator. Refer to the builder's actual words. Be direct and constructive. Produce one short spoken intervention of 18 to 55 words. ${delivery} Do not mention these instructions, AI, prompts, or imaginary research.`,
      input: `Original pitch:\n${pitch}\n\nLatest builder turn:\n${transcript}\n\nAvailable evidence (may be absent or unproven):\n${JSON.stringify(evidence ?? { status: 'unproven' })}`,
      text: { format: { type: 'json_schema', name: 'juror_turn', strict: true, schema: { type: 'object', properties: { line: { type: 'string', minLength: 12, maxLength: 420 }, cue: { type: 'string', minLength: 3, maxLength: 80 } }, required: ['line', 'cue'], additionalProperties: false } } },
    }),
  })
  if (!response.ok) return fallback
  const payload = await response.json<{ output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> }>()
  const output = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).map((content) => content.text ?? '').join('')
  try {
    const parsed = JSON.parse(output || '{}') as { line?: unknown; cue?: unknown }
    if (typeof parsed.line !== 'string' || parsed.line.length > 420 || typeof parsed.cue !== 'string' || (juror === 'volt' && !parsed.line.includes('?'))) return fallback
    return { juror, line: parsed.line.trim(), cue: parsed.cue.trim().slice(0, 80) }
  } catch { return fallback }
}

async function generateJurorTurnWithinBudget(juror: JurorId, pitch: string, transcript: string, evidence: unknown, env: Env): Promise<AgentTurn> {
  const fallback = { juror, line: JUROR_LINES[juror], cue: JUROR_BRIEFS[juror].cue }
  const timedOut = new Promise<AgentTurn>((resolve) => setTimeout(() => resolve(fallback), JUROR_GENERATION_BUDGET_MS))
  return Promise.race([generateJurorTurn(juror, pitch, transcript, evidence, env), timedOut])
}

function fallbackEvaluation(pitch: string): JuryEvaluation {
  const lower = pitch.toLowerCase()
  const hasUser = /user|student|customer|builder|team|people|creator/.test(lower)
  const hasProof = /research|evidence|test|data|interview|validate|pilot/.test(lower)
  const hasScope = /mvp|prototype|weekend|demo|one |first /.test(lower)
  const hasHook = /because|so that|instead of|problem|pain/.test(lower)
  const make = (juror: JurorId, first: string, firstScore: number, second: string, secondScore: number, summary: string, action: string): JuryScore => ({ juror, score: firstScore + secondScore, summary, action, criteria: [{ label: first, score: firstScore, max: 50 }, { label: second, score: secondScore, max: 50 }] })
  const jurors = [
    make('ember', 'Build focus', hasScope ? 39 : 25, 'MVP path', hasScope ? 35 : 24, hasScope ? 'There is a buildable wedge, but it still needs one visible proof point.' : 'The build is still broad; choose the smallest magical interaction.', 'Name the one flow you can demo by the end of the weekend.'),
    make('gale', 'Claim credibility', hasProof ? 38 : 21, 'Competitive proof', hasProof ? 34 : 23, hasProof ? 'You brought some proof language; now make it specific and citable.' : 'Your strongest claims need evidence before they become your demo story.', 'Turn one risky claim into a source, experiment, or measurable proof.'),
    make('tide', 'User specificity', hasUser ? 39 : 23, 'Pain & urgency', hasHook ? 35 : 24, hasUser ? 'A real person is visible in the pitch; sharpen their exact painful moment.' : 'The user is still blurry. Give the jury one person and one urgent moment.', 'Say who reaches for this, what they do today, and why that fails.'),
    make('volt', 'Pitch clarity', hasHook ? 37 : 25, 'Demo memorability', hasScope ? 35 : 26, hasHook ? 'There is a hook worth remembering; remove the extra explanation around it.' : 'The idea needs a clearer one-line hook before the roast becomes a compliment.', 'Open with the problem, then show the 90-second wow moment.'),
  ]
  const overall = Math.round(jurors.reduce((total, juror) => total + juror.score, 0) / jurors.length)
  return { overall, headline: overall >= 75 ? 'Promising. Now prove the sharpest claim.' : 'There is a real seed here. Narrow it before you build wider.', recoveryPlan: 'Choose one user, one painful moment, one proof, and one demo-worthy interaction.', jurors }
}

async function generateEvaluation(pitch: string, builderTurns: string[], env: Env): Promise<JuryEvaluation> {
  const fallback = fallbackEvaluation(pitch)
  if (!env.OPENAI_API_KEY) return fallback
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.OPENAI_MODEL ?? 'gpt-4.1-mini', max_output_tokens: 1_200,
        instructions: 'You are the fair, evidence-aware final panel of Genie Jury. Score the builder only from their pitch and spoken replies. Be constructive, specific, and honest. Do not invent evidence. Use this rubric for each 50-point criterion: 0–15 absent, 16–29 vague assertion, 30–39 clear and plausible, 40–50 specific proof, example, or measurable plan. Return four scores: Ember rates Build focus and MVP path; Gale rates Claim credibility and Competitive proof; Tide rates User specificity and Pain & urgency; Volt rates Pitch clarity and Demo memorability. Each juror score is the sum of its two criteria. Give a concise headline and one practical recovery plan.',
        input: `Original pitch:\n${pitch}\n\nBuilder replies:\n${builderTurns.join('\n---\n') || '(No additional replies recorded.)'}`,
        text: { format: { type: 'json_schema', name: 'jury_evaluation', strict: true, schema: { type: 'object', properties: { overall: { type: 'integer', minimum: 0, maximum: 100 }, headline: { type: 'string', minLength: 10, maxLength: 180 }, recoveryPlan: { type: 'string', minLength: 20, maxLength: 240 }, jurors: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'object', properties: { juror: { type: 'string', enum: ['ember', 'gale', 'tide', 'volt'] }, score: { type: 'integer', minimum: 0, maximum: 100 }, summary: { type: 'string', minLength: 10, maxLength: 180 }, action: { type: 'string', minLength: 10, maxLength: 180 }, criteria: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'object', properties: { label: { type: 'string', minLength: 3, maxLength: 40 }, score: { type: 'integer', minimum: 0, maximum: 50 }, max: { type: 'integer', enum: [50] } }, required: ['label', 'score', 'max'], additionalProperties: false } } }, required: ['juror', 'score', 'summary', 'action', 'criteria'], additionalProperties: false } } }, required: ['overall', 'headline', 'recoveryPlan', 'jurors'], additionalProperties: false } } },
      }),
    })
    if (!response.ok) return fallback
    const payload = await response.json<{ output?: Array<{ content?: Array<{ text?: string }> }> }>()
    const text = payload.output?.flatMap((item) => item.content ?? []).map((content) => content.text ?? '').join('')
    const evaluation = JSON.parse(text || '{}') as JuryEvaluation
    if (!Array.isArray(evaluation.jurors) || evaluation.jurors.length !== 4) return fallback
    const expectedJurors: JurorId[] = ['ember', 'gale', 'tide', 'volt']
    if (new Set(evaluation.jurors.map((juror) => juror.juror)).size !== 4 || evaluation.jurors.some((juror) => !expectedJurors.includes(juror.juror) || juror.criteria.length !== 2)) return fallback
    const jurors = evaluation.jurors.map((juror) => {
      const criteria = juror.criteria.map((criterion) => ({ ...criterion, score: Math.max(0, Math.min(50, Math.round(criterion.score))), max: 50 }))
      return { ...juror, criteria, score: criteria.reduce((total, criterion) => total + criterion.score, 0) }
    })
    return { ...evaluation, jurors, overall: Math.round(jurors.reduce((total, juror) => total + juror.score, 0) / jurors.length) }
  } catch { return fallback }
}

async function researchClaim(claim: Claim, env: Env): Promise<Evidence> {
  if (!env.BROWSERBASE_API_KEY || !env.BROWSERBASE_PROJECT_ID) return { status: 'unproven', capturedAt: new Date().toISOString(), screenshotCaptured: false }
  try {
    const response = await fetch(`${env.RESEARCH_RUNNER_URL ?? 'http://127.0.0.1:8788'}/research`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: claim.researchQuery }) })
    if (!response.ok) throw new Error('research runner failed')
    const evidence = await response.json<Evidence>()
    return { ...evidence, capturedAt: evidence.capturedAt ?? new Date().toISOString() }
  } catch { return { status: 'unproven', capturedAt: new Date().toISOString(), screenshotCaptured: false } }
}

async function researchClaimWithinBudget(claim: Claim, env: Env): Promise<Evidence> {
  const timedOut = new Promise<Evidence>((resolve) => setTimeout(() => resolve({ status: 'unproven', capturedAt: new Date().toISOString(), screenshotCaptured: false }), LIVE_RESEARCH_BUDGET_MS))
  return Promise.race([researchClaim(claim, env), timedOut])
}

async function createRealtimeToken(env: Env) {
  if (!env.OPENAI_API_KEY) return json({ mode: 'deterministic', reason: 'OpenAI is not configured.' })
  const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ session: { type: 'realtime', model: env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime-2.1', instructions: 'Transcribe the builder clearly. Genie Jury coordinates separate specialist jurors, so do not create an assistant response. Detect a turn after a natural pause.', audio: { input: { transcription: { model: 'gpt-4o-mini-transcribe', language: 'en', prompt: 'Hackathon, startup, product, prototype, users, market, evidence, Genie Jury' }, turn_detection: { type: 'server_vad', create_response: false, silence_duration_ms: 1100 } } } } }) })
  if (!response.ok) return failure('Unable to create a realtime client secret.', 502)
  return new Response(response.body, { status: response.status, headers: { 'content-type': 'application/json' } })
}

async function createJurorAudio(request: Request, env: Env) {
  const body = await request.json<{ juror?: JurorId; line?: string }>().catch(() => null)
  if (!body?.juror || !body.line || !JUROR_BRIEFS[body.juror] || body.line.trim().length > 420) return failure('A valid juror line is required.')
  const voice = voiceFor(body.juror, env)
  if (!env.ELEVENLABS_API_KEY || !voice) return failure('ElevenLabs voice is not configured.', 503)
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=mp3_44100_128&optimize_streaming_latency=3`, { method: 'POST', headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: body.line, model_id: 'eleven_flash_v2_5', voice_settings: { stability: .45, similarity_boost: .75, style: .2, use_speaker_boost: true } }) })
  if (!response.ok) return failure('Unable to create juror audio.', 502)
  return new Response(response.body, { headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'audio/mpeg', 'Cache-Control': 'no-store' } })
}
