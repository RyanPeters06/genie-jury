import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { browserbaseConfigured } from './browserbase.ts'
import { synthesize } from './elevenlabs.ts'
import { loadEnv, serviceHealth, voiceFingerprint } from './env.ts'
import { createRealtimeSecret, detectInterjection } from './openai.ts'
import { validatePitch } from './pitch-validation.ts'
import { SessionStore } from './sessions.ts'
import type { Session } from './sessions.ts'
import { JURORS } from './swarm/agents.ts'
import { deliberate, respond } from './swarm/deliberate.ts'
import type { JurorId } from './swarm/types.ts'

/**
 * Genie Jury API. One Node process owns every provider credential:
 *   OpenAI      Realtime (transcription secret), Responses (agents, tools, structured output)
 *   ElevenLabs  one expressive voice per juror
 *   Browserbase Search API, live cloud browser sessions, Stagehand actions
 * The browser only ever sees short-lived tokens, normalised evidence, and audio.
 */

const env = loadEnv()
const store = new SessionStore(env)
const MAX_INTERJECTIONS = 2

const json = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers })
  response.end(JSON.stringify(body))
}
const failure = (response: ServerResponse, message: string, status = 400) => json(response, status, { error: message })

async function readJson<T>(request: IncomingMessage): Promise<T | null> {
  let raw = ''
  for await (const chunk of request) raw += chunk
  if (!raw) return {} as T
  try { return JSON.parse(raw) as T } catch { return null }
}

function corsHeaders(request: IncomingMessage): Record<string, string> {
  const origin = request.headers.origin
  const allowed = new Set(['http://127.0.0.1:5174', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://localhost:5173', env.PUBLIC_APP_ORIGIN].filter(Boolean))
  if (!origin || !allowed.has(origin)) return { Vary: 'Origin' }
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type, Last-Event-ID', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin' }
}

async function pipe(upstream: Response, response: ServerResponse, extra: Record<string, string>) {
  const headers: Record<string, string> = { ...extra }
  upstream.headers.forEach((value, key) => { headers[key] = value })
  response.writeHead(upstream.status, headers)
  if (!upstream.body) return response.end()
  const reader = upstream.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      response.write(value)
    }
  } finally { response.end() }
}

const isJuror = (value: unknown): value is JurorId => typeof value === 'string' && value in JURORS

async function handle(request: IncomingMessage, response: ServerResponse) {
  const cors = corsHeaders(request)
  if (request.method === 'OPTIONS') { response.writeHead(204, cors); return response.end() }
  const url = new URL(request.url ?? '/', 'http://local')
  const parts = url.pathname.split('/').filter(Boolean)
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => json(response, status, body, { ...cors, ...headers })
  const fail = (message: string, status = 400) => reply(status, { error: message })

  if (request.method === 'GET' && url.pathname === '/health') return reply(200, { ok: true, service: 'genie-jury-api' })
  if (request.method === 'GET' && url.pathname === '/health/services') return reply(200, { ok: true, services: serviceHealth(env) })
  if (request.method === 'GET' && url.pathname === '/jurors') return reply(200, { jurors: Object.values(JURORS).map(({ id, name, role, cue, mandate, audioTags }) => ({ id, name, role, cue, mandate, audioTags })) })

  if (request.method === 'POST' && url.pathname === '/sessions') {
    const body = await readJson<{ mode?: 'Hackathon' | 'Startup'; pitch?: string }>(request)
    if (!body) return fail('The session request was not valid.')
    // Voice sessions deliberately begin blank. The pitch is assessed only once
    // the builder has actually said enough to be judged.
    const session = store.create({ mode: body.mode, pitch: body.pitch?.trim() ?? '' })
    return reply(201, store.view(session))
  }

  if (parts[0] !== 'sessions' || !parts[1]) return fail('Route not found.', 404)
  const session = store.get(parts[1])
  if (!session) return fail('Unknown or expired session.', 404)
  const tail = parts.slice(2).join('/')

  if (request.method === 'GET' && tail === '') return reply(200, store.view(session))

  if (request.method === 'GET' && tail === 'stream') {
    response.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    response.write(': connected\n\n')
    store.subscribe(session, response, Number(request.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0))
    return
  }

  if (request.method === 'POST' && tail === 'realtime-token') return pipe(await createRealtimeSecret(env), response, cors)

  if (request.method === 'POST' && tail === 'pitch') {
    const body = await readJson<{ transcript?: string }>(request)
    if (body?.transcript?.trim()) session.pitch = body.transcript.trim()
    store.touch(session, 'pitching')
    store.emit(session, 'pitch.updated', { pitch: session.pitch })
    return reply(200, store.view(session))
  }

  if (request.method === 'POST' && tail === 'interject') {
    const body = await readJson<{ pitchSoFar?: string; newText?: string }>(request)
    if (!body?.newText?.trim()) return reply(200, { interjection: null })
    if (session.interjections.length >= MAX_INTERJECTIONS) return reply(200, { interjection: null, reason: 'budget' })
    const interjection = await detectInterjection({ pitchSoFar: body.pitchSoFar ?? '', newText: body.newText, alreadyUsed: session.interjections.map((item) => item.juror) }, env)
    if (!interjection) return reply(200, { interjection: null })
    session.interjections.push({ ...interjection, at: new Date().toISOString() })
    store.emit(session, 'juror.interjects', { juror: interjection.juror, line: interjection.line, trigger: interjection.trigger })
    return reply(200, { interjection })
  }

  if (request.method === 'POST' && tail === 'deliberate') {
    const body = await readJson<{ transcript?: string }>(request)
    const validation = validatePitch(body?.transcript ?? session.pitch)
    if (!validation.valid) {
      store.touch(session, 'pitching')
      store.emit(session, 'pitch.invalid', { code: validation.code, message: validation.message })
      return reply(422, { error: 'invalid-pitch', code: validation.code, message: validation.message })
    }
    session.pitch = validation.pitch
    store.touch(session, 'deliberating')
    try {
      const result = await deliberate(session.pitch, session.mode, env, store.runtime(session))
      session.deliberation = result
      store.touch(session, 'juror-speaking')
      store.emit(session, 'deliberation.ready', { runId: result.runId, mode: result.mode, turns: result.turns.map((turn) => ({ juror: turn.juror, cue: turn.cue })), verdict: result.verdict.headline })
      return reply(200, result)
    } catch (error) {
      store.emit(session, 'deliberation.failed', { error: error instanceof Error ? error.message : String(error) })
      return fail('The jury could not finish deliberating.', 502)
    }
  }

  if (request.method === 'POST' && tail === 'respond') {
    const body = await readJson<{ juror?: JurorId; transcript?: string }>(request)
    if (!isJuror(body?.juror) || !body?.transcript?.trim()) return fail('A juror and a transcript are required.')
    if (!session.deliberation) return fail('Deliberate first.', 409)
    store.touch(session, 'deliberating')
    const { turn, result } = await respond(session.deliberation, body.juror, body.transcript.trim(), env, store.runtime(session))
    session.deliberation = result
    store.touch(session, 'juror-speaking')
    store.emit(session, 'juror.replied', { juror: turn.juror, line: turn.line, cue: turn.cue })
    return reply(200, { turn, runTree: result.runTree, ledger: result.ledger })
  }

  if (request.method === 'POST' && tail === 'juror-audio') {
    const body = await readJson<{ juror?: JurorId; line?: string }>(request)
    if (!isJuror(body?.juror) || !body?.line?.trim() || body.line.length > 520) return fail('A valid juror line is required.')
    const previousText = session.lastSpokenLine
    session.lastSpokenLine = body.line
    store.emit(session, 'juror.audio', { juror: body.juror, chars: body.line.length })
    return pipe(await synthesize({ juror: body.juror, line: body.line, previousText }, env), response, cors)
  }

  if (request.method === 'POST' && tail === 'finish') {
    store.touch(session, 'verdict')
    await store.releaseBrowser(session)
    return reply(200, store.view(session))
  }

  if (request.method === 'GET' && tail === 'deliberation') return session.deliberation ? reply(200, session.deliberation) : fail('No deliberation yet.', 404)

  return fail('Route not found.', 404)
}

http.createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error(error)
    if (!response.headersSent) failure(response, 'Internal error.', 500)
    else response.end()
  })
}).listen(env.PORT, '127.0.0.1', () => {
  const services = serviceHealth(env)
  console.log(`Genie Jury API on http://127.0.0.1:${env.PORT}  openai=${services.openai} elevenlabs=${services.elevenlabs} (${services.elevenlabsModel}) browserbase=${browserbaseConfigured(env) ? 'configured' : services.browserbase}`)
  console.log(`  voices ${voiceFingerprint(env)}`)
})

export type { Session }
