export type ConnectionState = 'checking' | 'connected' | 'demo-fallback' | 'service-unavailable'
export type JurorId = 'ember' | 'gale' | 'tide' | 'volt'
export type EvidenceStatus = 'verified' | 'contested' | 'unproven'
export type Vote = 'BUILD' | 'PIVOT' | 'PROVE' | 'ROASTED'

export type RemoteSession = { id: string; mode: 'Hackathon' | 'Startup'; pitch: string; stage: string; browser: { sessionId: string | null; liveViewUrl: string | null } | null }
export type JurorTurn = { juror: JurorId; line: string; cue: string; basedOn: { findingIds: string[]; evidenceIds: string[]; messagesFrom: string[] } }
export type Evidence = { claimId?: string; query?: string; status: EvidenceStatus; sourceUrl?: string; title?: string; excerpt?: string; rationale?: string; sources?: Array<{ title: string; url: string; snippet: string }>; screenshotDataUrl?: string; capturedAt: string; screenshotCaptured: boolean; requestedBy?: string }
export type Finding = { id: string; agent: string; kind: string; summary: string; claimId?: string; severity: number; createdAt: string }
export type AgentMessage = { id: string; from: string; to: string; kind: string; payload: Record<string, unknown>; createdAt: string }
export type RunNode = { id: string; parentId: string | null; kind: string; agent: string; label: string; status: string; startedAt: string; endedAt?: string; data?: Record<string, unknown> }
export type ToolCall = { id: string; agent: string; tool: string; args: Record<string, unknown>; result: unknown; ok: boolean; durationMs: number }
export type Verdict = { headline: string; summary: string; smallestNextBuild: string; scopeCut: string; evidenceQuestion: string; userTest: string; votes: Record<JurorId, { vote: Vote; because: string }> }
export type Ledger = { pitch: string; claims: Array<{ id: string; claim: string; type: string; importance: number; evidenceStatus: EvidenceStatus }>; evidence: Evidence[]; assignments: Array<{ juror: JurorId; question: string; claimIds: string[]; reason: string }>; findings: Finding[]; messages: AgentMessage[]; toolCalls: ToolCall[]; builderAnswers: Array<{ toJuror: JurorId; transcript: string; createdAt: string }> }
export type Deliberation = { runId: string; mode: 'live' | 'deterministic'; ledger: Ledger; runTree: RunNode[]; turns: JurorTurn[]; verdict: Verdict; startedAt: string; endedAt: string }
export type Interjection = { interrupt: boolean; juror: JurorId; line: string; trigger: string }
export type StageEvent = { id: number; type: string; at: string; data: Record<string, unknown> }

/** A recoverable input problem, not a provider failure. */
export class PitchValidationError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PitchValidationError'
    this.code = code
  }
}

const apiBase = import.meta.env.VITE_JURY_API_URL?.replace(/\/$/, '')

async function request(path: string, init?: RequestInit) {
  if (!apiBase) throw new Error('The Jury API URL is not configured.')
  return fetch(`${apiBase}${path}`, init)
}

const post = (path: string, body?: unknown) => request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

export async function getConnectionState(): Promise<ConnectionState> {
  if (!apiBase) return 'demo-fallback'
  try {
    const response = await request('/health')
    return response.ok ? 'connected' : 'service-unavailable'
  } catch { return 'service-unavailable' }
}

export async function getServiceHealth(): Promise<Record<string, string> | null> {
  try {
    const response = await request('/health/services')
    if (!response.ok) return null
    return ((await response.json()) as { services: Record<string, string> }).services
  } catch { return null }
}

export async function createRemoteSession(input: { mode: 'Hackathon' | 'Startup'; pitch: string }): Promise<RemoteSession | null> {
  if (!apiBase) return null
  const response = await post('/sessions', input)
  if (!response.ok) throw new Error('The Jury service did not create a session.')
  return response.json() as Promise<RemoteSession>
}

export async function requestRealtimeSecret(sessionId: string): Promise<string | null> {
  const response = await post(`/sessions/${sessionId}/realtime-token`)
  if (!response.ok) return null
  const payload = await response.json() as { value?: string; client_secret?: { value?: string }; mode?: string }
  return payload.value ?? payload.client_secret?.value ?? null
}

export async function requestInterjection(sessionId: string, input: { pitchSoFar: string; newText: string }): Promise<Interjection | null> {
  const response = await post(`/sessions/${sessionId}/interject`, input)
  if (!response.ok) return null
  return ((await response.json()) as { interjection: Interjection | null }).interjection
}

export async function requestDeliberation(sessionId: string, transcript: string): Promise<Deliberation> {
  const response = await post(`/sessions/${sessionId}/deliberate`, { transcript })
  if (response.status === 422) {
    const body = await response.json().catch(() => ({})) as { code?: string; message?: string }
    throw new PitchValidationError(body.code ?? 'invalid-pitch', body.message ?? 'The jury needs a fuller pitch before it can deliberate.')
  }
  if (!response.ok) throw new Error('The jury could not finish deliberating.')
  return response.json() as Promise<Deliberation>
}

export async function requestReply(sessionId: string, juror: JurorId, transcript: string): Promise<{ turn: JurorTurn; runTree: RunNode[]; ledger: Ledger }> {
  const response = await post(`/sessions/${sessionId}/respond`, { juror, transcript })
  if (!response.ok) throw new Error('The juror could not reply.')
  return response.json() as Promise<{ turn: JurorTurn; runTree: RunNode[]; ledger: Ledger }>
}

export async function requestJurorAudio(sessionId: string, juror: JurorId, line: string) {
  const response = await post(`/sessions/${sessionId}/juror-audio`, { juror, line })
  if (!response.ok) throw new Error('Juror audio is unavailable.')
  return response.blob()
}

export async function finishRemoteSession(sessionId: string) {
  try { await post(`/sessions/${sessionId}/finish`) } catch { /* the stage does not depend on this */ }
}

/** Live stage feed: every agent step, message, tool call, and browser event as it happens. */
export function subscribeToStage(sessionId: string, onEvent: (event: StageEvent) => void): () => void {
  if (!apiBase || typeof EventSource === 'undefined') return () => undefined
  const source = new EventSource(`${apiBase}/sessions/${sessionId}/stream`)
  const handler = (event: MessageEvent) => {
    try { onEvent(JSON.parse(event.data) as StageEvent) } catch { /* ignore malformed frames */ }
  }
  const types = ['session.stage', 'pitch.updated', 'pitch.invalid', 'juror.interjects', 'deliberation.ready', 'deliberation.failed', 'juror.replied', 'juror.turn', 'juror.audio', 'ledger.node', 'ledger.finding', 'ledger.evidence', 'ledger.message', 'browser.session', 'browser.search', 'browser.navigate', 'browser.screenshot', 'browser.act', 'browser.extract', 'browser.closed', 'browser.error']
  for (const type of types) source.addEventListener(type, handler as EventListener)
  return () => source.close()
}
