import http from 'node:http'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

function loadDevVars() {
  try {
    return Object.fromEntries(readFileSync('.dev.vars', 'utf8').split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => {
      const index = line.indexOf('=')
      return [line.slice(0, index), line.slice(index + 1)]
    }))
  } catch { return {} }
}

const env = { ...loadDevVars(), ...process.env }
const port = Number(env.RESEARCH_RUNNER_PORT ?? 8788)
const asJson = (response, status, body) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)) }

async function browserbaseResearch(query) {
  if (!env.BROWSERBASE_API_KEY || !env.BROWSERBASE_PROJECT_ID) return { status: 'unproven', capturedAt: new Date().toISOString(), screenshotCaptured: false }
  const created = await fetch('https://api.browserbase.com/v1/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BB-API-Key': env.BROWSERBASE_API_KEY },
    body: JSON.stringify({ projectId: env.BROWSERBASE_PROJECT_ID, timeout: 120, browserSettings: { viewport: { width: 1280, height: 720 } }, userMetadata: { product: 'genie-jury', juror: 'gale' } }),
  })
  if (!created.ok) throw new Error('Browserbase did not create a session')
  const session = await created.json()
  const connectUrl = session.connectUrl ?? session.cdpUrl ?? session.wsUrl
  if (!connectUrl) throw new Error('Browserbase session did not return a CDP connection URL')
  const browser = await chromium.connectOverCDP(connectUrl)
  try {
    const context = browser.contexts()[0]
    const page = context.pages()[0] ?? await context.newPage()
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    const result = await page.locator('a').evaluateAll((anchors) => anchors.map((anchor) => {
      const heading = anchor.querySelector('h3')
      return heading ? { title: heading.textContent?.trim(), sourceUrl: anchor.href } : null
    }).find(Boolean))
    const excerpt = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 360)
    await page.screenshot({ type: 'png' })
    return result?.sourceUrl ? { status: 'verified', title: result.title, sourceUrl: result.sourceUrl, excerpt, capturedAt: new Date().toISOString(), screenshotCaptured: true } : { status: 'unproven', capturedAt: new Date().toISOString(), screenshotCaptured: true }
  } finally { await browser.close() }
}

http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') return asJson(response, 200, { ok: true, service: 'genie-jury-research-runner' })
  if (request.method !== 'POST' || request.url !== '/research') return asJson(response, 404, { error: 'Route not found.' })
  let raw = ''
  for await (const chunk of request) raw += chunk
  const query = JSON.parse(raw || '{}').query
  if (typeof query !== 'string' || !query.trim()) return asJson(response, 400, { error: 'A research query is required.' })
  try { return asJson(response, 200, await browserbaseResearch(query)) }
  catch { return asJson(response, 200, { status: 'unproven', capturedAt: new Date().toISOString(), screenshotCaptured: false }) }
}).listen(port, '127.0.0.1', () => console.log(`Genie Jury research runner listening on ${port}`))
