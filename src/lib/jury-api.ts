export type RemoteSession = { id: string; stage: string }
export type ConnectionState = 'checking' | 'connected' | 'demo-fallback' | 'service-unavailable'
export type JurorId = 'ember' | 'gale' | 'tide' | 'volt'
export type JurorTurn = { juror: JurorId; line: string; cue: string }
export type JuryCriterion = { label: string; score: number; max: number }
export type JuryScore = { juror: JurorId; score: number; summary: string; action: string; criteria: JuryCriterion[] }
export type JuryEvaluation = { overall: number; headline: string; recoveryPlan: string; jurors: JuryScore[] }

const apiBase = import.meta.env.VITE_JURY_API_URL?.replace(/\/$/, '')

async function request(path: string, init?: RequestInit) {
  if (!apiBase) throw new Error('The Jury API URL is not configured.')
  return fetch(`${apiBase}${path}`, init)
}

export async function getConnectionState(): Promise<ConnectionState> {
  if (!apiBase) return 'demo-fallback'
  try {
    const response = await request('/health')
    return response.ok ? 'connected' : 'service-unavailable'
  } catch { return 'service-unavailable' }
}

export async function createRemoteSession(input: { mode: 'Hackathon' | 'Startup'; pitch: string }): Promise<RemoteSession | null> {
  if (!apiBase) return null
  const response = await request('/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
  if (!response.ok) throw new Error('The Jury service did not create a session.')
  return response.json() as Promise<RemoteSession>
}

export async function appendFinalTranscript(sessionId: string, transcript: string) {
  const response = await request(`/sessions/${sessionId}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'transcript.final', stage: 'researching', data: { transcript } }) })
  if (!response.ok) throw new Error('The Jury service did not save the transcript.')
}

export async function requestResearch(sessionId: string): Promise<void> {
  if (!apiBase) return
  const response = await request(`/sessions/${sessionId}/research`, { method: 'POST' })
  if (!response.ok) throw new Error('The Skeptic could not start research.')
}

export async function requestJurorTurn(sessionId: string, juror: JurorId, transcript: string): Promise<JurorTurn> {
  const response = await request(`/sessions/${sessionId}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ juror, transcript }) })
  if (!response.ok) throw new Error('The Jury could not prepare a response.')
  return response.json() as Promise<JurorTurn>
}

export async function requestJuryEvaluation(sessionId: string): Promise<JuryEvaluation> {
  const response = await request(`/sessions/${sessionId}/evaluation`, { method: 'POST' })
  if (!response.ok) throw new Error('The Jury could not complete its scorecard.')
  return response.json() as Promise<JuryEvaluation>
}

export async function requestRealtimeSecret(sessionId: string): Promise<string | null> {
  const response = await request(`/sessions/${sessionId}/realtime-token`, { method: 'POST' })
  if (!response.ok) return null
  const payload = await response.json() as { value?: string; client_secret?: { value?: string }; mode?: string }
  return payload.value ?? payload.client_secret?.value ?? null
}

export async function requestJurorAudio(sessionId: string, juror: JurorId, line: string) {
  const response = await request(`/sessions/${sessionId}/juror-audio`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ juror, line }) })
  if (!response.ok) throw new Error('Juror audio is unavailable.')
  return response.blob()
}
