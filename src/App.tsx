import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type Stage = 'welcome' | 'pitch' | 'jury' | 'verdict'
type Juror = { name: string; title: string; color: string; initial: string; verdict: 'BUILD' | 'PIVOT' | 'PROVE' | 'ROASTED'; quote: string; evidence?: string; source?: string }

const jurors: Juror[] = [
  { name: 'Ember', title: 'The Builder', color: 'ember', initial: 'E', verdict: 'PIVOT', quote: 'The moment is strong. The scope is not. Pick one magical interaction and make it impossible to ignore.' },
  { name: 'Gale', title: 'The Skeptic', color: 'gale', initial: 'G', verdict: 'PROVE', quote: 'You made a claim that deserves a receipt. I found close alternatives, but not your exact wedge.', evidence: '3 adjacent pitch-practice products found', source: 'Research dossier' },
  { name: 'Tide', title: 'The User', color: 'tide', initial: 'T', verdict: 'BUILD', quote: 'I would use this before a demo when I need someone to tell me the truth without wasting an hour.' },
  { name: 'Volt', title: 'The Jester', color: 'volt', initial: 'V', verdict: 'ROASTED', quote: 'If your pitch contains “AI-powered” before it contains a human being with a problem, I am throwing the lamp.' },
]
const defaultPitch = 'Genie Jury is a live, evidence-backed pitch arena for hackathon builders. You pitch an idea to four AI genies who challenge weak assumptions, research competitors, and help you leave with a sharper version.'

function App() {
  const [stage, setStage] = useState<Stage>('welcome')
  const [mode, setMode] = useState<'Hackathon' | 'Startup'>('Hackathon')
  const [pitch, setPitch] = useState(defaultPitch)
  const [activeJuror, setActiveJuror] = useState(0)
  const [revealed, setRevealed] = useState<number[]>([])
  const ideaName = useMemo(() => pitch.match(/^\s*([A-Z][\w\s'-]{2,36}?)(?:\s+is|\s+helps|\s+lets|:)/)?.[1]?.trim() || 'Your idea', [pitch])
  const enterJury = (event: FormEvent) => { event.preventDefault(); setStage('jury'); setActiveJuror(0); setRevealed([]) }
  const advance = () => { setRevealed((current) => [...new Set([...current, activeJuror])]); if (activeJuror === jurors.length - 1) { window.setTimeout(() => setStage('verdict'), 380); return }; setActiveJuror((current) => current + 1) }

  return <main className={`app stage-${stage}`}>
    <div className="stars" aria-hidden="true" />
    <nav className="topbar"><button className="brand" onClick={() => setStage('welcome')} aria-label="Return home"><span className="brand-orb">✦</span><span>GENIE <b>JURY</b></span></button><div className="topbar-right"><span className="status-dot" /> LIVE IDEA ARENA</div></nav>
    {stage === 'welcome' && <section className="welcome page-shell">
      <div className="eyebrow">THE HONEST TEAMMATE YOU NEEDED</div><h1>Pitch your idea.<br /><em>Face the jury.</em></h1><p className="lede">Four genies interrogate your assumptions, bring web receipts, and help rebuild what survives.</p><button className="primary" onClick={() => setStage('pitch')}>ENTER THE ARENA <span>→</span></button>
      <div className="jury-lineup" aria-label="The Genie Jury">{jurors.map((juror, index) => <Genie key={juror.name} juror={juror} index={index} compact />)}</div>
      <div className="how-it-works"><span><b>01</b> Pitch</span><i /><span><b>02</b> Get challenged</span><i /><span><b>03</b> Leave sharper</span></div>
    </section>}
    {stage === 'pitch' && <section className="pitch-page page-shell">
      <div className="step-label">01 / YOUR CASE</div><h2>What idea are you<br />asking us to believe in?</h2><div className="mode-switch" role="group" aria-label="Pitch mode">{(['Hackathon', 'Startup'] as const).map((item) => <button className={mode === item ? 'selected' : ''} onClick={() => setMode(item)} key={item}>{item} mode</button>)}</div>
      <form onSubmit={enterJury}><textarea value={pitch} onChange={(e) => setPitch(e.target.value)} maxLength={1000} placeholder="Tell the jury what you want to build..." /><div className="form-footer"><span>{pitch.length}/1000 · Speak plainly. We will find the gaps.</span><button className="primary" type="submit">SUMMON THE JURY <span>→</span></button></div></form><p className="privacy-note">✦ Your pitch stays in this session. Evidence is marked verified, contested, or unproven.</p>
    </section>}
    {stage === 'jury' && <section className="jury-page page-shell">
      <div className="jury-head"><div><div className="step-label">02 / DELIBERATION</div><h2>{ideaName}</h2><p>{mode} mode · Evidence-backed review</p></div><div className="progress">{activeJuror + 1}<span>/4</span></div></div>
      <div className="arena"><div className="idea-core"><span>YOUR<br />IDEA</span></div>{jurors.map((juror, index) => <button key={juror.name} className={`juror-position p${index} ${activeJuror === index ? 'active' : ''} ${revealed.includes(index) ? 'heard' : ''}`} onClick={() => setActiveJuror(index)}><Genie juror={juror} index={index} /></button>)}<div className="orbit orbit-one" /><div className="orbit orbit-two" /></div>
      <article className={`challenge-card ${jurors[activeJuror].color}`}><div className="challenge-top"><span className="challenge-role">{jurors[activeJuror].title.toUpperCase()}</span><span className="listening"><i /> LISTENING</span></div><h3>“{jurors[activeJuror].quote}”</h3>{jurors[activeJuror].evidence && <div className="evidence"><span className="verified">VERIFIED</span><b>{jurors[activeJuror].evidence}</b><button>{jurors[activeJuror].source} ↗</button></div>}<button className="response" onClick={advance}>{activeJuror === 3 ? 'HEAR THE VERDICT' : 'I HEAR YOU — NEXT JUROR'} <span>→</span></button></article>
    </section>}
    {stage === 'verdict' && <section className="verdict-page page-shell">
      <div className="step-label">03 / THE VERDICT</div><div className="verdict-heading"><div><h2>This idea has<br /><em>a pulse.</em></h2><p>The Jury did not approve it. They found a version worth building.</p></div><div className="verdict-seal">3<span>/4</span><small>JURORS SEE<br />A REAL WEDGE</small></div></div>
      <div className="verdict-grid"><article className="salvage-card"><div className="ally-icon">✦</div><div><span className="card-label">THE ALLY'S SALVAGE PLAN</span><h3>Build the pressure, not the platform.</h3><p>Make the first experience a 90-second, evidence-backed interrogation for hackathon ideas. One unforgettable challenge beats an unfinished simulator.</p></div></article><article className="finding-card"><span className="card-label">MOST DANGEROUS ASSUMPTION</span><h3>“Nobody already does this.”</h3><p><b>Contested.</b> Similar pitch coaches exist. Your differentiator is a live jury that brings receipts and judges hackathon feasibility.</p></article><article className="finding-card"><span className="card-label">THE MOMENT TO DEMO</span><h3>The Skeptic interrupts.</h3><p>“You claim there are no competitors. I found three. Here is the gap none of them cover.”</p></article></div>
      <div className="juror-votes">{jurors.map((juror) => <div key={juror.name}><span className={`mini-orb ${juror.color}`}>{juror.initial}</span><span>{juror.name}</span><b>{juror.verdict}</b></div>)}</div><div className="verdict-actions"><button className="secondary" onClick={() => setStage('pitch')}>RETRY THE PITCH</button><button className="primary" onClick={() => setStage('welcome')}>START A NEW CASE <span>→</span></button></div>
    </section>}
  </main>
}

function Genie({ juror, compact = false }: { juror: Juror; index: number; compact?: boolean }) { return <div className={`genie ${juror.color} ${compact ? 'compact' : ''}`}><div className="genie-aura" /><div className="genie-trail" /><div className="genie-cloud" aria-hidden="true"><i /><i /><i /><i /></div><div className="genie-body"><div className="genie-crown"><i /><i /><i /></div><div className="genie-head"><span className="brow left" /><span className="brow right" /><span className="eye left" /><span className="eye right" /><span className="mouth" /></div><div className="genie-arms"><span /><span /></div><div className="genie-chest">{juror.initial}</div></div><div className="genie-caption"><b>{juror.name}</b><span>{juror.title}</span></div></div> }
export default App
