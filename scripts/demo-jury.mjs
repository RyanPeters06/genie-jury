/**
 * End-to-end check of the whole jury: one pitch in, a full multi-agent
 * deliberation out. Prints the collaboration the demo is meant to show —
 * who was assigned what, which tools ran, who messaged whom, what the live
 * browser found, and how each juror voted.
 *
 *   node scripts/demo-jury.mjs ["your pitch here"]
 */
const base = process.env.JURY_API_URL ?? 'http://127.0.0.1:8790'
const pitch = process.argv[2] ?? 'Genie Jury is a live pitch arena for hackathon builders. Nobody else does this. Four AI jurors interrupt your pitch, research your claims in a real browser, and give you the smallest next thing to build. Every hackathon team needs it.'

const started = Date.now()
const session = await (await fetch(`${base}/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'Hackathon', pitch }) })).json()
console.log(`session ${session.id}`)

const events = []
const stream = await fetch(`${base}/sessions/${session.id}/stream`, { headers: { Accept: 'text/event-stream' } })
const reader = stream.body.getReader()
const decoder = new TextDecoder()
void (async () => {
  let buffer = ''
  for (;;) {
    // The stream is cut when the session closes; that is a normal ending here,
    // not a failure worth taking the whole report down for.
    const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }))
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.split('\n').find((part) => part.startsWith('data: '))
      if (!line) continue
      try { events.push(JSON.parse(line.slice(6))) } catch { /* keep reading */ }
    }
  }
})()

const result = await (await fetch(`${base}/sessions/${session.id}/deliberate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: pitch }) })).json()
if (result.error) { console.error(result); process.exit(1) }
const { ledger, turns, verdict, runTree, mode } = result

const heading = (text) => console.log(`\n${'─'.repeat(64)}\n${text}\n`)

heading(`DELIBERATION (${mode}, ${((Date.now() - started) / 1000).toFixed(1)}s)`)
console.log('CLAIMS EXTRACTED BY THE BAILIFF')
for (const claim of ledger.claims) console.log(`  [${claim.importance.toFixed(2)}] ${claim.type.padEnd(11)} ${claim.claim}  → ${claim.evidenceStatus}`)

heading('ASSIGNMENTS (task decomposition)')
for (const assignment of ledger.assignments) console.log(`  ${assignment.juror.padEnd(6)} ${assignment.question}`)

heading('TOOL CALLS (real side effects)')
for (const call of ledger.toolCalls) console.log(`  ${call.agent.padEnd(6)} ${call.tool.padEnd(16)} ${call.ok ? 'ok ' : 'ERR'} ${String(call.durationMs).padStart(6)}ms  ${JSON.stringify(call.args).slice(0, 90)}`)

heading('MESSAGES BETWEEN AGENTS')
for (const message of ledger.messages) console.log(`  ${message.from} → ${message.to}  ${message.kind.padEnd(16)} ${JSON.stringify(message.payload).slice(0, 110)}`)

heading('EVIDENCE GATHERED')
for (const item of ledger.evidence) console.log(`  ${item.status.toUpperCase().padEnd(10)} ${item.sourceUrl ?? '(no source)'}\n    ${item.rationale ?? ''}\n    requested by ${item.requestedBy}, screenshot ${item.screenshotCaptured ? 'captured' : 'none'}`)

heading('FINDINGS ON THE SHARED LEDGER')
for (const finding of ledger.findings) console.log(`  ${finding.agent.padEnd(6)} ${finding.kind.padEnd(10)} sev${finding.severity}  ${finding.summary}`)

heading('WHAT THE JURY SAID')
for (const turn of turns) console.log(`  ${turn.juror.toUpperCase()} (${turn.cue})\n    ${turn.line}\n    grounded in ${turn.basedOn.findingIds.length} finding(s), heard from: ${turn.basedOn.messagesFrom.join(', ') || 'nobody'}\n`)

heading('VERDICT')
console.log(`  ${verdict.headline}\n  ${verdict.summary}`)
console.log(`  CUT:   ${verdict.scopeCut}`)
console.log(`  PROVE: ${verdict.evidenceQuestion}`)
console.log(`  TEST:  ${verdict.userTest}`)
console.log(`  BUILD: ${verdict.smallestNextBuild}`)
for (const [juror, vote] of Object.entries(verdict.votes)) console.log(`  ${juror.padEnd(6)} ${vote.vote.padEnd(8)} ${vote.because}`)

heading('RUN TREE')
const children = (parentId, depth) => runTree.filter((node) => node.parentId === parentId).forEach((node) => {
  console.log(`${'  '.repeat(depth)}${node.kind === 'tool' ? '⚙' : node.kind === 'message' ? '✉' : node.kind === 'handoff' ? '⇄' : '•'} ${node.label}${node.status === 'failed' ? '  [failed]' : ''}`)
  children(node.id, depth + 1)
})
children(null, 1)

console.log(`\n${ledger.toolCalls.length} tool calls · ${ledger.messages.length} agent messages · ${ledger.findings.length} findings · ${ledger.evidence.length} evidence items · ${events.length} live stage events`)
await fetch(`${base}/sessions/${session.id}/finish`, { method: 'POST' })
process.exit(0)
