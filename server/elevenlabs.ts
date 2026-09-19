import type { Env } from './env.ts'
import type { JurorId } from './swarm/types.ts'

/**
 * Juror voices. Every juror has a distinct ElevenLabs voice and a distinct
 * delivery profile. Lines are written for Eleven v3, which understands inline
 * audio tags such as [laughs] or [sighs]; if v3 is unavailable we fall back to
 * Multilingual v2 with the tags stripped, so the jury never goes silent.
 */

interface Delivery { stability: number; similarity_boost: number; style: number; speed: number }

/** v3 stability is discrete: 0 creative, 0.5 natural, 1 robust. Volt is allowed to be creative. */
const DELIVERY: Record<JurorId, Delivery> = {
  ember: { stability: .5, similarity_boost: .8, style: .3, speed: 1.04 },
  gale: { stability: .5, similarity_boost: .85, style: .1, speed: .96 },
  tide: { stability: .5, similarity_boost: .8, style: .3, speed: 1 },
  volt: { stability: 0, similarity_boost: .75, style: .6, speed: 1.06 },
}

export function voiceFor(juror: JurorId, env: Env) {
  return { ember: env.ELEVENLABS_EMBER_VOICE_ID, gale: env.ELEVENLABS_GALE_VOICE_ID, tide: env.ELEVENLABS_TIDE_VOICE_ID, volt: env.ELEVENLABS_VOLT_VOICE_ID }[juror]
}

export const stripTags = (line: string) => line.replace(/\[[^\]]{1,24}\]/g, '').replace(/\s{2,}/g, ' ').trim()

export interface SpeechRequest { juror: JurorId; line: string; previousText?: string; nextText?: string }

export async function synthesize(request: SpeechRequest, env: Env): Promise<Response> {
  const voice = voiceFor(request.juror, env)
  if (!env.ELEVENLABS_API_KEY || !voice) return Response.json({ error: 'ElevenLabs voice is not configured.' }, { status: 503 })
  const delivery = DELIVERY[request.juror]
  const attempt = async (model: string, text: string) => {
    const v3 = model.startsWith('eleven_v3')
    const body: Record<string, unknown> = {
      text, model_id: model,
      voice_settings: v3 ? { stability: delivery.stability, similarity_boost: delivery.similarity_boost, speed: delivery.speed, use_speaker_boost: true } : { ...delivery, use_speaker_boost: true },
      previous_text: request.previousText?.slice(-400), next_text: request.nextText?.slice(0, 200),
      apply_text_normalization: 'auto',
    }
    return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=mp3_44100_128`, { method: 'POST', headers: { 'xi-api-key': env.ELEVENLABS_API_KEY!, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  }

  let response = await attempt(env.ELEVENLABS_MODEL, request.line)
  let model = env.ELEVENLABS_MODEL
  if (!response.ok && env.ELEVENLABS_MODEL !== 'eleven_multilingual_v2') {
    response = await attempt('eleven_multilingual_v2', stripTags(request.line))
    model = 'eleven_multilingual_v2'
  }
  if (!response.ok) return Response.json({ error: `Unable to create juror audio (${response.status}).` }, { status: 502 })
  return new Response(response.body, { headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Voice-Model': model } })
}
