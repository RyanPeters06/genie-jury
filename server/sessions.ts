import type { ServerResponse } from 'node:http'
import { LiveBrowser, searchWeb } from './browserbase.ts'
import type { BrowserEvent } from './browserbase.ts'
import type { Env } from './env.ts'
import type { AgentId, DeliberationResult, JurorId, SwarmEvent, SwarmRuntime } from './swarm/types.ts'

/**
 * One pitch = one session. Sessions live in memory for the length of a demo,
 * hold the deliberation ledger, and fan every agent/browser event out to the
 * stage over Server-Sent Events so the audience sees the jury work live.
 */

export type Stage = 'created' | 'pitching' | 'deliberating' | 'juror-speaking' | 'awaiting-answer' | 'verdict'

export interface SessionEvent { id: number; type: string; at: string; data: Record<string, unknown> }

export interface Session {
  id: string
  mode: 'Hackathon' | 'Startup'
  pitch: string
  stage: Stage
  createdAt: string
  updatedAt: string
  expiresAt: string
  deliberation: DeliberationResult | null
  interjections: Array<{ juror: JurorId; line: string; trigger: string; at: string }>
  events: SessionEvent[]
  subscribers: Set<ServerResponse>
  browser: LiveBrowser | null
  lastSpokenLine: string
}

const TTL_MS = 6 * 60 * 60 * 1000
const MAX_EVENTS = 400

export class SessionStore {
  private sessions = new Map<string, Session>()
  private env: Env

  constructor(env: Env) { this.env = env }

  create(input: { mode?: 'Hackathon' | 'Startup'; pitch: string }): Session {
    const now = new Date()
    const session: Session = {
      id: crypto.randomUUID(), mode: input.mode ?? 'Hackathon', pitch: input.pitch.trim(), stage: 'created',
      createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
      deliberation: null, interjections: [], events: [], subscribers: new Set(), browser: null, lastSpokenLine: '',
    }
    this.sessions.set(session.id, session)
    this.emit(session, 'session.created', { mode: session.mode })
    return session
  }

  get(id: string): Session | null {
    const session = this.sessions.get(id)
    if (!session) return null
    if (Date.parse(session.expiresAt) < Date.now()) { void this.dispose(session); return null }
    return session
  }

  touch(session: Session, stage?: Stage) {
    session.updatedAt = new Date().toISOString()
    if (stage && stage !== session.stage) {
      session.stage = stage
      this.emit(session, 'session.stage', { stage })
    }
  }

  emit(session: Session, type: string, data: Record<string, unknown>) {
    const event: SessionEvent = { id: session.events.length + 1, type, at: new Date().toISOString(), data }
    session.events.push(event)
    if (session.events.length > MAX_EVENTS) session.events.splice(0, session.events.length - MAX_EVENTS)
    const frame = `id: ${event.id}\nevent: ${type}\ndata: ${JSON.stringify(event)}\n\n`
    for (const subscriber of session.subscribers) {
      try { subscriber.write(frame) } catch { session.subscribers.delete(subscriber) }
    }
  }

  subscribe(session: Session, response: ServerResponse, lastEventId = 0) {
    session.subscribers.add(response)
    for (const event of session.events.filter((item) => item.id > lastEventId)) response.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    response.on('close', () => session.subscribers.delete(response))
  }

  /** The bridge between the swarm and the outside world: events out, Browserbase in. */
  runtime(session: Session): SwarmRuntime {
    const env = this.env
    const forward = (event: SwarmEvent | BrowserEvent) => this.emit(session, event.type, { ...('agent' in event ? { agent: event.agent } : {}), ...event.data })
    return {
      emit: forward,
      search: env.BROWSERBASE_API_KEY ? (query: string, agent: AgentId, numResults?: number) => searchWeb(query, { env, emit: forward, agent }, numResults) : undefined,
      browser: env.BROWSERBASE_API_KEY && env.BROWSERBASE_PROJECT_ID ? (agent: AgentId) => {
        if (!session.browser) session.browser = new LiveBrowser({ env, emit: forward, agent })
        return session.browser
      } : undefined,
    }
  }

  async releaseBrowser(session: Session) {
    const browser = session.browser
    session.browser = null
    await browser?.close()
  }

  async dispose(session: Session) {
    await this.releaseBrowser(session)
    for (const subscriber of session.subscribers) subscriber.end()
    this.sessions.delete(session.id)
  }

  /** Safe, serialisable view of a session for the client. */
  view(session: Session) {
    const { subscribers: _subscribers, browser, events: _events, ...rest } = session
    return { ...rest, browser: browser ? { sessionId: browser.sessionId, liveViewUrl: browser.liveViewUrl } : null }
  }
}
