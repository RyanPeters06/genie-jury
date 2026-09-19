/**
 * Live check of every Browserbase capability the jury uses.
 * Run with: node scripts/explore-browserbase.ts
 */
import { LiveBrowser, fetchPage, searchWeb } from '../server/browserbase.ts'
import { loadEnv } from '../server/env.ts'

const env = loadEnv()
const log = (label: string, value: unknown) => console.log(`\n## ${label}\n${typeof value === 'string' ? value : JSON.stringify(value, null, 1).slice(0, 1200)}`)
const ctx = { env, agent: 'gale', emit: (event: { type: string; data: Record<string, unknown> }) => console.log(`[event] ${event.type} ${JSON.stringify({ ...event.data, screenshotDataUrl: event.data.screenshotDataUrl ? '<screenshot>' : undefined }).slice(0, 220)}`) }

const t0 = Date.now()
const results = await searchWeb('AI pitch practice tool for hackathon founders', ctx, 5)
log(`Search API (${Date.now() - t0}ms)`, results.map((hit) => hit.url))

const t1 = Date.now()
const fetched = await fetchPage(results[0]?.url ?? 'https://example.com', ctx)
log(`Fetch API (${Date.now() - t1}ms)`, { statusCode: fetched?.statusCode, chars: fetched?.content.length, head: fetched?.content.slice(0, 200) })

const browser = new LiveBrowser(ctx)
const t2 = Date.now()
await browser.open()
log(`Session (${Date.now() - t2}ms)`, { mode: browser.mode, sessionId: browser.sessionId, liveView: browser.liveViewUrl?.slice(0, 80) })

const t3 = Date.now()
const capture = await browser.capture(results[0]?.url ?? 'https://example.com')
log(`Capture (${Date.now() - t3}ms)`, { title: capture.title, finalUrl: capture.finalUrl, excerpt: capture.excerpt.slice(0, 200), screenshotBytes: capture.screenshotDataUrl?.length })

const t4 = Date.now()
log(`Stagehand act (${Date.now() - t4}ms)`, await browser.act('dismiss any cookie banner or popup, then scroll to the pricing or features section'))

const t5 = Date.now()
log(`Stagehand extract (${Date.now() - t5}ms)`, await browser.extract('what this product does and who it is for'))

await browser.close()
console.log('\nDONE')
