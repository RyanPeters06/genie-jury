import { readFileSync } from 'node:fs'

/**
 * Server configuration. Secrets live in ignored `.env` / `.env.local` files and
 * never reach the browser bundle: Vite only exposes `VITE_*` keys.
 */
export interface Env {
  PORT: number
  OPENAI_API_KEY?: string
  OPENAI_MODEL: string
  OPENAI_FAST_MODEL: string
  OPENAI_REALTIME_MODEL: string
  ELEVENLABS_API_KEY?: string
  ELEVENLABS_MODEL: string
  ELEVENLABS_EMBER_VOICE_ID?: string
  ELEVENLABS_GALE_VOICE_ID?: string
  ELEVENLABS_TIDE_VOICE_ID?: string
  ELEVENLABS_VOLT_VOICE_ID?: string
  BROWSERBASE_API_KEY?: string
  BROWSERBASE_PROJECT_ID?: string
  PUBLIC_APP_ORIGIN?: string
}

function parseDotenv(path: string): Record<string, string> {
  try {
    return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#')).map((line) => {
      const index = line.indexOf('=')
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"|"$/g, '')]
    }).filter(([key]) => key))
  } catch { return {} }
}

export function loadEnv(): Env {
  // Order matters, lowest precedence first. `.dev.vars` is a leftover from the
  // removed Cloudflare setup and must lose to `.env.local`: when both defined a
  // voice id, the stale file silently won and every juror spoke in the wrong
  // voice while the docs described the intended cast.
  const merged = { ...parseDotenv('.dev.vars'), ...parseDotenv('.env'), ...parseDotenv('.env.local'), ...process.env } as Record<string, string | undefined>
  const clean = (value?: string) => (value && value.trim() ? value.trim() : undefined)
  return {
    PORT: Number(merged.PORT ?? 8790),
    OPENAI_API_KEY: clean(merged.OPENAI_API_KEY),
    OPENAI_MODEL: clean(merged.OPENAI_MODEL) ?? 'gpt-5-mini',
    OPENAI_FAST_MODEL: clean(merged.OPENAI_FAST_MODEL) ?? clean(merged.OPENAI_MODEL) ?? 'gpt-5-mini',
    OPENAI_REALTIME_MODEL: clean(merged.OPENAI_REALTIME_MODEL) ?? 'gpt-realtime',
    ELEVENLABS_API_KEY: clean(merged.ELEVENLABS_API_KEY),
    ELEVENLABS_MODEL: clean(merged.ELEVENLABS_MODEL) ?? 'eleven_v3',
    ELEVENLABS_EMBER_VOICE_ID: clean(merged.ELEVENLABS_EMBER_VOICE_ID),
    ELEVENLABS_GALE_VOICE_ID: clean(merged.ELEVENLABS_GALE_VOICE_ID),
    ELEVENLABS_TIDE_VOICE_ID: clean(merged.ELEVENLABS_TIDE_VOICE_ID),
    ELEVENLABS_VOLT_VOICE_ID: clean(merged.ELEVENLABS_VOLT_VOICE_ID),
    BROWSERBASE_API_KEY: clean(merged.BROWSERBASE_API_KEY),
    BROWSERBASE_PROJECT_ID: clean(merged.BROWSERBASE_PROJECT_ID),
    PUBLIC_APP_ORIGIN: clean(merged.PUBLIC_APP_ORIGIN),
  }
}

/** Every juror needs its own voice; checking only Ember hid three missing casts. */
export function jurorVoices(env: Env) {
  return { ember: env.ELEVENLABS_EMBER_VOICE_ID, gale: env.ELEVENLABS_GALE_VOICE_ID, tide: env.ELEVENLABS_TIDE_VOICE_ID, volt: env.ELEVENLABS_VOLT_VOICE_ID }
}

/**
 * A voice id is not a secret, but it is not ours to print either. The last four
 * characters are enough to tell at a glance which cast is actually loaded,
 * which is the check that would have caught the stale-file override.
 */
export function voiceFingerprint(env: Env) {
  return Object.entries(jurorVoices(env)).map(([juror, id]) => `${juror}:${id ? `…${id.slice(-4)}` : 'unset'}`).join(' ')
}

/** Safe, value-free view of what is configured, for /health/services and the on-stage badges. */
export function serviceHealth(env: Env) {
  const missingVoices = Object.entries(jurorVoices(env)).filter(([, id]) => !id).map(([juror]) => juror)
  return {
    openai: env.OPENAI_API_KEY ? 'configured' : 'missing',
    realtime: env.OPENAI_API_KEY ? 'configured' : 'missing',
    browserbase: !env.BROWSERBASE_API_KEY ? 'missing-key' : !env.BROWSERBASE_PROJECT_ID ? 'missing-project' : 'configured',
    elevenlabs: !env.ELEVENLABS_API_KEY ? 'missing-key' : missingVoices.length ? `missing-voices:${missingVoices.join(',')}` : 'configured',
    elevenlabsModel: env.ELEVENLABS_MODEL,
    model: env.OPENAI_MODEL,
  }
}
