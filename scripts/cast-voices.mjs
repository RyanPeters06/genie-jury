#!/usr/bin/env node
/**
 * Genie Jury voice casting helper.
 *
 * Lists saved/account voices plus the shared library, then creates three
 * eleven_v3 auditions per juror from voices already available to this account.
 * It never prints an API key. Generated audio lives in ignored tmp/auditions.
 *
 * Usage: node scripts/cast-voices.mjs [ember] [gale] [tide] [volt]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const envPath = resolve(root, '.env.local')
const devVarsPath = resolve(root, '.dev.vars')
const auditionDirectory = resolve(root, 'tmp', 'auditions')

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map((line) => {
    const divider = line.indexOf('=')
    return divider < 0 ? [line, ''] : [line.slice(0, divider), line.slice(divider + 1)]
  }))
}

const env = parseEnv(await readFile(envPath, 'utf8'))
// Existing Genie Jury development secrets live in .dev.vars. Keep .env.local
// as the Vite-facing config file and never copy or print a secret.
const devVars = parseEnv(await readFile(devVarsPath, 'utf8').catch(() => ''))
const apiKey = env.ELEVENLABS_API_KEY ?? devVars.ELEVENLABS_API_KEY
if (!apiKey) throw new Error('ELEVENLABS_API_KEY is missing from local development configuration.')

const headers = { 'xi-api-key': apiKey }
const callLog = []

async function request(path, options = {}) {
  const started = performance.now()
  const response = await fetch(`https://api.elevenlabs.io${path}`, { ...options, headers: { ...headers, ...options.headers } })
  const latencyMs = Math.round(performance.now() - started)
  if (!response.ok) {
    const body = await response.text()
    callLog.push({ path, status: response.status, latencyMs, body })
    throw new Error(`${path} failed (${response.status}): ${body}`)
  }
  return { response, latencyMs }
}

function voiceRow(voice, source) {
  const labels = voice.labels ?? {}
  return {
    source,
    voice_id: voice.voice_id,
    name: voice.name,
    gender: labels.gender ?? voice.gender ?? '',
    age: labels.age ?? voice.age ?? '',
    accent: labels.accent ?? voice.accent ?? '',
    use_case: labels.use_case ?? voice.use_case ?? '',
    descriptive: labels.descriptive ?? voice.descriptive ?? '',
    description: voice.description ?? '',
  }
}

function searchable(voice) {
  return Object.values(voiceRow(voice, '')).join(' ').toLowerCase()
}

const auditions = {
  ember: {
    line: '[exhales] That is the fourth feature. Which one is the demo? Pick the single screen you would show with one hour left.',
    settings: { stability: 0.5, similarity_boost: 0.78, style: 0.18, use_speaker_boost: true },
    wants: ['male', 'warm', 'conversational', 'confident', 'american', 'middle'],
    avoids: ['child', 'whisper'],
  },
  gale: {
    line: '[pauses] You said nobody does this. [dryly] I opened a browser. I found three of them. Unverified is not the same as true.',
    settings: { stability: 0.5, similarity_boost: 0.82, style: 0.06, use_speaker_boost: true },
    wants: ['female', 'male', 'british', 'calm', 'professional', 'middle'],
    avoids: ['child', 'energetic', 'animation'],
  },
  tide: {
    line: '[gently] Everyone? Pick one person for me. When did they last hit this problem, and what did they actually do about it?',
    settings: { stability: 0.5, similarity_boost: 0.75, style: 0.14, use_speaker_boost: true },
    wants: ['female', 'warm', 'calm', 'soft', 'young', 'conversational'],
    avoids: ['child', 'gravelly'],
  },
  volt: {
    line: '[laughs] Your pitch said AI-powered before it said who has the problem. [sincerely] So who is awake at 2 a.m. without this?',
    settings: { stability: 0.0, similarity_boost: 0.72, style: 0.42, use_speaker_boost: true },
    wants: ['male', 'young', 'energetic', 'animation', 'playful', 'american'],
    avoids: ['child', 'calm'],
  },
}

const verifyTags = process.argv.includes('--verify-tags')
const requestedJurors = process.argv.slice(2).filter((argument) => argument !== '--verify-tags')
if (requestedJurors.some((juror) => !Object.hasOwn(auditions, juror))) {
  throw new Error('Usage: node scripts/cast-voices.mjs [ember] [gale] [tide] [volt]')
}
const juryToAudition = requestedJurors.length ? requestedJurors : (verifyTags ? [] : Object.keys(auditions))

function candidatesFor(profile, voices, usedVoiceIds) {
  const score = (voice) => {
    const text = searchable(voice)
    return profile.wants.reduce((total, word, index) => total + (text.includes(word) ? 12 - index : 0), 0)
      - profile.avoids.reduce((total, word) => total + (text.includes(word) ? 15 : 0), 0)
  }
  const ordered = [...voices].sort((left, right) => score(right) - score(left))
  const unique = ordered.filter((voice) => !usedVoiceIds.has(voice.voice_id))
  return (unique.length >= 3 ? unique : ordered).slice(0, 3)
}

const [accountResult, libraryResult] = await Promise.allSettled([
  request('/v1/voices'),
  request('/v1/shared-voices?page_size=100&language=en&sort=trending'),
])

if (accountResult.status === 'rejected') throw accountResult.reason
const accountPayload = await accountResult.value.response.json()
const accountVoices = accountPayload.voices ?? []
const sharedVoices = libraryResult.status === 'fulfilled' ? ((await libraryResult.value.response.json()).voices ?? []) : []
if (libraryResult.status === 'rejected') console.warn(`Shared voice library unavailable: ${libraryResult.reason.message}`)

const accountRows = accountVoices.map((voice) => voiceRow(voice, 'account'))
const sharedRows = sharedVoices.map((voice) => voiceRow(voice, 'shared-library'))
console.log('\nAccount voices (auditionable without adding a library voice):')
console.table(accountRows)
console.log('\nShared voice library (listed for casting research; not added or modified):')
console.table(sharedRows)

await mkdir(auditionDirectory, { recursive: true })
const usedVoiceIds = new Set()
const manifest = { model: 'eleven_v3', createdAt: new Date().toISOString(), auditions: {}, notes: ['Eleven v3 audio tags were intentionally retained in every line.', 'Eleven v3 does not support numeric speed control; speed is not sent in its requests.'] }

for (const juror of juryToAudition) {
  const profile = auditions[juror]
  const candidates = candidatesFor(profile, accountVoices, usedVoiceIds)
  manifest.auditions[juror] = []
  for (const voice of candidates) {
    usedVoiceIds.add(voice.voice_id)
    const name = voice.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || voice.voice_id
    try {
      const { response, latencyMs } = await request(`/v1/text-to-speech/${voice.voice_id}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: profile.line, model_id: 'eleven_v3', voice_settings: profile.settings }),
      })
      const output = resolve(auditionDirectory, `${juror}-${name}.mp3`)
      await writeFile(output, Buffer.from(await response.arrayBuffer()))
      manifest.auditions[juror].push({ voice_id: voice.voice_id, name: voice.name, output, latencyMs, settings: profile.settings })
      console.log(`✓ ${juror}: ${voice.name} (${latencyMs} ms) -> ${output}`)
    } catch (error) {
      manifest.auditions[juror].push({ voice_id: voice.voice_id, name: voice.name, error: error.message, settings: profile.settings })
      console.error(`✗ ${juror}: ${voice.name}: ${error.message}`)
    }
  }
}

await writeFile(resolve(auditionDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2))
if (callLog.length) await writeFile(resolve(auditionDirectory, 'failures.json'), JSON.stringify(callLog, null, 2))
const chosen = {
  ember: { voice_id: 'TX3LPaxmHKxFdv7VOQHJ', file: 'ember-liam-energetic-social-media-creator.mp3', tags: ['exhales'] },
  gale: { voice_id: 'Xb7hH8MSUJpSbSDYk0k2', file: 'gale-alice-clear-engaging-educator.mp3', tags: ['pauses', 'dryly'] },
  tide: { voice_id: 'WAhoMTNdLdMoq1j3wf3I', file: 'tide-hope-smooth-engaging-and-kind.mp3', tags: ['gently'] },
  volt: { voice_id: 'SOYHLrjzK2X1ezoPC6cr', file: 'volt-harry-fierce-warrior.mp3', tags: ['laughs', 'sincerely'] },
}

if (verifyTags) {
  manifest.tagVerification = {}
  for (const [juror, cast] of Object.entries(chosen)) {
    try {
      const audio = await readFile(resolve(auditionDirectory, cast.file))
      const form = new FormData()
      form.append('model_id', 'scribe_v2')
      form.append('language_code', 'en')
      form.append('tag_audio_events', 'true')
      form.append('file', new Blob([audio], { type: 'audio/mpeg' }), cast.file)
      const { response, latencyMs } = await request('/v1/speech-to-text', { method: 'POST', body: form })
      const transcript = await response.json()
      const text = String(transcript.text ?? '').toLowerCase()
      const spokenTags = cast.tags.filter((tag) => text.includes(tag))
      manifest.tagVerification[juror] = { latencyMs, transcript: transcript.text ?? '', spokenTags, result: spokenTags.length ? 'tag text was spoken aloud' : 'tag text was not spoken; review audio for performed delivery' }
      console.log(`Tag verification ${juror}: ${manifest.tagVerification[juror].result} (${latencyMs} ms)`)
    } catch (error) {
      manifest.tagVerification[juror] = { error: error.message }
      console.error(`Tag verification ${juror} failed: ${error.message}`)
    }
  }
  await writeFile(resolve(auditionDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2))
}

console.log('\nListen to the MP3s in tmp/auditions, then copy the four chosen voice IDs into .env.local.')
