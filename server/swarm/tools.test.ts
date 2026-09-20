import { describe, expect, it, vi } from 'vitest'
import { readPage } from './tools.ts'
import type { SwarmRuntime, WebBrowser } from './types.ts'

function browserStub() {
  const open = vi.fn().mockResolvedValue(undefined)
  const capture = vi.fn().mockResolvedValue({
    url: 'https://example.test/page', finalUrl: 'https://example.test/page',
    title: 'Live page', excerpt: 'A live browser capture with enough readable text to stand in for a rendered page. '.repeat(3),
    capturedAt: '2026-01-01T00:00:00.000Z',
  })
  return { open, capture, browser: { active: false, liveViewUrl: null, mode: 'playwright', open, capture, act: vi.fn(), extract: vi.fn(), close: vi.fn() } as unknown as WebBrowser }
}

function runtime(overrides: Partial<SwarmRuntime> = {}): SwarmRuntime {
  return { emit: vi.fn(), ...overrides }
}

describe('readPage', () => {
  it('uses a substantial Fetch API response without opening the live browser', async () => {
    const page = browserStub()
    const result = await readPage(runtime({ fetchPage: vi.fn().mockResolvedValue({ finalUrl: 'https://example.test/fetch', title: 'Fetched page', text: 'x'.repeat(600) }), browser: () => page.browser }), 'ember', 'https://example.test/fetch')
    expect(result).toMatchObject({ via: 'fetch', title: 'Fetched page' })
    expect(page.open).not.toHaveBeenCalled()
  })

  it('falls back to the live browser when Fetch returns too little text', async () => {
    const page = browserStub()
    const result = await readPage(runtime({ fetchPage: vi.fn().mockResolvedValue({ finalUrl: 'https://example.test/fetch', title: 'Thin page', text: 'too short' }), browser: () => page.browser }), 'tide', 'https://example.test/fetch')
    expect(result).toMatchObject({ via: 'live', title: 'Live page' })
    expect(page.open).toHaveBeenCalledOnce()
  })

  it('falls back to the live browser when Fetch has no result', async () => {
    const page = browserStub()
    const result = await readPage(runtime({ fetchPage: vi.fn().mockResolvedValue(null), browser: () => page.browser }), 'ember', 'https://example.test/fetch')
    expect(result?.via).toBe('live')
    expect(page.capture).toHaveBeenCalledOnce()
  })

  it('returns null when neither Fetch nor a browser is available', async () => {
    await expect(readPage(runtime(), 'tide', 'https://example.test/no-provider')).resolves.toBeNull()
  })

  it('skips Fetch when the caller requires the live browser', async () => {
    const page = browserStub()
    const fetchPage = vi.fn()
    const result = await readPage(runtime({ fetchPage, browser: () => page.browser }), 'gale', 'https://example.test/live', { preferLive: true })
    expect(result?.via).toBe('live')
    expect(fetchPage).not.toHaveBeenCalled()
    expect(page.open).toHaveBeenCalledOnce()
  })
})
