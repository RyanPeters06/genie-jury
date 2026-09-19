import { requestRealtimeSecret } from './jury-api'

/**
 * One microphone, open for the whole session.
 *
 * Genie Jury is a conversation, not a form. The builder's mic connects once to
 * OpenAI Realtime over WebRTC and stays connected: while they pitch, while a
 * juror speaks, while they answer back. That is what makes barge-in possible in
 * both directions — a juror can cut into the pitch, and the builder can cut off
 * a juror simply by starting to talk.
 *
 * Audio goes browser → OpenAI directly. The server mints a short-lived client
 * secret and never receives audio, only finalised text.
 */

export interface MicEvents {
  /** The builder started making sound. Used for barge-in: stop whatever is playing. */
  onSpeechStart: () => void
  /** The builder stopped making sound. */
  onSpeechStop: () => void
  /** Streaming partial text for the current utterance. */
  onPartial: (text: string) => void
  /** A finalised utterance. */
  onUtterance: (text: string) => void
  onError: (reason: string) => void
}

export interface Mic {
  stop: () => void
  readonly kind: 'realtime' | 'browser'
}

export async function openMicrophone(sessionId: string, events: MicEvents): Promise<Mic | null> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).catch(() => null)
  if (!stream) { events.onError('microphone-denied'); return null }

  const realtime = await connectRealtime(sessionId, stream, events)
  if (realtime) return realtime

  const browser = connectBrowserSpeech(stream, events)
  if (browser) return browser

  stream.getTracks().forEach((track) => track.stop())
  events.onError('no-transcription')
  return null
}

async function connectRealtime(sessionId: string, stream: MediaStream, events: MicEvents): Promise<Mic | null> {
  try {
    const secret = await requestRealtimeSecret(sessionId)
    if (!secret) return null
    const peer = new RTCPeerConnection()
    stream.getTracks().forEach((track) => peer.addTrack(track, stream))
    let partial = ''
    const channel = peer.createDataChannel('oai-events')
    channel.addEventListener('message', (event) => {
      let payload: { type?: string; delta?: string; transcript?: string }
      try { payload = JSON.parse(event.data) } catch { return }
      switch (payload.type) {
        case 'input_audio_buffer.speech_started':
          partial = ''
          events.onSpeechStart()
          break
        case 'input_audio_buffer.speech_stopped':
          events.onSpeechStop()
          break
        case 'conversation.item.input_audio_transcription.delta':
          if (payload.delta) { partial += payload.delta; events.onPartial(partial) }
          break
        case 'conversation.item.input_audio_transcription.completed':
          if (payload.transcript?.trim()) events.onUtterance(payload.transcript.trim())
          partial = ''
          break
      }
    })
    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    const response = await fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/sdp' }, body: offer.sdp })
    if (!response.ok) { peer.close(); return null }
    await peer.setRemoteDescription({ type: 'answer', sdp: await response.text() })
    return { kind: 'realtime', stop: () => { peer.close(); stream.getTracks().forEach((track) => track.stop()) } }
  } catch { return null }
}

/** Fallback so the demo still works offline or without an OpenAI key. */
function connectBrowserSpeech(stream: MediaStream, events: MicEvents): Mic | null {
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition
  if (!Recognition) return null
  const recognition = new Recognition()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = 'en-CA'
  let stopped = false
  let announced = false
  recognition.onresult = (event: SpeechRecognitionEvent) => {
    let interim = ''
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index]
      if (result.isFinal) {
        events.onUtterance(result[0].transcript.trim())
        announced = false
        events.onSpeechStop()
      } else interim += result[0].transcript
    }
    if (interim) {
      if (!announced) { announced = true; events.onSpeechStart() }
      events.onPartial(interim)
    }
  }
  recognition.onend = () => { if (!stopped) recognition.start() }
  recognition.onerror = () => events.onError('speech-recognition')
  recognition.start()
  return { kind: 'browser', stop: () => { stopped = true; recognition.stop(); stream.getTracks().forEach((track) => track.stop()) } }
}
