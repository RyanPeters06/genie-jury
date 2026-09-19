export interface Env {
  JURY_SESSIONS: DurableObjectNamespace
  DB?: D1Database
  EVIDENCE?: R2Bucket
  OPENAI_API_KEY?: string
  OPENAI_MODEL?: string
  BROWSERBASE_API_KEY?: string
  BROWSERBASE_PROJECT_ID?: string
  ELEVENLABS_API_KEY?: string
}

type Stage = 'mic-ready' | 'user-speaking' | 'researching' | 'juror-speaking' | 'awaiting-answer' | 'verdict'
type EventType = 'session.created' | 'transcript.partial' | 'research.started' | 'evidence.added' | 'juror.queued' | 'juror.speaking' | 'verdict.ready'

interface JuryEvent { id: string; type: EventType; createdAt: string; data: Record<string, unknown> }
interface JurySessionRecord { id: string; mode: 'Hackathon' | 'Startup'; pitch: string; stage: Stage; activeJuror: string | null; events: JuryEvent[]; createdAt: string; updatedAt: string }

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), { ...init, headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders, ...init.headers } })
const failure = (message: string, status = 400) => json({ error: message }, { status })

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
    const url = new URL(request.url)
    const segments = url.pathname.split('/').filter(Boolean)
    if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, service: 'genie-jury-worker' })
    if (request.method === 'POST' && url.pathname === '/sessions') {
      const body = await request.json<{ mode?: 'Hackathon' | 'Startup'; pitch?: string }>().catch(() => null)
      if (!body?.pitch?.trim()) return failure('A pitch is required.')
      const id = env.JURY_SESSIONS.newUniqueId()
      const stub = env.JURY_SESSIONS.get(id)
      return stub.fetch('https://jury.internal/initialize', { method: 'POST', body: JSON.stringify({ id: id.toString(), mode: body.mode ?? 'Hackathon', pitch: body.pitch.trim() }) })
    }
    if (segments[0] === 'sessions' && segments[1]) {
      let id: DurableObjectId
      try { id = env.JURY_SESSIONS.idFromString(segments[1]) } catch { return failure('Unknown session.', 404) }
      const stub = env.JURY_SESSIONS.get(id)
      const routeTail = segments.slice(2).join('/')
      const childPath = routeTail ? `/${routeTail}` : '/'
      if (request.method === 'POST' && childPath === '/realtime-token') return createRealtimeToken(request, env)
      return stub.fetch(new Request(`https://jury.internal${childPath}`, request))
    }
    return failure('Route not found.', 404)
  },
} satisfies ExportedHandler<Env>

export class JurySession {
  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/initialize') {
      const body = await request.json<{ id: string; mode: 'Hackathon' | 'Startup'; pitch: string }>()
      const now = new Date().toISOString()
      const session: JurySessionRecord = { id: body.id, mode: body.mode, pitch: body.pitch, stage: 'mic-ready', activeJuror: null, events: [], createdAt: now, updatedAt: now }
      this.append(session, 'session.created', { mode: session.mode })
      await this.save(session)
      return json(session, { status: 201 })
    }
    const session = await this.state.storage.get<JurySessionRecord>('session')
    if (!session) return failure('Session has not been initialized.', 404)
    if (request.method === 'GET' && url.pathname === '/') return json(session)
    if (request.method === 'GET' && url.pathname === '/events') return json({ events: session.events })
    if (request.method === 'POST' && url.pathname === '/events') {
      const body = await request.json<{ type?: EventType; data?: Record<string, unknown>; stage?: Stage; activeJuror?: string | null }>().catch(() => null)
      if (!body?.type) return failure('An event type is required.')
      this.append(session, body.type, body.data ?? {})
      if (body.stage) session.stage = body.stage
      if (body.activeJuror !== undefined) session.activeJuror = body.activeJuror
      await this.save(session)
      return json(session)
    }
    if (request.method === 'POST' && url.pathname === '/research') return this.research(session)
    return failure('Route not found.', 404)
  }

  private append(session: JurySessionRecord, type: EventType, data: Record<string, unknown>) {
    session.events.push({ id: crypto.randomUUID(), type, data, createdAt: new Date().toISOString() })
    session.updatedAt = new Date().toISOString()
  }

  private async research(session: JurySessionRecord): Promise<Response> {
    session.stage = 'researching'
    this.append(session, 'research.started', { owner: 'gale' })
    const claims = await extractClaims(session.pitch, this.env)
    this.append(session, 'evidence.added', { status: 'unproven', claims })
    const browserbase = await createBrowserbaseSession(session, this.env)
    if (browserbase) this.append(session, 'evidence.added', { provider: 'browserbase', browserbase })
    session.stage = 'juror-speaking'
    session.activeJuror = 'gale'
    this.append(session, 'juror.queued', { juror: 'gale', reason: 'highest-risk claim research completed' })
    await this.save(session)
    return json({ session, claims, browserbase })
  }

  private async save(session: JurySessionRecord) {
    await this.state.storage.put('session', session)
    if (!this.env.DB) return
    const sessionStatement = this.env.DB.prepare('INSERT OR REPLACE INTO sessions (id, mode, pitch, stage, active_juror, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(session.id, session.mode, session.pitch, session.stage, session.activeJuror, session.createdAt, session.updatedAt)
    const eventStatements = session.events.map((event) => this.env.DB!.prepare('INSERT OR IGNORE INTO jury_events (id, session_id, type, data_json, created_at) VALUES (?, ?, ?, ?, ?)').bind(event.id, session.id, event.type, JSON.stringify(event.data), event.createdAt))
    await this.env.DB.batch([sessionStatement, ...eventStatements])
  }
}

async function extractClaims(pitch: string, env: Env) {
  if (!env.OPENAI_API_KEY) return deterministicClaims(pitch)
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.OPENAI_MODEL ?? 'gpt-5.6',
      input: `Extract the three highest-risk factual or feasibility claims in this pitch. Be skeptical but fair. Pitch:\n${pitch}`,
      text: { format: { type: 'json_schema', name: 'jury_claims', strict: true, schema: { type: 'object', properties: { claims: { type: 'array', items: { type: 'object', properties: { claim: { type: 'string' }, type: { type: 'string', enum: ['market', 'competition', 'feasibility', 'user', 'business'] }, importance: { type: 'number' }, researchQuery: { type: 'string' } }, required: ['claim', 'type', 'importance', 'researchQuery'], additionalProperties: false } } }, required: ['claims'], additionalProperties: false } } },
    }),
  })
  if (!response.ok) return deterministicClaims(pitch)
  const payload = await response.json<{ output?: Array<{ content?: Array<{ text?: string }> }> }>()
  const text = payload.output?.flatMap((item) => item.content ?? []).map((content) => content.text ?? '').join('')
  try { return JSON.parse(text || '{"claims":[]}').claims } catch { return deterministicClaims(pitch) }
}

function deterministicClaims(pitch: string) {
  const sentences = pitch.split(/[.!?]/).map((sentence) => sentence.trim()).filter(Boolean).slice(0, 3)
  return sentences.map((claim, index) => ({ claim, type: index === 0 ? 'competition' : index === 1 ? 'user' : 'feasibility', importance: 1 - index * .15, researchQuery: `${claim} competitors alternatives` }))
}

async function createBrowserbaseSession(session: JurySessionRecord, env: Env) {
  if (!env.BROWSERBASE_API_KEY || !env.BROWSERBASE_PROJECT_ID) return null
  const response = await fetch('https://api.browserbase.com/v1/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BB-API-Key': env.BROWSERBASE_API_KEY }, body: JSON.stringify({ projectId: env.BROWSERBASE_PROJECT_ID, timeout: 300, browserSettings: { viewport: { width: 1280, height: 720 } }, userMetadata: { product: 'genie-jury', sessionId: session.id, juror: 'gale' } }) })
  if (!response.ok) return { status: 'failed' }
  const payload = await response.json<{ id?: string }>()
  return { status: 'queued', sessionId: payload.id ?? null }
}

async function createRealtimeToken(_request: Request, env: Env) {
  if (!env.OPENAI_API_KEY) return json({ mode: 'deterministic', reason: 'OPENAI_API_KEY is not configured. The browser speech fallback remains available.' })
  const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ session: { type: 'realtime', model: 'gpt-realtime-2.1' } }) })
  if (!response.ok) return failure('Unable to create a realtime client secret.', 502)
  return new Response(response.body, { status: response.status, headers: { 'content-type': 'application/json', ...corsHeaders } })
}
