import { appendFileSync, readFileSync } from 'node:fs'

const vars = Object.fromEntries(readFileSync('.dev.vars', 'utf8').split(/\r?\n/).filter(Boolean).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
if (!vars.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is missing from .dev.vars')
const response = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': vars.ELEVENLABS_API_KEY } })
if (!response.ok) throw new Error('Unable to list ElevenLabs voices')
const voices = (await response.json()).voices ?? []
if (voices.length < 4) throw new Error('At least four accessible ElevenLabs voices are required.')
const selected = voices.slice(0, 4)
const mappings = ['ELEVENLABS_EMBER_VOICE_ID', 'ELEVENLABS_GALE_VOICE_ID', 'ELEVENLABS_TIDE_VOICE_ID', 'ELEVENLABS_VOLT_VOICE_ID']
appendFileSync('.dev.vars', `\n${mappings.map((key, index) => `${key}=${selected[index].voice_id}`).join('\n')}\n`)
console.log('Configured four accessible ElevenLabs voices in ignored .dev.vars.')
