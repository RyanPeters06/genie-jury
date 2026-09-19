if (process.env.LIVE_API_SMOKE !== '1') throw new Error('Set LIVE_API_SMOKE=1 to run provider calls that consume API usage.')

const base = process.env.JURY_API_URL ?? 'http://127.0.0.1:8790'
const sessionResponse = await fetch(`${base}/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'Hackathon', pitch: 'A disposable smoke test pitch for Genie Jury.' }) })
if (!sessionResponse.ok) throw new Error('Worker session creation failed.')
const session = await sessionResponse.json()
const research = await fetch(`${base}/sessions/${session.id}/research`, { method: 'POST' })
if (!research.ok) throw new Error('OpenAI and Browserbase research failed.')
const audio = await fetch(`${base}/sessions/${session.id}/juror-audio`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ juror: 'ember', line: 'The moment is strong. The scope is not. Pick one magical interaction and make it impossible to ignore.' }) })
if (!audio.ok || !(await audio.arrayBuffer()).byteLength) throw new Error('ElevenLabs juror audio failed.')
const token = await fetch(`${base}/sessions/${session.id}/realtime-token`, { method: 'POST' })
if (!token.ok) throw new Error('OpenAI Realtime token minting failed.')
console.log('Live OpenAI, Browserbase, and ElevenLabs smoke checks passed.')
