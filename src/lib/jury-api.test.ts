import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function loadApi(fetchImpl: typeof fetch) {
  vi.stubEnv('VITE_JURY_API_URL', 'http://jury.test')
  vi.stubGlobal('fetch', fetchImpl)
  return import('./jury-api')
}

describe('Jury API client', () => {
  it('reports a connected Worker from its health endpoint', async () => {
    const api = await loadApi(vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })))
    await expect(api.getConnectionState()).resolves.toBe('connected')
  })

  it('reports an unavailable Worker without leaking an error', async () => {
    const api = await loadApi(vi.fn().mockRejectedValue(new Error('network unavailable')))
    await expect(api.getConnectionState()).resolves.toBe('service-unavailable')
  })

  it('rejects a failed juror-audio response for browser fallback', async () => {
    const api = await loadApi(vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })))
    await expect(api.requestJurorAudio('session', 'ember', 'line')).rejects.toThrow('Juror audio is unavailable.')
  })
})
