/**
 * Every browser event must name the juror that queued the work, not whoever
 * opened the shared session first. Run against a live API:
 *   node scripts/check-attribution.mjs
 */
const base = process.env.JURY_API_URL ?? 'http://127.0.0.1:8791'
const pitch = process.argv[2] ?? 'Loop is a wearable that reads your emotions. Nobody else is doing this. Every therapist will want it.'

const session = await (await fetch(`${base}/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pitch }) })).json()
const events = []
const stream = await fetch(`${base}/sessions/${session.id}/stream`, { headers: { Accept: 'text/event-stream' } })
const reader = stream.body.getReader()
const decoder = new TextDecoder()
void (async () => {
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read().catch(() => ({ done: true }))
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.split('\n').find((part) => part.startsWith('data: '))
      if (line) try { events.push(JSON.parse(line.slice(6))) } catch { /* keep reading */ }
    }
  }
})()

const result = await (await fetch(`${base}/sessions/${session.id}/deliberate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })).json()
if (result.error) { console.error(result); process.exit(1) }
await new Promise((resolve) => setTimeout(resolve, 400))

const browserEvents = events.filter((event) => event.type.startsWith('browser.'))
console.log(`\nBROWSER EVENTS (${browserEvents.length})`)
const byAgent = {}
for (const event of browserEvents) {
  const agent = event.data.agent ?? '(none)'
  byAgent[agent] = (byAgent[agent] ?? 0) + 1
  console.log(`  ${String(agent).padEnd(8)} ${event.type.padEnd(20)} ${String(event.data.url ?? event.data.query ?? event.data.instruction ?? '').slice(0, 52)}`)
}
console.log('\nPER AGENT:', byAgent)

const unnamed = browserEvents.filter((event) => !event.data.agent)
const known = new Set(['ember', 'gale', 'tide', 'volt'])
const unknown = browserEvents.filter((event) => event.data.agent && !known.has(event.data.agent))
// Only Gale drives the live session; Ember and Tide may appear on fetch events.
const liveOnly = ['browser.session', 'browser.navigate', 'browser.screenshot', 'browser.act', 'browser.extract', 'browser.closed']
const wrongDriver = browserEvents.filter((event) => liveOnly.includes(event.type) && event.data.agent !== 'gale')
const fetchAgents = [...new Set(browserEvents.filter((event) => event.type === 'browser.fetch').map((event) => event.data.agent))]

console.log('\nCHECKS')
console.log(`  events with no agent .................. ${unnamed.length} (want 0)`)
console.log(`  events with an unknown agent .......... ${unknown.length} (want 0)`)
console.log(`  live-session events not attributed to gale ... ${wrongDriver.length} (want 0)`)
if (wrongDriver.length) for (const event of wrongDriver) console.log(`      ${event.type} -> ${event.data.agent}`)
console.log(`  fetch events came from ................ ${fetchAgents.join(', ') || '(none)'}`)
const ok = !unnamed.length && !unknown.length && !wrongDriver.length
console.log(`\n${ok ? 'PASS' : 'FAIL'}: browser events name the agent that queued the work.`)
await fetch(`${base}/sessions/${session.id}/finish`, { method: 'POST' })
process.exit(ok ? 0 : 1)
