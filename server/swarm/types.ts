/**
 * Genie Jury swarm — shared types.
 *
 * Vocabulary intentionally mirrors openJiuwen / JiuwenSwarm so the design reads
 * as a familiar multi-agent system to the judges:
 *   Leader      → the Bailiff, decomposes the pitch into juror assignments
 *   Stage agent → a juror (Ember, Gale, Tide, Volt) with its own tools
 *   Handoff     → the Bailiff moves the team between stages; Volt receives all findings
 *   Message bus → typed messages between agents (research requests, findings, answers)
 *   Run tree    → an inspectable trace of every stage, tool call, and message
 */

export type JurorId = 'ember' | 'gale' | 'tide' | 'volt'
export type AgentId = JurorId | 'bailiff' | 'ally' | 'builder'

export type EvidenceStatus = 'verified' | 'contested' | 'unproven'
export type ClaimType = 'market' | 'competition' | 'feasibility' | 'user' | 'business'

export interface Claim {
  id: string
  claim: string
  type: ClaimType
  importance: number
  confidence: number
  researchQuery: string
  evidenceStatus: EvidenceStatus
}

export interface SourceHit { title: string; url: string; snippet: string }

/** What an agent did to a page when the answer sat behind a click. */
export interface PageInteraction {
  instruction: string
  acted: string
  extracted?: string
  quotes?: string[]
}

export interface Evidence {
  claimId?: string
  query?: string
  status: EvidenceStatus
  sourceUrl?: string
  title?: string
  excerpt?: string
  rationale?: string
  sources?: SourceHit[]
  screenshotDataUrl?: string
  capturedAt: string
  screenshotCaptured: boolean
  requestedBy?: AgentId
  /** How the page was read. A fetched page has no screenshot and no live view. */
  via?: 'live' | 'fetch' | 'search'
  /**
   * True only when a model adjudicated this against a claim. Reading a page is
   * an observation, not a judgement, and only a judged item may move a claim's
   * status.
   */
  judged?: boolean
  interaction?: PageInteraction
}

/** One juror's assignment from the Bailiff: the angle it owns for this pitch. */
export interface Assignment {
  juror: JurorId
  question: string
  claimIds: string[]
  reason: string
}

/** A structured finding a juror posts to the shared ledger. */
export interface Finding {
  id: string
  agent: AgentId
  kind: 'risk' | 'strength' | 'question' | 'evidence' | 'scope-cut' | 'user-test'
  summary: string
  claimId?: string
  severity: 1 | 2 | 3
  createdAt: string
}

export type MessageKind = 'research.request' | 'research.result' | 'finding.shared' | 'builder.answer' | 'handoff' | 'vote.request'

export interface AgentMessage {
  id: string
  from: AgentId
  to: AgentId | 'all'
  kind: MessageKind
  payload: Record<string, unknown>
  createdAt: string
  consumedBy?: AgentId[]
}

export interface ToolCallRecord {
  id: string
  agent: AgentId
  tool: string
  args: Record<string, unknown>
  result: unknown
  ok: boolean
  durationMs: number
}

export type RunNodeKind = 'run' | 'stage' | 'agent' | 'llm' | 'tool' | 'message' | 'handoff'
export type RunNodeStatus = 'running' | 'done' | 'failed' | 'skipped'

export interface RunNode {
  id: string
  parentId: string | null
  kind: RunNodeKind
  agent: AgentId | 'system'
  label: string
  status: RunNodeStatus
  startedAt: string
  endedAt?: string
  data?: Record<string, unknown>
}

export interface JurorTurn {
  juror: JurorId
  line: string
  cue: string
  basedOn: { findingIds: string[]; evidenceIds: string[]; messagesFrom: AgentId[] }
}

export type Vote = 'BUILD' | 'PIVOT' | 'PROVE' | 'ROASTED'

export interface Verdict {
  headline: string
  summary: string
  smallestNextBuild: string
  scopeCut: string
  evidenceQuestion: string
  userTest: string
  votes: Record<JurorId, { vote: Vote; because: string }>
}

export interface LedgerSnapshot {
  pitch: string
  mode: 'Hackathon' | 'Startup'
  claims: Claim[]
  evidence: Evidence[]
  assignments: Assignment[]
  findings: Finding[]
  messages: AgentMessage[]
  toolCalls: ToolCallRecord[]
  builderAnswers: Array<{ toJuror: JurorId; transcript: string; createdAt: string }>
}

export interface DeliberationResult {
  runId: string
  mode: 'live' | 'deterministic'
  ledger: LedgerSnapshot
  runTree: RunNode[]
  turns: JurorTurn[]
  verdict: Verdict
  startedAt: string
  endedAt: string
}

export interface SwarmEnv {
  OPENAI_API_KEY?: string
  OPENAI_MODEL?: string
  OPENAI_FAST_MODEL?: string
  BROWSERBASE_API_KEY?: string
  BROWSERBASE_PROJECT_ID?: string
}

export interface SwarmEvent { type: string; at: string; data: Record<string, unknown> }

/** Minimal surface of the live browser the tools need; implemented by server/browserbase.ts. */
export interface WebBrowser {
  readonly active: boolean
  readonly liveViewUrl: string | null
  /**
   * `act` and `extract` only work under Stagehand. Read this AFTER `open()`
   * resolves; before that it is always 'closed'.
   */
  readonly mode: 'stagehand' | 'playwright' | 'closed'
  open(): Promise<unknown>
  capture(url: string, options?: { screenshot?: boolean }): Promise<{ url: string; finalUrl: string; title: string; excerpt: string; screenshotDataUrl?: string; capturedAt: string }>
  /** `budgetMs` must reach the browser's own queue, or an abandoned call keeps the lock. */
  act(instruction: string, budgetMs?: number): Promise<{ ok: boolean; message: string }>
  extract(instruction: string, budgetMs?: number): Promise<{ answer: string; quotes: string[] } | null>
  close(): Promise<void>
}

export interface SwarmRuntime {
  emit: (event: SwarmEvent) => void
  search?: (query: string, agent: AgentId, numResults?: number) => Promise<SourceHit[]>
  browser?: (agent: AgentId) => WebBrowser
  /**
   * Read a page without a browser session. Jurors who do not need the live view
   * use this so they stop queueing behind the one agent that does.
   */
  fetchPage?: (url: string, agent: AgentId) => Promise<{ finalUrl: string; title: string; text: string } | null>
}
