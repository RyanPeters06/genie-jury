import type { AgentId, AgentMessage, Assignment, Claim, Evidence, Finding, JurorId, LedgerSnapshot, MessageKind, RunNode, RunNodeKind, RunNodeStatus, SwarmRuntime, ToolCallRecord } from './types.ts'

const now = () => new Date().toISOString()
const uid = () => crypto.randomUUID()

/**
 * The Ledger is the jury's shared blackboard plus its run tree.
 *
 * Every agent reads from it and writes to it. Nothing an agent "knows" about
 * another agent's work arrives through prompt copy-paste; it arrives through
 * this object, which is why the deliberation is inspectable after the fact.
 */
export class Ledger {
  readonly claims: Claim[] = []
  readonly evidence: Evidence[] = []
  readonly assignments: Assignment[] = []
  readonly findings: Finding[] = []
  readonly messages: AgentMessage[] = []
  readonly toolCalls: ToolCallRecord[] = []
  readonly builderAnswers: LedgerSnapshot['builderAnswers'] = []
  readonly runTree: RunNode[] = []
  readonly pitch: string
  readonly mode: 'Hackathon' | 'Startup'
  runtime: SwarmRuntime

  constructor(pitch: string, mode: 'Hackathon' | 'Startup', runtime?: SwarmRuntime) {
    this.pitch = pitch
    this.mode = mode
    this.runtime = runtime ?? { emit: () => undefined }
  }

  private emit(type: string, data: Record<string, unknown>) {
    this.runtime.emit({ type, at: new Date().toISOString(), data })
  }

  static fromSnapshot(snapshot: LedgerSnapshot, runTree: RunNode[] = [], runtime?: SwarmRuntime) {
    const ledger = new Ledger(snapshot.pitch, snapshot.mode, runtime)
    ledger.claims.push(...snapshot.claims)
    ledger.evidence.push(...snapshot.evidence)
    ledger.assignments.push(...snapshot.assignments)
    ledger.findings.push(...snapshot.findings)
    ledger.messages.push(...snapshot.messages)
    ledger.toolCalls.push(...snapshot.toolCalls)
    ledger.builderAnswers.push(...snapshot.builderAnswers)
    ledger.runTree.push(...runTree)
    // A rehydrated ledger must remember that the guaranteed deep read was
    // already spent, or every builder answer buys another one.
    ledger.deepReadDone = snapshot.evidence.some((item) => Boolean(item.interaction))
    return ledger
  }

  /**
   * One guaranteed interactive read per deliberation. Synchronous test-and-set,
   * so two agents racing for the budget cannot both win it.
   */
  private deepReadDone = false
  claimDeepRead(): boolean {
    if (this.deepReadDone) return false
    this.deepReadDone = true
    return true
  }

  // ---- blackboard writes -------------------------------------------------

  addClaims(claims: Array<Omit<Claim, 'id'> & { id?: string }>) {
    const added = claims.map((claim) => ({ ...claim, id: claim.id ?? uid() }))
    this.claims.push(...added)
    return added
  }

  addEvidence(evidence: Evidence) {
    this.evidence.push(evidence)
    const claim = evidence.claimId ? this.claims.find((item) => item.id === evidence.claimId) : undefined
    // Only an adjudicated item may move a claim. Without this, a later
    // observation of the same claim silently downgrades a verified verdict, and
    // the jury then says "unproven" on stage about something it already proved.
    if (claim && evidence.judged) claim.evidenceStatus = evidence.status
    this.emit('ledger.evidence', { evidence: { ...evidence, screenshotDataUrl: undefined }, hasScreenshot: Boolean(evidence.screenshotDataUrl) })
    return evidence
  }

  assign(assignments: Assignment[]) {
    this.assignments.push(...assignments)
  }

  postFinding(agent: AgentId, finding: Omit<Finding, 'id' | 'agent' | 'createdAt'>): Finding {
    const record: Finding = { ...finding, id: uid(), agent, createdAt: now() }
    this.findings.push(record)
    this.emit('ledger.finding', { finding: record })
    return record
  }

  recordBuilderAnswer(toJuror: JurorId, transcript: string) {
    this.builderAnswers.push({ toJuror, transcript, createdAt: now() })
  }

  // ---- message bus --------------------------------------------------------

  send(from: AgentId, to: AgentId | 'all', kind: MessageKind, payload: Record<string, unknown>, parent?: RunNode): AgentMessage {
    const message: AgentMessage = { id: uid(), from, to, kind, payload, createdAt: now(), consumedBy: [] }
    this.messages.push(message)
    this.node('message', from, `${from} → ${to}: ${kind}`, { messageId: message.id, ...payload }, 'done', parent ?? this.agentSpans.get(from) ?? null)
    return message
  }

  /** Messages addressed to `agent` (or broadcast) that it has not yet consumed. */
  inbox(agent: AgentId, kind?: MessageKind) {
    return this.messages.filter((message) => (message.to === agent || message.to === 'all') && message.from !== agent && (!kind || message.kind === kind) && !message.consumedBy?.includes(agent))
  }

  consume(agent: AgentId, messages: AgentMessage[]) {
    for (const message of messages) message.consumedBy = [...(message.consumedBy ?? []), agent]
  }

  // ---- reads used by prompts ---------------------------------------------

  findingsBy(agent: AgentId) { return this.findings.filter((finding) => finding.agent === agent) }
  findingsExcept(agent: AgentId) { return this.findings.filter((finding) => finding.agent !== agent) }
  assignmentFor(juror: JurorId) { return this.assignments.find((assignment) => assignment.juror === juror) }
  claimsFor(juror: JurorId) {
    const ids = new Set(this.assignmentFor(juror)?.claimIds ?? [])
    return this.claims.filter((claim) => ids.has(claim.id))
  }
  highestRiskClaim() { return [...this.claims].sort((a, b) => b.importance - a.importance)[0] }

  // ---- run tree -----------------------------------------------------------

  /**
   * Agents run concurrently, so an implicit "current span" stack would interleave
   * and mis-parent the tree. Spans inherit from `defaultParent` unless the caller
   * passes a parent explicitly, which is what the parallel stages do.
   */
  private defaultParent: string | null = null

  node(kind: RunNodeKind, agent: AgentId | 'system', label: string, data?: Record<string, unknown>, status: RunNodeStatus = 'running', parent?: RunNode | null): RunNode {
    const parentId = parent === undefined ? this.defaultParent : parent?.id ?? null
    const node: RunNode = { id: uid(), parentId, kind, agent, label, status, startedAt: now(), data }
    if (status !== 'running') node.endedAt = node.startedAt
    this.runTree.push(node)
    this.emit('ledger.node', { node })
    return node
  }

  finish(node: RunNode, status: RunNodeStatus = 'done', data?: Record<string, unknown>) {
    node.status = status
    node.endedAt = now()
    if (data) node.data = { ...(node.data ?? {}), ...data }
    this.emit('ledger.node', { node })
  }

  /** Run `work` as a child span of the run tree. Failures are recorded, then rethrown. */
  async span<T>(kind: RunNodeKind, agent: AgentId | 'system', label: string, work: (node: RunNode) => Promise<T>, options: { data?: Record<string, unknown>; parent?: RunNode | null } = {}): Promise<T> {
    const node = this.node(kind, agent, label, options.data, 'running', options.parent)
    try {
      const result = await work(node)
      this.finish(node)
      return result
    } catch (error) {
      this.finish(node, 'failed', { error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  /** Everything opened without an explicit parent hangs under this node. */
  setDefaultParent(node: RunNode | null) { this.defaultParent = node?.id ?? null }

  /** Tool calls and messages attach to the agent span that is currently running for that agent. */
  private agentSpans = new Map<AgentId, RunNode>()

  trackAgentSpan(agent: AgentId, node: RunNode | null) {
    if (node) this.agentSpans.set(agent, node)
    else this.agentSpans.delete(agent)
  }

  recordTool(record: Omit<ToolCallRecord, 'id'>) {
    const full = { ...record, id: uid() }
    this.toolCalls.push(full)
    this.node('tool', record.agent, `${record.agent} used ${record.tool}`, { args: record.args, ok: record.ok, durationMs: record.durationMs, result: summarize(record.result) }, record.ok ? 'done' : 'failed', this.agentSpans.get(record.agent) ?? null)
    return full
  }

  snapshot(): LedgerSnapshot {
    return {
      pitch: this.pitch, mode: this.mode,
      claims: [...this.claims], evidence: [...this.evidence], assignments: [...this.assignments],
      findings: [...this.findings], messages: [...this.messages], toolCalls: [...this.toolCalls], builderAnswers: [...this.builderAnswers],
    }
  }
}

function summarize(value: unknown) {
  const text = JSON.stringify(value)
  return text && text.length > 600 ? `${text.slice(0, 600)}…` : value
}
