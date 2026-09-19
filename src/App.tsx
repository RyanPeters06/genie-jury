import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import emberListening from './assets/jurors/ember-listening.png'
import emberSpeaking from './assets/jurors/ember-speaking.png'
import galeListening from './assets/jurors/gale-listening.png'
import galeSpeaking from './assets/jurors/gale-speaking.png'
import tideListening from './assets/jurors/tide-listening.png'
import tideSpeaking from './assets/jurors/tide-speaking.png'
import voltListening from './assets/jurors/volt-listening.png'
import voltSpeaking from './assets/jurors/volt-speaking.png'
import { BrowserbaseDock, idleBrowserActivity } from './components/BrowserbaseDock'
import type { BrowserActivity } from './components/BrowserbaseDock'
import { JuryTrace, traceFromFinding, traceFromNode } from './components/JuryTrace'
import type { TraceItem } from './components/JuryTrace'
import {
  createRemoteSession, finishRemoteSession, getConnectionState, getServiceHealth,
  requestDeliberation, requestInterjection, requestJurorAudio, requestReply, subscribeToStage,
} from './lib/jury-api'
import type { ConnectionState, Deliberation, Evidence, Finding, JurorId, JurorTurn, RunNode, StageEvent } from './lib/jury-api'
import { openMicrophone } from './lib/realtime'
import type { Mic } from './lib/realtime'
import './App.css'
import './intro-layout.css'
import './stage.css'

type Stage = 'intro' | 'ready' | 'text' | 'pitching' | 'deliberating' | 'panel' | 'verdict'

type Juror = { id: JurorId; name: string; role: string; image: string; speakingImage: string; accent: string; cue: string; line: string }
type Scorecard = { juror: JurorId; score: number; summary: string; action: string; criteria: Array<{ label: string; score: number; max: number }> }

const JURORS: Juror[] = [
  { id: 'ember', name: 'Ember', role: 'The Builder', image: emberListening, speakingImage: emberSpeaking, accent: '#e86748', cue: 'Sizing up the build', line: 'The moment is strong. The scope is not.' },
  { id: 'gale', name: 'Gale', role: 'The Skeptic', image: galeListening, speakingImage: galeSpeaking, accent: '#8062ce', cue: 'Checking the receipts', line: 'You said nobody does this. Let me check.' },
  { id: 'tide', name: 'Tide', role: 'The User', image: tideListening, speakingImage: tideSpeaking, accent: '#2997b8', cue: 'Thinking like your user', line: 'Tell me about one real person with this problem.' },
  { id: 'volt', name: 'Volt', role: 'The Jester', image: voltListening, speakingImage: voltSpeaking, accent: '#d79a31', cue: 'Preparing an inconvenient truth', line: 'Who is awake at 2 a.m. without this?' },
]

const JUROR_BY_ID = Object.fromEntries(JURORS.map((juror) => [juror.id, juror])) as Record<JurorId, Juror>
const AGENT_LABEL: Record<string, string> = { bailiff: 'Bailiff', ally: 'The Ally', builder: 'You', system: 'Jury' }
const agentName = (agent?: string | null) => (agent && agent in JUROR_BY_ID ? JUROR_BY_ID[agent as JurorId].name : AGENT_LABEL[agent ?? ''] ?? agent ?? 'Jury')
const agentAccent = (agent: string) => (agent in JUROR_BY_ID ? JUROR_BY_ID[agent as JurorId].accent : '#6d8aa6')

const DEFAULT_PITCH = 'Genie Jury is a live pitch arena for hackathon builders. Four AI jurors interrupt your pitch, research your claims in a real browser, argue with each other, and hand you the smallest next thing worth building.'

/** A transparent local rubric keeps the verdict useful even if a provider falls back. */
function scorePitch(pitch: string, evidence: Evidence[], findings: Finding[]): Scorecard[] {
  const words = pitch.trim().split(/\s+/).filter(Boolean).length
  const lower = pitch.toLowerCase()
  const severity = (juror: JurorId) => findings.filter((finding) => finding.agent === juror).reduce((sum, finding) => sum + finding.severity, 0)
  const hasUser = /\b(user|student|builder|founder|team|people|customer|developer)\b/.test(lower)
  const hasPain = /\b(problem|pain|struggle|friction|waste|hard|need|without)\b/.test(lower)
  const verified = evidence.filter((item) => item.status === 'verified').length
  const grounded = evidence.length > 0
  const clamp = (score: number) => Math.max(0, Math.min(100, Math.round(score)))
  const emberScope = clamp(50 - severity('ember') * 7)
  const emberDemo = clamp(words >= 35 && words <= 180 ? 42 : 25)
  const galeProof = clamp(verified ? 46 : grounded ? 30 : 16)
  const galeDiscipline = clamp(50 - severity('gale') * 5)
  const tidePerson = hasUser ? 43 : 21
  const tideUrgency = hasPain ? 40 : 20
  const voltClarity = clamp(words >= 25 && words <= 150 ? 42 : 25)
  const voltHook = clamp((hasPain ? 28 : 16) + (lower.includes('because') || lower.includes('so that') ? 12 : 4))
  return [
    { juror: 'ember', score: clamp(emberScope + emberDemo), summary: 'Build readiness is scored from scope risks and whether the pitch names a demo-sized moment.', action: 'Cut to one end-to-end interaction.', criteria: [{ label: 'Build scope', score: emberScope, max: 50 }, { label: 'Demo path', score: emberDemo, max: 50 }] },
    { juror: 'gale', score: clamp(galeProof + galeDiscipline), summary: 'Claim confidence depends on captured Browserbase receipts, not on how confident the pitch sounds.', action: 'Prove the riskiest factual claim.', criteria: [{ label: 'Evidence captured', score: galeProof, max: 50 }, { label: 'Claim discipline', score: galeDiscipline, max: 50 }] },
    { juror: 'tide', score: clamp(tidePerson + tideUrgency), summary: 'User strength is scored from a named person and a concrete moment of pain or urgency.', action: 'Interview three people in that moment.', criteria: [{ label: 'User specificity', score: tidePerson, max: 50 }, { label: 'Pain & urgency', score: tideUrgency, max: 50 }] },
    { juror: 'volt', score: clamp(voltClarity + voltHook), summary: 'Pitch clarity rewards a concise story that leads with the problem and gives the demo a hook.', action: 'Open with the problem, then show the wow.', criteria: [{ label: 'Pitch clarity', score: voltClarity, max: 50 }, { label: 'Memorable hook', score: voltHook, max: 50 }] },
  ]
}

/** Barge-in guard: ignore mic activity for a moment after audio starts so a juror does not interrupt itself. */
const SELF_ECHO_MS = 700
const PITCH_SILENCE_MS = 3200

export default function App() {
  const [stage, setStage] = useState<Stage>('intro')
  const [mode, setMode] = useState<'Hackathon' | 'Startup'>('Hackathon')
  const [pitch, setPitch] = useState(DEFAULT_PITCH)
  const [caption, setCaption] = useState('')
  const [partial, setPartial] = useState('')
  const [speakingJuror, setSpeakingJuror] = useState<JurorId | null>(null)
  const [focusJuror, setFocusJuror] = useState<JurorId | null>(null)
  const [cue, setCue] = useState('The jury is ready')
  const [listening, setListening] = useState(false)
  const [muted, setMuted] = useState(false)
  const [connection, setConnection] = useState<ConnectionState>('checking')
  const [services, setServices] = useState<Record<string, string> | null>(null)
  const [deliberation, setDeliberation] = useState<Deliberation | null>(null)
  const [evidence, setEvidence] = useState<Evidence[]>([])
  const [browser, setBrowser] = useState<BrowserActivity>(idleBrowserActivity)
  const [trace, setTrace] = useState<TraceItem[]>([])
  const [dockOpen, setDockOpen] = useState(true)
  const [traceOpen, setTraceOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const sessionRef = useRef<string | null>(null)
  const micRef = useRef<Mic | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const audioStartedAt = useRef(0)
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const stageRef = useRef<Stage>('intro')
  const pitchRef = useRef('')
  const answerRef = useRef('')
  const turnIndexRef = useRef(0)
  const turnsRef = useRef<JurorTurn[]>([])
  const bargedRef = useRef(false)
  const answerTimer = useRef<number | null>(null)
  const advanceTimer = useRef<number | null>(null)
  const pitchSilenceTimer = useRef<number | null>(null)
  const interjectAt = useRef(0)
  const busyRef = useRef(false)
  const turnsDoneRef = useRef(false)

  const caseName = useMemo(() => pitch.match(/^\s*([A-Z][\w\s'-]{2,35}?)(?:\s+is|\s+helps|\s+lets|:)/)?.[1]?.trim() || 'Your idea', [pitch])

  // Async conversation loops read these refs long after the render that set them.
  useEffect(() => { stageRef.current = stage }, [stage])

  useEffect(() => {
    void getConnectionState().then(setConnection)
    void getServiceHealth().then(setServices)
  }, [])

  const pushTrace = useCallback((item: TraceItem | null) => {
    if (!item) return
    setTrace((current) => (current.some((existing) => existing.id === item.id) ? current.map((existing) => (existing.id === item.id ? item : existing)) : [...current, item]))
  }, [])

  // ---- audio ------------------------------------------------------------

  const stopAudio = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    audioUrlRef.current = null
    window.speechSynthesis?.cancel()
  }, [])

  const speak = useCallback(async (juror: JurorId, line: string) => {
    if (pitchSilenceTimer.current) window.clearTimeout(pitchSilenceTimer.current)
    pitchSilenceTimer.current = null
    stopAudio()
    setSpeakingJuror(juror)
    audioStartedAt.current = Date.now()
    const clean = line.replace(/\[[^\]]{1,24}\]/g, '').replace(/\s{2,}/g, ' ').trim()
    if (muted) return new Promise<void>((resolve) => window.setTimeout(resolve, Math.min(9000, 400 + clean.length * 45)))
    const sessionId = sessionRef.current
    if (sessionId) {
      try {
        const blob = await requestJurorAudio(sessionId, juror, line)
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audioUrlRef.current = url
        audioRef.current = audio
        audioStartedAt.current = Date.now()
        await audio.play()
        await new Promise<void>((resolve) => { audio.onended = () => resolve(); audio.onerror = () => resolve() })
        return
      } catch { /* fall through to the browser voice */ }
    }
    if (!('speechSynthesis' in window)) return
    await new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(clean)
      utterance.rate = .98
      utterance.pitch = juror === 'volt' ? 1.2 : juror === 'ember' ? .85 : 1
      utterance.onend = () => resolve()
      utterance.onerror = () => resolve()
      window.speechSynthesis.speak(utterance)
    })
  }, [muted, stopAudio])

  // ---- live stage feed ---------------------------------------------------

  const onStageEvent = useCallback((event: StageEvent) => {
    const data = event.data
    switch (event.type) {
      case 'browser.session':
        setBrowser((current) => ({ ...current, sessionId: String(data.sessionId ?? ''), liveViewUrl: (data.liveViewUrl as string) ?? null, agent: (data.agent as string) ?? current.agent, status: 'browsing' }))
        setDockOpen(true)
        break
      case 'browser.search':
        setBrowser((current) => ({ ...current, status: 'searching', agent: (data.agent as string) ?? current.agent, lastQuery: String(data.query ?? ''), hits: (data.results as Array<{ title: string; url: string }>) ?? [] }))
        break
      case 'browser.navigate':
        setBrowser((current) => ({ ...current, status: 'browsing', agent: (data.agent as string) ?? current.agent, currentUrl: String(data.url ?? '') }))
        break
      case 'browser.screenshot':
        setBrowser((current) => ({ ...current, status: 'browsing', currentUrl: String(data.url ?? current.currentUrl ?? ''), screenshots: [...current.screenshots, { url: String(data.url ?? ''), title: String(data.title ?? ''), dataUrl: String(data.screenshotDataUrl ?? '') }].slice(-6) }))
        break
      case 'browser.act':
        setBrowser((current) => ({ ...current, status: 'acting', lastAction: String(data.instruction ?? '') }))
        break
      case 'browser.extract':
        setBrowser((current) => ({ ...current, status: 'acting', lastAction: `Read: ${String(data.instruction ?? '')}` }))
        break
      case 'browser.closed':
        setBrowser((current) => ({ ...current, status: 'done', liveViewUrl: null }))
        break
      case 'browser.error':
        setBrowser((current) => ({ ...current, status: current.screenshots.length ? current.status : 'error' }))
        break
      case 'ledger.evidence':
        setEvidence((current) => [...current, data.evidence as Evidence])
        break
      case 'ledger.finding':
        pushTrace(traceFromFinding(data.finding as Finding))
        break
      case 'ledger.node':
        pushTrace(traceFromNode(data.node as RunNode))
        break
      case 'juror.turn': {
        // A juror is ready to speak. Start the panel now rather than waiting for the verdict.
        const turn = data as unknown as JurorTurn
        const order: JurorId[] = ['gale', 'ember', 'tide', 'volt']
        const slot = order.indexOf(turn.juror)
        if (slot >= 0) turnsRef.current[slot] = turn
        if (stageRef.current === 'deliberating') { setStage('panel'); void runPanelRef.current(0) }
        break
      }
    }
  }, [pushTrace])

  const runPanelRef = useRef<(from: number) => Promise<void>>(async () => undefined)

  // ---- conversation ------------------------------------------------------

  /** Wait for a streamed turn to arrive, so the panel can start before the run finishes. */
  const awaitTurn = useCallback(async (index: number) => {
    for (let waited = 0; waited < 45000; waited += 120) {
      if (turnsRef.current[index]) return turnsRef.current[index]
      if (stageRef.current !== 'panel') return null
      if (turnsDoneRef.current) return turnsRef.current[index] ?? null
      await new Promise((resolve) => window.setTimeout(resolve, 120))
    }
    return turnsRef.current[index] ?? null
  }, [])

  const runPanel = useCallback(async (from: number) => {
    for (let index = from; index < 4; index += 1) {
      if (stageRef.current !== 'panel') return
      turnIndexRef.current = index
      if (!turnsRef.current[index]) {
        setCue('The jury is still deliberating')
        const arrived = await awaitTurn(index)
        if (!arrived) break
      }
      const turn = turnsRef.current[index]
      if (!turn) break
      bargedRef.current = false
      setFocusJuror(turn.juror)
      setCue(turn.cue)
      setCaption(turn.line)
      await speak(turn.juror, turn.line)
      setSpeakingJuror(null)
      if (bargedRef.current) return
      // A beat for the builder to jump in, the way a real panel leaves space.
      const interrupted = await new Promise<boolean>((resolve) => {
        advanceTimer.current = window.setTimeout(() => resolve(false), 1500)
        const check = window.setInterval(() => { if (bargedRef.current) { window.clearInterval(check); resolve(true) } }, 100)
        window.setTimeout(() => window.clearInterval(check), 1600)
      })
      if (interrupted) return
    }
    if (stageRef.current === 'panel' && turnsDoneRef.current) {
      setStage('verdict')
      setSpeakingJuror(null)
      setFocusJuror(null)
      if (sessionRef.current) void finishRemoteSession(sessionRef.current)
    }
  }, [awaitTurn, speak])

  const submitAnswer = useCallback(async () => {
    const sessionId = sessionRef.current
    const text = answerRef.current.trim()
    answerRef.current = ''
    const juror = turnsRef.current[turnIndexRef.current]?.juror
    if (!sessionId || !text || !juror || busyRef.current) return
    busyRef.current = true
    setCue(`${JUROR_BY_ID[juror].name} is considering your answer`)
    setCaption(text)
    try {
      const { turn } = await requestReply(sessionId, juror, text)
      turnsRef.current = turnsRef.current.map((item, index) => (index === turnIndexRef.current ? turn : item))
      setCue(turn.cue)
      setCaption(turn.line)
      setFocusJuror(turn.juror)
      await speak(turn.juror, turn.line)
      setSpeakingJuror(null)
    } catch {
      setNotice('That juror could not answer. Moving on.')
    } finally {
      busyRef.current = false
      bargedRef.current = false
      if (stageRef.current === 'panel') void runPanelRef.current(turnIndexRef.current + 1)
    }
  }, [speak])

  const beginDeliberation = useCallback(async () => {
    const sessionId = sessionRef.current
    if (!sessionId || busyRef.current) return
    if (pitchSilenceTimer.current) window.clearTimeout(pitchSilenceTimer.current)
    pitchSilenceTimer.current = null
    busyRef.current = true
    stopAudio()
    setStage('deliberating')
    setSpeakingJuror(null)
    setFocusJuror(null)
    setPartial('')
    setCue('The jury is deliberating')
    setCaption('Four jurors are splitting up your pitch, checking claims in a live browser, and comparing notes.')
    turnsRef.current = []
    turnsDoneRef.current = false
    turnIndexRef.current = 0
    busyRef.current = false
    try {
      // Turns stream in over the event feed, so the panel usually starts talking
      // while this request is still finishing the verdict and the votes.
      const result = await requestDeliberation(sessionId, pitchRef.current || pitch)
      turnsDoneRef.current = true
      setDeliberation(result)
      setEvidence(result.ledger.evidence)
      for (const node of result.runTree) pushTrace(traceFromNode(node))
      result.turns.forEach((turn, index) => { turnsRef.current[index] = turnsRef.current[index] ?? turn })
      if (stageRef.current === 'deliberating') { setStage('panel'); void runPanelRef.current(0) }
    } catch {
      turnsDoneRef.current = true
      setConnection('service-unavailable')
      setNotice('The jury service is unreachable, so the jurors are speaking from their fallback notes.')
      if (!turnsRef.current.length) turnsRef.current = JURORS.map((juror) => ({ juror: juror.id, line: juror.line, cue: juror.cue, basedOn: { findingIds: [], evidenceIds: [], messagesFrom: [] } }))
      if (stageRef.current === 'deliberating') { setStage('panel'); void runPanelRef.current(0) }
    }
  }, [pitch, pushTrace, stopAudio])

  const beginDeliberationRef = useRef(beginDeliberation)
  const submitAnswerRef = useRef(submitAnswer)
  useEffect(() => { runPanelRef.current = runPanel }, [runPanel])
  useEffect(() => { beginDeliberationRef.current = beginDeliberation }, [beginDeliberation])
  useEffect(() => { submitAnswerRef.current = submitAnswer }, [submitAnswer])

  /** Every finished utterance, routed by what the jury is currently doing. */
  const handleUtterance = useCallback(async (text: string) => {
    setPartial('')
    const sessionId = sessionRef.current
    if (stageRef.current === 'pitching') {
      pitchRef.current = `${pitchRef.current} ${text}`.trim()
      setPitch(pitchRef.current)
      setCaption(pitchRef.current.split(/(?<=[.!?])\s/).slice(-2).join(' '))
      // While the builder talks, the panel listens for something it cannot let pass.
      if (sessionId && text.split(/\s+/).length >= 6 && Date.now() - interjectAt.current > 9000) {
        interjectAt.current = Date.now()
        const interjection = await requestInterjection(sessionId, { pitchSoFar: pitchRef.current, newText: text })
        if (interjection?.interrupt && stageRef.current === 'pitching') {
          setFocusJuror(interjection.juror)
          setCue(`${JUROR_BY_ID[interjection.juror].name} cuts in`)
          setCaption(interjection.line)
          await speak(interjection.juror, interjection.line)
          setSpeakingJuror(null)
          if (stageRef.current === 'pitching') { setCue('Keep going'); setFocusJuror(null) }
        }
      }
      return
    }
    if (stageRef.current === 'panel') {
      answerRef.current = `${answerRef.current} ${text}`.trim()
      if (answerTimer.current) window.clearTimeout(answerTimer.current)
      answerTimer.current = window.setTimeout(() => void submitAnswerRef.current(), 900)
    }
  }, [speak])

  const handleSpeechStart = useCallback(() => {
    setListening(true)
    if (Date.now() - audioStartedAt.current < SELF_ECHO_MS) return
    // Barge-in: the builder talking over a juror stops that juror mid-sentence.
    if (stageRef.current === 'panel' && audioRef.current) {
      bargedRef.current = true
      stopAudio()
      setSpeakingJuror(null)
      setCue('Go ahead, the jury is listening')
    }
  }, [stopAudio])

  const beginSession = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    try {
      const session = await createRemoteSession({ mode, pitch: pitch.trim() || DEFAULT_PITCH })
      if (session) {
        sessionRef.current = session.id
        setConnection('connected')
        unsubscribeRef.current = subscribeToStage(session.id, onStageEvent)
      }
    } catch { setConnection('service-unavailable') }
    busyRef.current = false

    pitchRef.current = ''
    setPitch('')
    setCaption('')
    setCue('Pitch your idea. They will cut in if you give them a reason.')
    setStage('pitching')

    if (sessionRef.current) {
      const mic = await openMicrophone(sessionRef.current, {
        onSpeechStart: () => {
          if (pitchSilenceTimer.current) window.clearTimeout(pitchSilenceTimer.current)
          pitchSilenceTimer.current = null
          handleSpeechStart()
        },
        onSpeechStop: () => {
          setListening(false)
          // A natural pause is the only "submit" action.  Keeping this here,
          // rather than a button on the art, makes the stage behave like a call.
          if (stageRef.current === 'pitching' && pitchRef.current.trim().split(/\s+/).length >= 12) {
            if (pitchSilenceTimer.current) window.clearTimeout(pitchSilenceTimer.current)
            pitchSilenceTimer.current = window.setTimeout(() => {
              if (stageRef.current === 'pitching') void beginDeliberationRef.current()
            }, PITCH_SILENCE_MS)
          }
        },
        onPartial: setPartial,
        onUtterance: (text) => void handleUtterance(text),
        onError: (reason) => {
          setNotice(reason === 'microphone-denied' ? 'Microphone blocked, so type your pitch instead.' : 'Live transcription is unavailable, so type your pitch instead.')
          setStage('text')
        },
      })
      micRef.current = mic
    } else setStage('text')
  }, [handleSpeechStart, handleUtterance, mode, onStageEvent, pitch])

  const submitTypedPitch = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    if (!sessionRef.current) {
      try {
        const session = await createRemoteSession({ mode, pitch: pitch.trim() || DEFAULT_PITCH })
        if (session) { sessionRef.current = session.id; setConnection('connected'); unsubscribeRef.current = subscribeToStage(session.id, onStageEvent) }
      } catch { setConnection('service-unavailable') }
    }
    pitchRef.current = pitch.trim() || DEFAULT_PITCH
    void beginDeliberationRef.current()
  }, [mode, onStageEvent, pitch])

  const endSession = useCallback(() => {
    stopAudio()
    micRef.current?.stop()
    micRef.current = null
    unsubscribeRef.current?.()
    unsubscribeRef.current = null
    if (answerTimer.current) window.clearTimeout(answerTimer.current)
    if (advanceTimer.current) window.clearTimeout(advanceTimer.current)
    if (pitchSilenceTimer.current) window.clearTimeout(pitchSilenceTimer.current)
    pitchSilenceTimer.current = null
    if (sessionRef.current) void finishRemoteSession(sessionRef.current)
    setSpeakingJuror(null)
    setListening(false)
    setStage('verdict')
  }, [stopAudio])

  useEffect(() => () => {
    micRef.current?.stop()
    unsubscribeRef.current?.()
    stopAudio()
  }, [stopAudio])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return
      if (event.key.toLowerCase() === 'm') { stopAudio(); setMuted((current) => !current) }
      if (event.key === 'Escape' && stage !== 'intro') endSession()
      if (event.code === 'Space' && stage === 'ready') { event.preventDefault(); void beginSession() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [beginSession, endSession, stage, stopAudio])

  const restart = () => {
    micRef.current?.stop()
    micRef.current = null
    unsubscribeRef.current?.()
    unsubscribeRef.current = null
    sessionRef.current = null
    pitchRef.current = ''
    answerRef.current = ''
    turnsRef.current = []
    turnIndexRef.current = 0
    if (pitchSilenceTimer.current) window.clearTimeout(pitchSilenceTimer.current)
    pitchSilenceTimer.current = null
    setDeliberation(null)
    setEvidence([])
    setTrace([])
    setBrowser(idleBrowserActivity)
    setPitch(DEFAULT_PITCH)
    setCaption('')
    setNotice(null)
    setStage('intro')
  }

  const onStage = stage === 'pitching' || stage === 'deliberating' || stage === 'panel'
  const activeAccent = focusJuror ? JUROR_BY_ID[focusJuror].accent : '#5b87a8'
  const verdict = deliberation?.verdict
  const scorecards = useMemo(() => scorePitch(pitch, evidence, deliberation?.ledger.findings ?? []), [deliberation, evidence, pitch])
  const overallScore = Math.round(scorecards.reduce((total, card) => total + card.score, 0) / scorecards.length)

  return <main className={`app day-sky stage-${stage}`} style={{ '--active-accent': activeAccent } as CSSProperties}>
    <Cloudscape />

    {stage === 'intro' && <section className="intro-screen">
      <Wordmark />
      <div className="intro-copy">
        <p>THE HONEST TEAMMATE YOU NEEDED</p>
        <h1>Pitch your idea.<br /><em>Face the jury.</em></h1>
        <span>Four AI jurors interrupt your pitch, open a real browser to check your claims, argue with each other, then tell you the smallest thing worth building next.</span>
        <button className="sun-button" onClick={() => setStage('ready')}>ENTER THE SKY <i>→</i></button>
        <ServiceStrip services={services} connection={connection} />
      </div>
      <JurySky />
    </section>}

    {stage === 'ready' && <section className="ready-screen">
      <Wordmark />
      <div className="ready-card">
        <span className="sky-icon">☁</span>
        <p>LIVE VOICE PITCH</p>
        <h2>The jury is listening.</h2>
        <span>Speak naturally. Your microphone stays open the whole session, so a juror can cut into your pitch and you can cut them off right back.</span>
        <div className="mode-toggle">{(['Hackathon', 'Startup'] as const).map((item) => <button type="button" key={item} className={mode === item ? 'selected' : ''} onClick={() => setMode(item)}>{item} mode</button>)}</div>
        <button className="sun-button" onClick={() => void beginSession()}>TURN ON MIC <i>●</i></button>
        <button className="text-link" onClick={() => setStage('text')}>I would rather type my pitch</button>
        <small>Space starts · M mutes the jury · Esc ends the session</small>
      </div>
      <JurySky subdued />
    </section>}

    {stage === 'text' && <section className="text-screen">
      <Wordmark />
      <form onSubmit={submitTypedPitch}>
        <p>TYPE YOUR CASE</p>
        <h2>What idea are you asking<br />the jury to believe in?</h2>
        <div className="mode-toggle">{(['Hackathon', 'Startup'] as const).map((item) => <button type="button" key={item} className={mode === item ? 'selected' : ''} onClick={() => setMode(item)}>{item} mode</button>)}</div>
        <textarea value={pitch} onChange={(event) => setPitch(event.target.value)} />
        <button className="sun-button" type="submit">SUMMON THE JURY <i>→</i></button>
      </form>
    </section>}

    {onStage && <section className="pitch-stage">
      <div className="stage-top">
        <Wordmark />
        <div className="stage-actions">
          <span>{mode} MODE · {caseName}</span>
          <button className="end-session" onClick={endSession}>END SESSION</button>
        </div>
      </div>

      <JurySky focus={focusJuror} speaking={speakingJuror} listening={stage === 'pitching'} />

      <BrowserbaseDock activity={browser} evidence={evidence} expanded={dockOpen} onToggle={() => setDockOpen((open) => !open)} jurorName={agentName} />
      <JuryTrace items={trace} expanded={traceOpen} onToggle={() => setTraceOpen((open) => !open)} jurorName={agentName} accent={agentAccent} />

      <div className="voice-cue" aria-live="polite">
        <div className="cue-label">
          <span className={`live-dot ${listening ? 'recording' : ''}`} />
          {speakingJuror ? `${JUROR_BY_ID[speakingJuror].name.toUpperCase()} — ${cue.toUpperCase()}` : cue.toUpperCase()}
          <span className="connection-state">{connection === 'connected' ? 'CONNECTED' : connection === 'checking' ? 'CHECKING' : connection === 'demo-fallback' ? 'DEMO FALLBACK' : 'OFFLINE'}</span>
        </div>
        <div className="cue-body">
          <div className="wave" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div>
          <p>{partial || caption || 'Pitch your idea.'}</p>
        </div>
      </div>
      {notice && <p className="stage-notice">{notice}</p>}
    </section>}

    {stage === 'verdict' && <section className="verdict-screen">
      <Wordmark />
      <div className="scoreboard">
        <div className="scoreboard-intro">
        <p>THE JURY’S SCORECARD</p>
        <div className="overall-score"><b>{overallScore}</b><span>/ 100<br />OVERALL</span></div>
        <h2>{verdict?.headline ?? `${caseName} has a pulse.`}</h2>
        <span>{verdict?.summary ?? 'The jury found a version worth building. Keep the pressure; cut the platform.'}</span>
        <div className="ally-note">
          <b>THE ALLY SAYS</b>
          <h3>{verdict?.smallestNextBuild ?? 'Build the 90-second moment.'}</h3>
          <ul>
            <li><b>CUT</b>{verdict?.scopeCut ?? 'Everything that is not the demo moment.'}</li>
            <li><b>PROVE</b>{verdict?.evidenceQuestion ?? 'Verify the claim the pitch depends on most.'}</li>
            <li><b>TEST</b>{verdict?.userTest ?? 'Watch three target users hit the problem.'}</li>
          </ul>
        </div>
        <div className="vote-row">{JURORS.map((juror) => {
          const vote = verdict?.votes?.[juror.id]
          return <span key={juror.id} style={{ '--vote-color': juror.accent } as CSSProperties} title={vote?.because}><b>{juror.name}</b>{vote?.vote ?? '—'}</span>
        })}</div>
        {evidence.length > 0 && <div className="receipts">
          <b>RECEIPTS FROM THE LIVE BROWSER</b>
          <ul>{evidence.slice(0, 3).map((item, index) => <li key={`${item.sourceUrl ?? index}`} className={item.status}>
            <i>{item.status.toUpperCase()}</i>
            <span>{item.rationale ?? item.excerpt}</span>
            {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.title || item.sourceUrl}</a>}
          </li>)}</ul>
        </div>}
        </div>
        <div className="juror-score-grid">{scorecards.map((card) => {
          const juror = JUROR_BY_ID[card.juror]
          return <article className="juror-score" key={card.juror} style={{ '--score-color': juror.accent } as CSSProperties}>
            <div className="score-card-head"><span>{juror.name}<small>{juror.role}</small></span><strong>{card.score}<i>/100</i></strong></div>
            <p>{card.summary}</p>
            <div className="criteria-list">{card.criteria.map((criterion) => <div key={criterion.label}><span>{criterion.label}</span><b>{criterion.score}/{criterion.max}</b><i><em style={{ width: `${(criterion.score / criterion.max) * 100}%` }} /></i></div>)}</div>
            <footer><b>NEXT MOVE</b>{card.action}</footer>
          </article>
        })}</div>
        <button className="sun-button" onClick={restart}>TRY ANOTHER IDEA <i>→</i></button>
      </div>
      <JurySky subdued />
    </section>}
  </main>
}

function Wordmark() { return <div className="wordmark"><span>✦</span> GENIE <b>JURY</b></div> }

function ServiceStrip({ services, connection }: { services: Record<string, string> | null; connection: ConnectionState }) {
  const items = [
    { label: 'OpenAI Realtime + Responses', ok: services?.openai === 'configured' },
    { label: 'Browserbase live browser', ok: services?.browserbase === 'configured' },
    { label: `ElevenLabs ${services?.elevenlabsModel ?? 'voices'}`, ok: services?.elevenlabs === 'configured' },
  ]
  return <div className="service-strip">{items.map((item) => <span key={item.label} className={item.ok ? 'ok' : 'off'}><i />{item.label}</span>)}<span className={connection === 'connected' ? 'ok' : 'off'}><i />{connection === 'connected' ? 'Jury API connected' : 'Jury API offline'}</span></div>
}

function JurySky({ focus = null, speaking = null, subdued = false, listening = false }: { focus?: JurorId | null; speaking?: JurorId | null; subdued?: boolean; listening?: boolean }) {
  return <div className={`jury-sky ${subdued ? 'subdued' : ''} ${listening ? 'all-listening' : ''}`} aria-label="The Genie Jury">
    {JURORS.map((juror) => <div key={juror.id} className={`sky-juror juror-${juror.id} ${focus === juror.id ? 'active' : ''} ${focus && focus !== juror.id ? 'dimmed' : ''} ${speaking === juror.id ? 'talking' : ''}`}>
      <img src={speaking === juror.id ? juror.speakingImage : juror.image} alt={`${juror.name}, ${juror.role}`} />
      <span className="juror-tag"><b>{juror.name}</b>{juror.role}</span>
    </div>)}
  </div>
}

function Cloudscape() { return <><div className="sun-glow" /><div className="cloud bank-one" /><div className="cloud bank-two" /><div className="cloud bank-three" /><div className="cloud cloud-left" /><div className="cloud cloud-right" /></> }
