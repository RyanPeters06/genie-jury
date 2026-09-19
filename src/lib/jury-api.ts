export type RemoteSession = { id: string; stage: string }

const apiBase = import.meta.env.VITE_JURY_API_URL?.replace(/\/$/, '')

export async function createRemoteSession(input: { mode: 'Hackathon' | 'Startup'; pitch: string }): Promise<RemoteSession | null> {
  if (!apiBase) return null
  const response = await fetch(`${apiBase}/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
  if (!response.ok) throw new Error('The Jury service did not create a session.')
  return response.json() as Promise<RemoteSession>
}

export async function requestResearch(sessionId: string): Promise<void> {
  if (!apiBase) return
  const response = await fetch(`${apiBase}/sessions/${sessionId}/research`, { method: 'POST' })
  if (!response.ok) throw new Error('The Skeptic could not start research.')
}
