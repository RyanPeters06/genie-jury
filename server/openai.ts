import type { Env } from './env.ts'
import { JURORS } from './swarm/agents.ts'
import { structured } from './swarm/llm.ts'
import type { JurorId } from './swarm/types.ts'

/**
 * OpenAI Realtime: the builder's microphone goes straight from the browser to
 * OpenAI over WebRTC using a short-lived client secret minted here. The server
 * never receives audio; it only ever sees finalised transcript text.
 * `create_response: false` matters: the Realtime session transcribes only, the
 * jurors are separate agents with their own voices.
 */
export async function createRealtimeSecret(env: Env): Promise<Response> {
  if (!env.OPENAI_API_KEY) return Response.json({ mode: 'deterministic', reason: 'OpenAI is not configured.' })
  const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: { type: 'realtime', model: env.OPENAI_REALTIME_MODEL, instructions: 'Transcribe the builder clearly. Genie Jury coordinates separate specialist jurors, so never create an assistant response.', audio: { input: { transcription: { model: 'gpt-4o-mini-transcribe', language: 'en', prompt: 'Hackathon, startup, product, prototype, users, market, evidence, Genie Jury, Browserbase, ElevenLabs' }, turn_detection: { type: 'server_vad', create_response: false, interrupt_response: false, silence_duration_ms: 900, prefix_padding_ms: 300 } } } } }),
  })
  if (!response.ok) return Response.json({ error: 'Unable to create a realtime client secret.' }, { status: 502 })
  return new Response(response.body, { status: response.status, headers: { 'content-type': 'application/json' } })
}

/**
 * Live interjections. While the builder is still talking, the panel listens.
 * A cheap structured call decides whether one juror has earned the right to
 * cut in with a single sentence. Bounded by the caller (max two per pitch).
 */
export interface Interjection { interrupt: boolean; juror: JurorId; line: string; trigger: string }

const TRIGGERS: Array<{ pattern: RegExp; juror: JurorId; line: string; trigger: string }> = [
  { pattern: /\b(nobody|no one|no other|first ever|only (app|tool|product)|no competitors?)\b/i, juror: 'gale', line: '[dryly] Sorry, "nobody"? Hold that thought, I am opening a browser.', trigger: 'unsupported uniqueness claim' },
  { pattern: /\b(ai[- ]powered|powered by ai|uses? ai to)\b/i, juror: 'volt', line: '[laughs] "AI-powered" before a single human was mentioned. Bold. Keep going.', trigger: 'buzzword before user' },
  { pattern: /\b(everyone|everybody|all (students|developers|people|users)|anyone who)\b/i, juror: 'tide', line: '[gently] Everyone? Pick one person for me. Who exactly, and what did they do last Tuesday?', trigger: 'undefined user' },
  { pattern: /\b(billion|trillion|\d+\s?(m|million|b)\b market)/i, juror: 'gale', line: 'I will need a source for that number. Carry on, I am checking.', trigger: 'unsourced market size' },
  { pattern: /\b(and (also|then) we|plus we|we also|on top of that)\b/i, juror: 'ember', line: '[exhales] That is the fourth feature. Which one is the demo?', trigger: 'scope creep' },
]

export function deterministicInterjection(transcript: string, alreadyUsed: JurorId[]): Interjection | null {
  for (const trigger of TRIGGERS) {
    if (alreadyUsed.includes(trigger.juror)) continue
    if (trigger.pattern.test(transcript)) return { interrupt: true, juror: trigger.juror, line: trigger.line, trigger: trigger.trigger }
  }
  // A real panel does not stay perfectly quiet until someone says a magic
  // keyword. Once the builder has put a real idea on the table, one juror earns
  // a short, human first question while the other agents start their work.
  const words = transcript.trim().split(/\s+/).filter(Boolean).length
  if (words >= 18 && !alreadyUsed.includes('tide')) {
    return { interrupt: true, juror: 'tide', line: '[gently] I hear the product. Now give me one real person who reaches for it. Keep going.', trigger: 'first user question' }
  }
  if (words >= 18 && !alreadyUsed.includes('ember')) {
    return { interrupt: true, juror: 'ember', line: 'Before this becomes a whole platform, what is the one thing you can ship tonight? Keep going.', trigger: 'first scope question' }
  }
  return null
}

export async function detectInterjection(input: { pitchSoFar: string; newText: string; alreadyUsed: JurorId[] }, env: Env): Promise<Interjection | null> {
  const fallback = deterministicInterjection(input.newText, input.alreadyUsed)
  if (!env.OPENAI_API_KEY) return fallback
  const available = (Object.keys(JURORS) as JurorId[]).filter((juror) => !input.alreadyUsed.includes(juror))
  if (!available.length) return null
  const result = await structured<Interjection>({ OPENAI_API_KEY: env.OPENAI_API_KEY, OPENAI_MODEL: env.OPENAI_FAST_MODEL }, {
    instructions: `You are the floor monitor for Genie Jury, a live pitch panel. The builder is mid-pitch. Decide whether ONE juror should interrupt right now, like a real person who cannot hold it in. Interrupt only for a genuinely provocative moment in the NEWEST words: an absolute claim ("nobody does this"), an unsourced number, a buzzword before a user is named, a fourth feature, or a contradiction. Most of the time the answer is no. Available jurors and voices:
${available.map((juror) => `- ${juror}: ${JURORS[juror].role}. ${JURORS[juror].voice}`).join('\n')}
If interrupting: one spoken sentence, at most 18 words, in that juror's voice, reacting to the exact words. No research has happened yet at this point, so a juror may announce that it is about to check something but must never claim it already looked, already found something, or already failed to find something. After a substantial first pitch (roughly 18 words), ask one concise first question even when there is no dramatic red flag; a real panel responds rather than silently staring. You may start with one of that juror's tags: ${available.map((juror) => `${juror}: ${JURORS[juror].audioTags.join(' ')}`).join('; ')}. It must end by letting the builder continue (e.g. "keep going"). If not interrupting, set interrupt=false, juror to any available id, line to an empty string.`,
    input: `Pitch so far:\n${input.pitchSoFar.slice(-1200)}\n\nNewest words:\n${input.newText}`,
    schema: { name: 'interjection', schema: { type: 'object', properties: { interrupt: { type: 'boolean' }, juror: { type: 'string', enum: available }, line: { type: 'string' }, trigger: { type: 'string' } }, required: ['interrupt', 'juror', 'line', 'trigger'], additionalProperties: false } },
  })
  if (!result) return fallback
  // The deterministic opener protects the conversational contract if the
  // monitor model is overly conservative about a perfectly ordinary pitch.
  if (!result.interrupt || !result.line.trim() || !available.includes(result.juror)) return fallback
  return { ...result, line: result.line.trim().slice(0, 160) }
}

/**
 * A juror's immediate reply while the other agents are still checking the
 * pitch. This deliberately does not consult or claim evidence: it preserves a
 * natural back-and-forth without pretending that Browserbase has finished.
 */
export async function replyWhileResearching(input: { juror: JurorId; pitch: string; answer: string }, env: Env): Promise<{ juror: JurorId; line: string; cue: string; basedOn: { findingIds: string[]; evidenceIds: string[]; messagesFrom: string[] } }> {
  const profile = JURORS[input.juror]
  const fallbackLines: Record<JurorId, string> = {
    ember: 'Good—now cut that down to one screen and one user action. What ships before you add anything else?',
    gale: 'That is a useful claim, not proof yet. While I check it, what result would make you change your mind?',
    tide: 'I can hear the intent. Put me in the user\'s last frustrating moment—what did I try before this?',
    volt: '[laughs] Better. The idea has pants on now. What would make a skeptical teammate actually use it tomorrow?',
  }
  const fallback = { juror: input.juror, line: fallbackLines[input.juror], cue: `${profile.name} follows up`, basedOn: { findingIds: [], evidenceIds: [], messagesFrom: [] } }
  if (!env.OPENAI_API_KEY) return fallback
  type Out = { line: string; cue: string }
  const out = await structured<Out>({ OPENAI_API_KEY: env.OPENAI_API_KEY, OPENAI_MODEL: env.OPENAI_FAST_MODEL }, {
    instructions: `You are ${profile.name}, ${profile.role}, in a live Genie Jury pitch conversation. The other jurors are still researching in the background. Reply directly to the builder's answer in one concise spoken turn (12–42 words), then ask one pointed follow-up question. You have no research result yet: never claim to have checked, found, verified, or disproved anything. Be human and conversational, not a narrator. ${profile.voice} ${profile.never} ${input.juror === 'volt' ? 'Volt may make one kind PG-13 joke about the idea, never the builder. No profanity, slurs, sexual content, or personal attacks.' : ''}`,
    input: `Original pitch:\n${input.pitch.slice(0, 1600)}\n\nThe builder just answered you:\n${input.answer.slice(0, 600)}`,
    schema: { name: 'live_juror_reply', schema: { type: 'object', properties: { line: { type: 'string' }, cue: { type: 'string' } }, required: ['line', 'cue'], additionalProperties: false } },
  })
  const line = out?.line?.trim().slice(0, 320) ?? ''
  const spoken = line.replace(/\[[^\]]{1,24}\]/g, '').trim()
  const words = spoken.split(/\s+/).filter(Boolean).length
  if (words < 8 || words > 48 || !/[?]$/.test(spoken)) return fallback
  return { ...fallback, line, cue: out?.cue?.trim().slice(0, 80) || fallback.cue }
}
