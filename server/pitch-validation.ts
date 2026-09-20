/**
 * Keep the jury from confidently judging a microphone check, a greeting, or a
 * fragment of side conversation. This is intentionally conservative: a short,
 * unusual idea is still welcome as long as it says what is being built or who
 * it helps.
 */
export type PitchValidation =
  | { valid: true; pitch: string }
  | { valid: false; code: 'empty-pitch' | 'side-conversation' | 'missing-pitch'; message: string }

const SIDE_CONVERSATION = /^(?:hey|hi|hello|yo|test(?:ing)?|can you hear me|are you (?:there|listening)|what(?:'s| is) up|how are you|thank you|thanks)[.!?\s]*$/i
const IDEA_SIGNAL = /\b(app|tool|product|platform|service|website|prototype|build|building|create|help(?:s|ing)?|solve|for (?:students|teams|users|people|customers|founders|developers)|lets? (?:people|users|teams)|enables?)\b/i

export function validatePitch(input: unknown): PitchValidation {
  const pitch = typeof input === 'string' ? input.replace(/\s+/g, ' ').trim() : ''
  if (!pitch) return { valid: false, code: 'empty-pitch', message: 'I did not catch a pitch. Tell the jury what you are building, who it is for, and why it matters.' }
  if (SIDE_CONVERSATION.test(pitch)) return { valid: false, code: 'side-conversation', message: 'That sounded like a side conversation, not a pitch. Start with the idea, the person it helps, and the problem they have.' }

  const words = pitch.split(' ').filter(Boolean)
  if (words.length < 8) return { valid: false, code: 'missing-pitch', message: 'That is too little for the jury to assess. Give us the product, the user, and the problem in one or two sentences.' }
  if (words.length < 15 && !IDEA_SIGNAL.test(pitch)) return { valid: false, code: 'missing-pitch', message: 'I heard words, but not an idea yet. Say what you are building or who you are helping, then continue naturally.' }
  return { valid: true, pitch }
}
