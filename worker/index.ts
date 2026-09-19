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

const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const JUROR_LINES: Record<JurorId, string> = {
  ember: 'The moment is strong. The scope is not. Pick one magical interaction and make it impossible to ignore.',
  gale: 'You said nobody does this. I found close alternatives—but none with your exact hackathon wedge.',
  tide: 'I would use this before demo day, when I need an honest teammate instead of an encouraging chatbot.',
  volt: 'If your pitch says AI-powered before it says who has the problem, I am throwing the lamp.',
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

async function researchClaim(claim: Claim, env: Env): Promise<Evidence> {
  if (!env.BROWSERBASE_API_KEY || !env.BROWSERBASE_PROJECT_ID) return { status: 'unproven', capturedAt: new Date().toISOString(), screenshotCaptured: false }
  try {
    const response = await fetch(`${env.RESEARCH_RUNNER_URL ?? 'http://127.0.0.1:8788'}/research`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: claim.researchQuery }) })
    if (!response.ok) throw new Error('research runner failed')
    const evidence = await response.json<Evidence>()
    return { ...evidence, capturedAt: evidence.capturedAt ?? new Date().toISOString() }
  } catch { return { status: 'unproven', capturedAt: new Date().toISOString(), screenshotCaptured: false } }
}

async function createRealtimeToken(env: Env) {
  if (!env.OPENAI_API_KEY) return json({ mode: 'deterministic', reason: 'OpenAI is not configured.' })
  const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ session: { type: 'realtime', model: env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime-2.1', audio: { input: { transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'server_vad', create_response: false } } } } }) })
  if (!response.ok) return failure('Unable to create a realtime client secret.', 502)
  return new Response(response.body, { status: response.status, headers: { 'content-type': 'application/json' } })
}

async function createJurorAudio(request: Request, env: Env) {
  const body = await request.json<{ juror?: JurorId; line?: string }>().catch(() => null)
  if (!body?.juror || !body.line || JUROR_LINES[body.juror] !== body.line) return failure('Only approved juror lines can be voiced.')
  const voice = voiceFor(body.juror, env)
  if (!env.ELEVENLABS_API_KEY || !voice) return failure('ElevenLabs voice is not configured.', 503)
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=mp3_44100_128&optimize_streaming_latency=3`, { method: 'POST', headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: body.line, model_id: 'eleven_flash_v2_5', voice_settings: { stability: .45, similarity_boost: .75, style: .2, use_speaker_boost: true } }) })
  if (!response.ok) return failure('Unable to create juror audio.', 502)
  return new Response(response.body, { headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'audio/mpeg', 'Cache-Control': 'no-store' } })
}
