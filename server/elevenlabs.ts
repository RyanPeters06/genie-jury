import type { Env } from './env.ts'
import type { JurorId } from './swarm/types.ts'

/**
 * Juror voices.
 *
 * Every juror has its own ElevenLabs voice and its own delivery profile, so the
 * four are distinguishable by ear even when they talk back to back. Lines are
 * written for Eleven v3, which performs inline audio tags such as [laughs] and
 * [pauses] rather than reading them out.
 *
 * Two model families need different request shapes:
 *   v3      keeps the audio tags, and rejects previous_text/next_text outright.
 *   v2/flash  has no audio tags, so they are stripped, but it does accept
 *             previous_text, which carries prosody across a turn boundary.
 * Getting this wrong is silent: the API returns 400 and the jury falls back to
 * a flatter voice with the tags removed.
 */

interface Delivery {
  /** v3 reads stability as three discrete settings: 0 creative, 0.5 natural, 1 robust. */
  stability: 0 | 0.5 | 1
  similarity_boost: number
  style: number
  /** v3 has no numeric rate control, so this is only sent to the Flash fallback. */
  fallbackSpeed: number
}

/**
 * Tuned against the cast in docs/VOICES.md. Keep the two in step: these numbers
 * were chosen for these specific voices, and they do not transfer if a voice is
 * recast.
 */
const DELIVERY: Record<JurorId, Delivery> = {
  // Liam. Warm, fast, hands-on. Natural stability keeps him steady but animated.
  ember: { stability: 0.5, similarity_boost: 0.78, style: 0.18, fallbackSpeed: 1.04 },
  // Alice. Calm and precise, so the least style of the four and the slowest fallback.
  gale: { stability: 0.5, similarity_boost: 0.82, style: 0.06, fallbackSpeed: 0.92 },
  // Hope. Empathetic and conversational, a little more colour than Gale.
  tide: { stability: 0.5, similarity_boost: 0.75, style: 0.14, fallbackSpeed: 0.96 },
  // Harry. Theatrical: creative stability is what lets v3 perform the comic timing.
  volt: { stability: 0, similarity_boost: 0.72, style: 0.42, fallbackSpeed: 1.08 },
}

export function voiceFor(juror: JurorId, env: Env) {
  return { ember: env.ELEVENLABS_EMBER_VOICE_ID, gale: env.ELEVENLABS_GALE_VOICE_ID, tide: env.ELEVENLABS_TIDE_VOICE_ID, volt: env.ELEVENLABS_VOLT_VOICE_ID }[juror]
}

export const stripTags = (line: string) => line.replace(/\[[^\]]{1,24}\]/g, '').replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim()

const isV3 = (model: string) => model.startsWith('eleven_v3')

export interface SpeechRequest { juror: JurorId; line: string; previousText?: string; nextText?: string }

function buildBody(request: SpeechRequest, model: string): Record<string, unknown> {
  const delivery = DELIVERY[request.juror]
  const v3 = isV3(model)
  return {
    text: v3 ? request.line : stripTags(request.line),
    model_id: model,
    voice_settings: {
      stability: delivery.stability,
      similarity_boost: delivery.similarity_boost,
      style: delivery.style,
      use_speaker_boost: true,
      // v3 has no numeric rate control and pacing comes from the tags instead.
      ...(v3 ? {} : { speed: delivery.fallbackSpeed }),
    },
    // v3 rejects these outright; on the fallback they carry prosody across the turn.
    ...(v3 ? {} : { previous_text: request.previousText?.slice(-400), next_text: request.nextText?.slice(0, 200) }),
    apply_text_normalization: 'auto',
  }
}

export async function synthesize(request: SpeechRequest, env: Env): Promise<Response> {
  const voice = voiceFor(request.juror, env)
  if (!env.ELEVENLABS_API_KEY || !voice) return Response.json({ error: 'ElevenLabs voice is not configured.' }, { status: 503 })

  const attempt = (model: string) => fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': env.ELEVENLABS_API_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildBody(request, model)),
  })

  // Flash is the right fallback for a live panel: far lower latency than
  // Multilingual, and it still accepts previous_text for prosody continuity.
  const FALLBACK_MODEL = 'eleven_flash_v2_5'
  let model = env.ELEVENLABS_MODEL
  let response = await attempt(model)
  if (!response.ok && model !== FALLBACK_MODEL) {
    const detail = await response.text().catch(() => '')
    console.warn(`[elevenlabs] ${model} failed (${response.status}) for ${request.juror}: ${detail.slice(0, 200)}`)
    model = FALLBACK_MODEL
    response = await attempt(model)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.warn(`[elevenlabs] ${model} failed (${response.status}) for ${request.juror}: ${detail.slice(0, 200)}`)
    return Response.json({ error: `Unable to create juror audio (${response.status}).` }, { status: 502 })
  }
  return new Response(response.body, { headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Voice-Model': model } })
}
