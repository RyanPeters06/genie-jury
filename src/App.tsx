import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import emberListening from './assets/jurors/ember-listening.png'
import emberSpeaking from './assets/jurors/ember-speaking.png'
import galeListening from './assets/jurors/gale-listening.png'
import galeSpeaking from './assets/jurors/gale-speaking.png'
import tideListening from './assets/jurors/tide-listening.png'
import tideSpeaking from './assets/jurors/tide-speaking.png'
import voltListening from './assets/jurors/volt-listening.png'
import voltSpeaking from './assets/jurors/volt-speaking.png'
import { appendFinalTranscript, createRemoteSession, getConnectionState, requestJurorAudio, requestRealtimeSecret, requestResearch } from './lib/jury-api'
import type { ConnectionState } from './lib/jury-api'
import './App.css'
import './intro-layout.css'

type SessionStage = 'intro' | 'mic-ready' | 'text-fallback' | 'user-speaking' | 'researching' | 'juror-speaking' | 'awaiting-answer' | 'verdict'

type Juror = {
  id: 'ember' | 'gale' | 'tide' | 'volt'
  name: string
  role: string
  image: string
  speakingImage: string
  accent: string
  cue: string
  line: string
  verdict: 'BUILD' | 'PIVOT' | 'PROVE' | 'ROASTED'
}

const JURORS: Juror[] = [
  { id: 'ember', name: 'Ember', role: 'The Builder', image: emberListening, speakingImage: emberSpeaking, accent: '#e86748', cue: 'Sizing up the build', line: 'The moment is strong. The scope is not. Pick one magical interaction and make it impossible to ignore.', verdict: 'PIVOT' },
  { id: 'gale', name: 'Gale', role: 'The Skeptic', image: galeListening, speakingImage: galeSpeaking, accent: '#8062ce', cue: 'Researching your claim', line: 'You said nobody does this. I found close alternatives—but none with your exact hackathon wedge.', verdict: 'PROVE' },
  { id: 'tide', name: 'Tide', role: 'The User', image: tideListening, speakingImage: tideSpeaking, accent: '#2997b8', cue: 'Thinking like your user', line: 'I would use this before demo day, when I need an honest teammate instead of an encouraging chatbot.', verdict: 'BUILD' },
  { id: 'volt', name: 'Volt', role: 'The Jester', image: voltListening, speakingImage: voltSpeaking, accent: '#d79a31', cue: 'Preparing an inconvenient truth', line: 'If your pitch says AI-powered before it says who has the problem, I am throwing the lamp.', verdict: 'ROASTED' },
]

const defaultPitch = 'Genie Jury is a live, evidence-backed pitch arena for hackathon builders. Four genies challenge assumptions, research competitors, and help builders leave with a sharper idea.'

const speechRecognition = () => window.SpeechRecognition ?? window.webkitSpeechRecognition

function App() {
  const [stage, setStage] = useState<SessionStage>('intro')
  const [pitch, setPitch] = useState(defaultPitch)
  const [transcript, setTranscript] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [muted, setMuted] = useState(false)
  const [mode, setMode] = useState<'Hackathon' | 'Startup'>('Hackathon')
  const [remoteSessionId, setRemoteSessionId] = useState<string | null>(null)
  const [connection, setConnection] = useState<ConnectionState>('checking')
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const advanceTimer = useRef<number | null>(null)
  const manualRecognitionStop = useRef(false)
  const realtimePeerRef = useRef<RTCPeerConnection | null>(null)
  const microphoneStreamRef = useRef<MediaStream | null>(null)
  const jurorAudioRef = useRef<HTMLAudioElement | null>(null)
  const jurorAudioUrlRef = useRef<string | null>(null)
  const activeJuror = JURORS[activeIndex]
  const caseName = useMemo(() => pitch.match(/^\s*([A-Z][\w\s'-]{2,35}?)(?:\s+is|\s+helps|\s+lets|:)/)?.[1]?.trim() || 'Your idea', [pitch])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLTextAreaElement) return
      if (event.key.toLowerCase() === 'm') setMuted((current) => !current)
      if (event.key === 'Escape' && stage !== 'intro') finishSession()
      if (event.code === 'Space' && ['mic-ready', 'awaiting-answer'].includes(stage)) {
        event.preventDefault()
        if (stage === 'mic-ready') void beginVoicePitch()
        else advanceJury()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  useEffect(() => () => {
    recognitionRef.current?.stop()
    stopInputCapture()
    stopJurorAudio()
    if (advanceTimer.current) window.clearTimeout(advanceTimer.current)
  }, [])

  useEffect(() => { void getConnectionState().then(setConnection) }, [])

  const speak = (text: string, juror = activeJuror) => {
    if (muted || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = .97
    utterance.pitch = juror.id === 'volt' ? 1.22 : juror.id === 'ember' ? .82 : 1
    window.speechSynthesis.speak(utterance)
  }

  async function beginVoicePitch() {
    const remote = await ensureRemoteSession(pitch)
    if (remote && await beginRealtimeTranscription(remote)) return
    beginBrowserSpeech()
  }

  async function ensureRemoteSession(casePitch: string) {
    if (remoteSessionId) return remoteSessionId
    try {
      const session = await createRemoteSession({ mode, pitch: casePitch })
      if (!session) return null
      setRemoteSessionId(session.id)
      setConnection('connected')
      return session.id
    } catch { setConnection('service-unavailable'); return null }
  }

  async function beginRealtimeTranscription(sessionId: string) {
    try {
      const secret = await requestRealtimeSecret(sessionId)
      if (!secret) return false
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const peer = new RTCPeerConnection()
      microphoneStreamRef.current = stream
      stream.getTracks().forEach((track) => peer.addTrack(track, stream))
      const events = peer.createDataChannel('oai-events')
      events.addEventListener('message', (event) => {
        try {
          const payload = JSON.parse(event.data)
          if (payload.type === 'conversation.item.input_audio_transcription.delta' && payload.delta) setTranscript((current) => `${current}${payload.delta}`)
          if (payload.type === 'conversation.item.input_audio_transcription.completed' && payload.transcript) setTranscript(payload.transcript)
        } catch { /* The browser speech fallback remains available. */ }
      })
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      const response = await fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/sdp' }, body: offer.sdp })
      if (!response.ok) { peer.close(); stream.getTracks().forEach((track) => track.stop()); return false }
      await peer.setRemoteDescription({ type: 'answer', sdp: await response.text() })
      realtimePeerRef.current = peer
      manualRecognitionStop.current = false
      setTranscript('')
      setStage('user-speaking')
      return true
    } catch { return false }
  }

  function beginBrowserSpeech() {
    if (!speechRecognition()) { setStage('text-fallback'); return }
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      microphoneStreamRef.current = stream
      const Recognition = speechRecognition()
      const recognition = new Recognition()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = 'en-CA'
      recognition.onresult = (event) => {
        let words = ''
        for (let index = event.resultIndex; index < event.results.length; index += 1) words += event.results[index][0].transcript
        setTranscript((current) => `${current} ${words}`.trim())
      }
      recognition.onerror = () => setStage('text-fallback')
      recognition.onend = () => {
        if (!manualRecognitionStop.current) startDeliberation()
      }
      recognitionRef.current = recognition
      manualRecognitionStop.current = false
      setTranscript('')
      setStage('user-speaking')
      recognition.start()
    }).catch(() => setStage('text-fallback'))
  }

  function endVoicePitch() {
    manualRecognitionStop.current = true
    recognitionRef.current?.stop()
    stopInputCapture()
    startDeliberation()
  }

  function stopInputCapture() {
    realtimePeerRef.current?.close()
    realtimePeerRef.current = null
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop())
    microphoneStreamRef.current = null
  }

  function stopJurorAudio() {
    jurorAudioRef.current?.pause()
    jurorAudioRef.current = null
    if (jurorAudioUrlRef.current) URL.revokeObjectURL(jurorAudioUrlRef.current)
    jurorAudioUrlRef.current = null
    window.speechSynthesis?.cancel()
  }

  async function playJurorLine(juror: Juror) {
    stopJurorAudio()
    if (muted || !remoteSessionId) { speak(juror.line, juror); return }
    try {
      const blob = await requestJurorAudio(remoteSessionId, juror.id, juror.line)
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      jurorAudioUrlRef.current = url
      jurorAudioRef.current = audio
      audio.onended = () => stopJurorAudio()
      await audio.play()
    } catch { speak(juror.line, juror) }
  }

  function startDeliberation() {
    recognitionRef.current?.stop()
    stopInputCapture()
    setActiveIndex(1)
    setStage('researching')
    void beginRemoteResearch(transcript || pitch)
    advanceTimer.current = window.setTimeout(() => {
      setStage('juror-speaking')
      window.setTimeout(() => { void playJurorLine(JURORS[1]) }, 140)
    }, 1400)
  }

  async function beginRemoteResearch(casePitch: string) {
    try {
      const sessionId = remoteSessionId ?? await ensureRemoteSession(casePitch)
      if (!sessionId) return
      await appendFinalTranscript(sessionId, casePitch)
      await requestResearch(sessionId)
    } catch {
      setConnection('service-unavailable')
    }
  }

  function advanceJury() {
    if (activeIndex === JURORS.length - 1) { finishSession(); return }
    const nextIndex = activeIndex + 1
    setActiveIndex(nextIndex)
    setStage('juror-speaking')
    window.setTimeout(() => {
      void playJurorLine(JURORS[nextIndex])
    }, 120)
  }

  function finishSession() {
    manualRecognitionStop.current = true
    recognitionRef.current?.stop()
    stopInputCapture()
    stopJurorAudio()
    setStage('verdict')
  }

  const submitTextPitch = (event: FormEvent) => { event.preventDefault(); setTranscript(pitch); startDeliberation() }
  const stageStatus = stage === 'user-speaking' ? 'YOUR TURN — WE ARE LISTENING' : stage === 'researching' ? 'GALE IS GATHERING RECEIPTS' : stage === 'juror-speaking' ? `${activeJuror.name.toUpperCase()} IS SPEAKING` : stage === 'awaiting-answer' ? 'YOUR RESPONSE' : 'THE JURY IS READY'
  const stageLine = stage === 'user-speaking' ? (transcript || 'Pitch your idea. We will not interrupt you yet.') : stage === 'researching' ? 'Separating your claims from your assumptions…' : stage === 'juror-speaking' ? activeJuror.line : stage === 'awaiting-answer' ? 'Space continues to the next juror.' : 'Press space to begin your pitch.'

  return <main className={`app day-sky stage-${stage}`} style={{ '--active-accent': activeJuror.accent } as CSSProperties}>
    <Cloudscape />
    {stage === 'intro' && <section className="intro-screen">
      <div className="wordmark"><span>✦</span> GENIE <b>JURY</b></div>
      <div className="intro-copy"><p>THE HONEST TEAMMATE YOU NEEDED</p><h1>Pitch your idea.<br /><em>Face the jury.</em></h1><span>Four skyborne jurors pressure-test your hackathon idea before the real judges do.</span><button className="sun-button" onClick={() => setStage('mic-ready')}>ENTER THE SKY <i>→</i></button></div>
      <JurySky activeIndex={-1} onJurorSelect={setActiveIndex} />
    </section>}

    {stage === 'mic-ready' && <section className="ready-screen">
      <div className="wordmark"><span>✦</span> GENIE <b>JURY</b></div>
      <div className="ready-card"><span className="sky-icon">☁</span><p>LIVE VOICE PITCH</p><h2>The Jury is listening.</h2><span>Speak naturally. The jurors wait until you finish before they challenge your pitch.</span><button className="sun-button" onClick={() => void beginVoicePitch()}>TURN ON MIC <i>●</i></button><button className="text-link" onClick={() => setStage('text-fallback')}>I would rather type my pitch</button><small>Space starts · M mutes jurors · Esc ends the session</small></div>
      <JurySky activeIndex={-1} onJurorSelect={setActiveIndex} subdued />
    </section>}

    {stage === 'text-fallback' && <section className="text-screen"><div className="wordmark"><span>✦</span> GENIE <b>JURY</b></div><form onSubmit={submitTextPitch}><p>TYPE YOUR CASE</p><h2>What idea are you asking<br />the Jury to believe in?</h2><div className="mode-toggle">{(['Hackathon', 'Startup'] as const).map((item) => <button type="button" className={mode === item ? 'selected' : ''} onClick={() => setMode(item)} key={item}>{item} mode</button>)}</div><textarea value={pitch} onChange={(event) => setPitch(event.target.value)} /><button className="sun-button" type="submit">SUMMON THE JURY <i>→</i></button></form></section>}

    {['user-speaking', 'researching', 'juror-speaking', 'awaiting-answer'].includes(stage) && <section className="pitch-stage">
      <div className="stage-top"><div className="wordmark"><span>✦</span> GENIE <b>JURY</b></div><span>{mode} MODE · {caseName}</span></div>
      <JurySky activeIndex={stage === 'user-speaking' ? -1 : activeIndex} talkingIndex={stage === 'juror-speaking' ? activeIndex : -1} onJurorSelect={(index) => { if (stage !== 'user-speaking') { setActiveIndex(index); setStage('juror-speaking') } }} />
      <div className="voice-cue" aria-live="polite"><div className="cue-label"><span className={`live-dot ${stage === 'user-speaking' ? 'recording' : ''}`} />{stageStatus}<span className="connection-state">{connection === 'connected' ? 'CONNECTED' : connection === 'checking' ? 'CHECKING' : connection === 'demo-fallback' ? 'DEMO FALLBACK' : 'SERVICE UNAVAILABLE'}</span><button onClick={() => { stopJurorAudio(); setMuted((current) => !current) }} aria-label={muted ? 'Unmute jury voices' : 'Mute jury voices'}>{muted ? 'UNMUTE' : 'MUTE'}</button></div><div className="cue-body"><div className="wave" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div><p>{stageLine}</p>{stage === 'user-speaking' && <button className="end-pitch" onClick={endVoicePitch}>I’M DONE <i>→</i></button>}{stage === 'juror-speaking' && <button className="end-pitch" onClick={() => setStage('awaiting-answer')}>CONTINUE <i>→</i></button>}{stage === 'awaiting-answer' && <button className="end-pitch" onClick={advanceJury}>{activeIndex === 3 ? 'HEAR VERDICT' : 'NEXT JUROR'} <i>→</i></button>}</div></div>
    </section>}

    {stage === 'verdict' && <section className="verdict-screen"><div className="wordmark"><span>✦</span> GENIE <b>JURY</b></div><div className="verdict-copy"><p>THE JURY’S VERDICT</p><h2>{caseName} has<br /><em>a pulse.</em></h2><span>The jury found a version worth building. Keep the pressure; cut the platform.</span><div className="ally-note"><b>THE ALLY SAYS</b><h3>Build the 90-second moment.</h3><p>Make Gale interrupt with a real receipt, then show how the user can pivot. That is the demo people will remember.</p></div><div className="vote-row">{JURORS.map((juror) => <span key={juror.id} style={{ '--vote-color': juror.accent } as React.CSSProperties}><b>{juror.name}</b>{juror.verdict}</span>)}</div><button className="sun-button" onClick={() => { setActiveIndex(0); setStage('intro') }}>TRY ANOTHER IDEA <i>→</i></button></div><JurySky activeIndex={1} onJurorSelect={setActiveIndex} subdued /></section>}
  </main>
}

function JurySky({ activeIndex, talkingIndex = -1, subdued = false, onJurorSelect }: { activeIndex: number; talkingIndex?: number; subdued?: boolean; onJurorSelect: (index: number) => void }) {
  return <div className={`jury-sky ${subdued ? 'subdued' : ''}`} aria-label="The Genie Jury">{JURORS.map((juror, index) => <button key={juror.id} className={`sky-juror juror-${juror.id} ${activeIndex === index ? 'active' : ''} ${activeIndex >= 0 && activeIndex !== index ? 'dimmed' : ''}`} onClick={() => onJurorSelect(index)} aria-label={`${juror.name}, ${juror.role}`}><img src={talkingIndex === index ? juror.speakingImage : juror.image} alt="" /><span className="juror-tag"><b>{juror.name}</b>{juror.role}</span></button>)}</div>
}

function Cloudscape() { return <><div className="sun-glow" /><div className="cloud bank-one" /><div className="cloud bank-two" /><div className="cloud bank-three" /><div className="cloud cloud-left" /><div className="cloud cloud-right" /></> }

export default App
