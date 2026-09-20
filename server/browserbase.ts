import { chromium } from 'playwright-core'
import type { Browser, Page as PlaywrightPage } from 'playwright-core'
import type { Page as StagehandPage, Stagehand, StagehandBrowser } from '@browserbasehq/stagehand'
import type { Env } from './env.ts'
import type { WebBrowser } from './swarm/types.ts'

/**
 * Gale's hands on the web: Browserbase.
 *
 * Three capabilities, each surfaced on stage so the audience can see them:
 *   search   — Browserbase Search API: real results for a journalist-style query.
 *   browse   — a live cloud browser session (visible through its live-view URL):
 *              open the source, read it, screenshot it.
 *   act      — Stagehand on the same session for natural-language actions and
 *              extraction when a page needs interaction (dismiss a modal, open
 *              pricing, expand reviews) before it can be read.
 *
 * When an OpenAI key is present the session is launched by Stagehand so its
 * extension is installed and `act`/`extract` work. Otherwise the session is
 * created through the REST API and driven with Playwright over CDP, which still
 * gives the live view, page text, and screenshots.
 */

export interface SearchResult { title: string; url: string; snippet: string }

export interface BrowserEvent {
  type: 'browser.session' | 'browser.search' | 'browser.fetch' | 'browser.navigate' | 'browser.screenshot' | 'browser.act' | 'browser.extract' | 'browser.closed' | 'browser.error'
  at: string
  agent: string
  data: Record<string, unknown>
}

export interface PageCapture {
  url: string
  finalUrl: string
  title: string
  excerpt: string
  screenshotDataUrl?: string
  capturedAt: string
}

export interface BrowserbaseContext {
  env: Env
  emit: (event: BrowserEvent) => void
  agent: string
}

export function browserbaseConfigured(env: Env) { return Boolean(env.BROWSERBASE_API_KEY && env.BROWSERBASE_PROJECT_ID) }

const headers = (env: Env) => ({ 'Content-Type': 'application/json', 'X-BB-API-Key': env.BROWSERBASE_API_KEY ?? '' })
const now = () => new Date().toISOString()
const SESSION_TIMEOUT_S = 300

/**
 * Nothing on stage may hang. Every browser operation races a deadline, because
 * a page that never settles would otherwise block the shared queue and freeze
 * the whole deliberation while an audience watches.
 */
const OPEN_MS = 25000
const CAPTURE_MS = 28000
const ACT_MS = 30000
const FETCH_MS = 9000

class TimeoutError extends Error {
  constructor(what: string, ms: number) { super(`${what} timed out after ${ms}ms`) }
}

function withTimeout<T>(what: string, ms: number, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new TimeoutError(what, ms)), ms) }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>
}

// ---------------------------------------------------------------------------
// Search API
// ---------------------------------------------------------------------------

export async function searchWeb(query: string, ctx: BrowserbaseContext, numResults = 5): Promise<SearchResult[]> {
  if (!ctx.env.BROWSERBASE_API_KEY) return []
  try {
    const response = await fetch('https://api.browserbase.com/v1/search', { method: 'POST', headers: headers(ctx.env), body: JSON.stringify({ query, numResults }) })
    if (!response.ok) throw new Error(`search ${response.status}`)
    const payload = await response.json() as { results?: Array<Record<string, unknown>> }
    const results = (payload.results ?? []).map((item) => ({
      title: String(item.title ?? item.name ?? ''),
      url: String(item.url ?? item.link ?? ''),
      snippet: String(item.snippet ?? item.description ?? item.content ?? item.text ?? '').replace(/\s+/g, ' ').slice(0, 320),
    })).filter((item) => item.url.startsWith('http'))
    ctx.emit({ type: 'browser.search', at: now(), agent: ctx.agent, data: { query, results: results.slice(0, numResults) } })
    return results
  } catch (error) {
    ctx.emit({ type: 'browser.error', at: now(), agent: ctx.agent, data: { step: 'search', query, error: String(error) } })
    return []
  }
}

/**
 * Browserbase Fetch API: a page's content without a browser session. Jurors who
 * do not need the live view read through this, so they stop queueing behind the
 * one juror who does.
 */
export async function fetchPage(url: string, ctx: BrowserbaseContext, options: { timeoutMs?: number; actor?: string } = {}): Promise<{ statusCode: number; content: string; format: 'markdown' | 'raw' } | null> {
  if (!ctx.env.BROWSERBASE_API_KEY) return null
  const actor = options.actor ?? ctx.agent
  const started = Date.now()
  const once = async (format: 'markdown' | 'raw') => {
    const response = await fetch('https://api.browserbase.com/v1/fetch', {
      method: 'POST', headers: headers(ctx.env),
      body: JSON.stringify({ url, allowRedirects: true, format }),
      signal: AbortSignal.timeout(options.timeoutMs ?? FETCH_MS),
    })
    if (!response.ok) throw new Error(`fetch ${response.status}`)
    const payload = await response.json() as { statusCode: number; content: unknown }
    return { statusCode: payload.statusCode, content: typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.content), format }
  }
  try {
    // Markdown is far cheaper to feed a model, but some pages render empty
    // through it. Raw still has the text, and one more request is much cheaper
    // than falling all the way back to a live browser session.
    let result = await once('markdown')
    if (result.content.trim().length < 400) result = await once('raw')
    ctx.emit({ type: 'browser.fetch', at: now(), agent: actor, data: { url, statusCode: result.statusCode, format: result.format, chars: result.content.length, durationMs: Date.now() - started } })
    return result
  } catch (error) {
    ctx.emit({ type: 'browser.error', at: now(), agent: actor, data: { step: 'fetch', url, error: String(error) } })
    return null
  }
}

/** Fetch returns markdown; give it the same shape a live capture yields. */
export function readableFromMarkdown(url: string, markdown: string): { finalUrl: string; title: string; text: string } {
  // Raw fetches arrive as HTML; drop the machinery before anything reads it.
  if (/<\/?(html|body|script|div|p)/i.test(markdown)) {
    markdown = markdown
      .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
  }
  const lines = markdown.split(/\r?\n/)
  const heading = lines.find((line) => line.startsWith('# '))?.slice(2).trim()
  const firstLine = lines.find((line) => line.trim().length > 0 && line.trim().length < 120)?.trim()
  let host = url
  try { host = new URL(url).hostname.replace(/^www\./, '') } catch { /* keep the raw url */ }
  const text = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_>`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2400)
  return { finalUrl: url, title: heading || firstLine || host, text }
}

// ---------------------------------------------------------------------------
// Live browser session
// ---------------------------------------------------------------------------

export class LiveBrowser {
  sessionId: string | null = null
  liveViewUrl: string | null = null
  private ctx: BrowserbaseContext
  private stagehand: Stagehand | null = null
  private stagehandBrowser: StagehandBrowser | null = null
  private playwright: Browser | null = null
  private playwrightPage: PlaywrightPage | null = null
  private connectUrl: string | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(ctx: BrowserbaseContext) { this.ctx = ctx }

  get active() { return Boolean(this.sessionId) }
  get mode(): 'stagehand' | 'playwright' | 'closed' { return this.stagehand ? 'stagehand' : this.connectUrl ? 'playwright' : 'closed' }

  /**
   * A per-juror handle onto the one shared session. The actor is captured
   * lexically per call, so events name whoever queued the work rather than
   * whoever opened the session first. Storing the actor on the instance would
   * not work: operations wait in `locked`, so a later caller would overwrite
   * the name before an earlier one finished emitting. The getters read through
   * to the live object, keeping `active` and `mode` current.
   */
  viewFor(agent: string): WebBrowser {
    // Arrows capture `this` lexically, so the handle stays a thin pass-through
    // and the getters keep reading the live session rather than a snapshot.
    const active = () => this.active
    const liveViewUrl = () => this.liveViewUrl
    const mode = () => this.mode
    return {
      get active() { return active() },
      get liveViewUrl() { return liveViewUrl() },
      get mode() { return mode() },
      open: () => this.open(agent),
      capture: (url, options) => this.capture(url, options, agent),
      act: (instruction, budgetMs) => this.act(instruction, budgetMs, agent),
      extract: (instruction, budgetMs) => this.extract(instruction, budgetMs, agent),
      close: () => this.close(agent),
    }
  }

  /** Jurors share one browser; serialise their use of it. */
  private locked<T>(label: string, ms: number, work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => withTimeout(label, ms, work()), () => withTimeout(label, ms, work()))
    this.queue = next.catch(() => undefined)
    return next
  }

  async open(actor: string = this.ctx.agent) {
    return this.locked('browser.open', OPEN_MS, async () => {
      if (this.sessionId) return this
      const { env } = this.ctx
      if (!browserbaseConfigured(env)) throw new Error('Browserbase is not configured')
      const sessionParams = { projectId: env.BROWSERBASE_PROJECT_ID!, timeout: SESSION_TIMEOUT_S, browserSettings: { viewport: { width: 1280, height: 800 }, blockAds: true }, userMetadata: { product: 'genie-jury', agent: actor } }

      if (env.OPENAI_API_KEY) {
        try {
          const { Stagehand, browserbase } = await import('@browserbasehq/stagehand')
          this.stagehandBrowser = await withTimeout('stagehand.launch', 15000, browserbase.launch({ apiKey: env.BROWSERBASE_API_KEY!, ...sessionParams }))
          this.stagehand = await withTimeout('stagehand.create', 15000, Stagehand.create({ browser: this.stagehandBrowser, apiKey: env.BROWSERBASE_API_KEY, model: { modelName: `openai/${env.OPENAI_FAST_MODEL}` as 'openai/gpt-5-mini', apiKey: env.OPENAI_API_KEY }, systemPrompt: 'You are Gale, a skeptical researcher gathering evidence for a pitch jury. Be efficient; dismiss popups and cookie banners without hesitation.' }))
          this.sessionId = this.stagehandBrowser.sessionId ?? null
        } catch (error) {
          this.ctx.emit({ type: 'browser.error', at: now(), agent: actor, data: { step: 'stagehand.launch', error: String(error) } })
          this.stagehand = null
          this.stagehandBrowser = null
        }
      }

      if (!this.sessionId) {
        const created = await fetch('https://api.browserbase.com/v1/sessions', { method: 'POST', headers: headers(env), body: JSON.stringify(sessionParams) })
        if (!created.ok) throw new Error(`Browserbase did not create a session (${created.status})`)
        const session = await created.json() as { id: string; connectUrl?: string }
        this.sessionId = session.id
        this.connectUrl = session.connectUrl ?? null
      }

      const debug = await fetch(`https://api.browserbase.com/v1/sessions/${this.sessionId}/debug`, { headers: headers(env) }).then((response) => (response.ok ? response.json() : null)).catch(() => null) as { debuggerFullscreenUrl?: string; debuggerUrl?: string } | null
      this.liveViewUrl = debug?.debuggerFullscreenUrl ?? debug?.debuggerUrl ?? null
      this.ctx.emit({ type: 'browser.session', at: now(), agent: actor, data: { sessionId: this.sessionId, liveViewUrl: this.liveViewUrl, mode: this.mode } })
      return this
    })
  }

  private async page(): Promise<StagehandPage | PlaywrightPage> {
    if (this.stagehandBrowser) {
      const context = this.stagehandBrowser.context
      return (await context.activePage()) ?? (await context.pages())[0] ?? context.newPage()
    }
    if (this.playwrightPage) return this.playwrightPage
    if (!this.connectUrl) throw new Error('No CDP connection URL')
    this.playwright = await chromium.connectOverCDP(this.connectUrl)
    const context = this.playwright.contexts()[0] ?? await this.playwright.newContext()
    this.playwrightPage = context.pages()[0] ?? await context.newPage()
    return this.playwrightPage
  }

  async capture(url: string, options: { screenshot?: boolean; waitMs?: number } = {}, actor: string = this.ctx.agent): Promise<PageCapture> {
    return this.locked('browser.capture', CAPTURE_MS, async () => {
      const page = await this.page()
      this.ctx.emit({ type: 'browser.navigate', at: now(), agent: actor, data: { url } })
      await withTimeout<unknown>('goto', 20000, page.goto(url, { waitUntil: 'domcontentloaded', timeout: 18000 }))
      await page.waitForTimeout(options.waitMs ?? 900).catch(() => undefined)
      const finalUrl = await withTimeout('url', 5000, Promise.resolve(page.url())).catch(() => url)
      const title = await withTimeout('title', 5000, Promise.resolve(page.title())).catch(() => '') || url
      const excerpt = await this.readPageText(page)
      let screenshotDataUrl: string | undefined
      if (options.screenshot !== false) {
        const shot = await withTimeout('screenshot', 12000, this.screenshot(page)).catch(() => null)
        if (shot) {
          screenshotDataUrl = `data:image/${shot.type};base64,${Buffer.from(shot.data).toString('base64')}`
          this.ctx.emit({ type: 'browser.screenshot', at: now(), agent: actor, data: { url: finalUrl, title, screenshotDataUrl } })
        }
      }
      return { url, finalUrl, title, excerpt, screenshotDataUrl, capturedAt: now() }
    })
  }

  /** Both page implementations expose `evaluate`, but with incompatible overloads. */
  private async readPageText(page: StagehandPage | PlaywrightPage): Promise<string> {
    const script = 'JSON.stringify((document.querySelector("main, article, [role=\\"main\\"]") || document.body || {}).textContent || "")'
    try {
      const raw = await withTimeout('evaluate', 8000, (page as { evaluate: (expression: string) => Promise<unknown> }).evaluate(script))
      const text = typeof raw === 'string' ? (JSON.parse(raw) as string) : ''
      return text.replace(/\s+/g, ' ').trim().slice(0, 2400)
    } catch { return '' }
  }

  private async screenshot(page: StagehandPage | PlaywrightPage): Promise<{ type: 'jpeg' | 'png'; data: Uint8Array } | null> {
    try { return { type: 'jpeg', data: await (page as PlaywrightPage).screenshot({ type: 'jpeg', quality: 55 }) } } catch { /* Stagehand pages take no Playwright options. */ }
    try { return { type: 'png', data: await page.screenshot({}) } } catch { return null }
  }

  /** Natural-language action on the current page via Stagehand (same session, so the live view shows it). */
  async act(instruction: string, budgetMs?: number, actor: string = this.ctx.agent): Promise<{ ok: boolean; message: string }> {
    return this.locked('browser.act', Math.min(ACT_MS, budgetMs ?? ACT_MS), async () => {
      if (!this.stagehand) return { ok: false, message: 'Stagehand is not available in this session.' }
      try {
        const result = await this.stagehand.act(instruction)
        const message = String(result.data?.message ?? (result.data?.success ? 'done' : 'no action taken'))
        this.ctx.emit({ type: 'browser.act', at: now(), agent: actor, data: { instruction, ok: result.data?.success !== false, message, actions: result.data?.actions?.map((action) => action.description) } })
        return { ok: result.data?.success !== false, message }
      } catch (error) {
        this.ctx.emit({ type: 'browser.error', at: now(), agent: actor, data: { step: 'act', instruction, error: String(error) } })
        return { ok: false, message: String(error) }
      }
    })
  }

  /** Extraction from the current page via Stagehand. */
  async extract(instruction: string, budgetMs?: number, actor: string = this.ctx.agent): Promise<{ answer: string; quotes: string[] } | null> {
    return this.locked('browser.extract', Math.min(ACT_MS, budgetMs ?? ACT_MS), async () => {
      if (!this.stagehand) return null
      try {
        const result = await this.stagehand.extract(`${instruction}. Answer in two parts: the answer, then up to three short verbatim quotes from the page, each on its own line prefixed with "QUOTE:".`)
        const raw = String(result.data?.extraction ?? '')
        const quotes = [...raw.matchAll(/QUOTE:\s*(.+)/g)].map((match) => match[1].trim()).slice(0, 3)
        const value = { answer: raw.split(/QUOTE:/)[0].trim(), quotes }
        this.ctx.emit({ type: 'browser.extract', at: now(), agent: actor, data: { instruction, ...value } })
        return value
      } catch (error) {
        this.ctx.emit({ type: 'browser.error', at: now(), agent: actor, data: { step: 'extract', instruction, error: String(error) } })
        return null
      }
    })
  }

  async close(actor: string = this.ctx.agent) {
    await this.locked('browser.close', 15000, async () => {
      const sessionId = this.sessionId
      await this.stagehand?.close().catch(() => undefined)
      await this.stagehandBrowser?.close().catch(() => undefined)
      await this.playwright?.close().catch(() => undefined)
      this.stagehand = null
      this.stagehandBrowser = null
      this.playwright = null
      this.playwrightPage = null
      this.connectUrl = null
      if (sessionId) {
        await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}`, { method: 'POST', headers: headers(this.ctx.env), body: JSON.stringify({ projectId: this.ctx.env.BROWSERBASE_PROJECT_ID, status: 'REQUEST_RELEASE' }) }).catch(() => undefined)
        this.ctx.emit({ type: 'browser.closed', at: now(), agent: actor, data: { sessionId } })
      }
      this.sessionId = null
      this.liveViewUrl = null
    })
  }
}
