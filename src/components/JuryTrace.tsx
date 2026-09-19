import type { AgentMessage, Finding, RunNode, ToolCall } from '../lib/jury-api'

/**
 * The deliberation, made visible. A compact live feed of what the agents are
 * doing to each other: assignments from the Bailiff, tool calls, messages
 * between jurors, findings posted to the shared ledger. Collapsed by default
 * so the stage stays art-led; expanded for judges who want to see the swarm.
 */
export interface TraceItem {
  id: string
  at: string
  agent: string
  kind: 'stage' | 'tool' | 'message' | 'finding' | 'handoff' | 'browser' | 'agent' | 'system'
  text: string
  detail?: string
  status?: string
}

export function traceFromNode(node: RunNode): TraceItem | null {
  if (node.kind === 'run' || node.kind === 'llm') return null
  const data = node.data ?? {}
  if (node.kind === 'tool') return { id: node.id, at: node.startedAt, agent: node.agent, kind: 'tool', text: node.label, detail: summarizeArgs(data.args), status: node.status }
  if (node.kind === 'message') return { id: node.id, at: node.startedAt, agent: node.agent, kind: 'message', text: node.label, detail: summarizeArgs({ ...data, messageId: undefined }), status: node.status }
  if (node.kind === 'handoff') return { id: node.id, at: node.startedAt, agent: node.agent, kind: 'handoff', text: node.label, status: node.status, detail: data.serviced !== undefined ? `${String(data.serviced)} request(s) serviced` : undefined }
  if (node.kind === 'stage') return { id: node.id, at: node.startedAt, agent: node.agent, kind: 'stage', text: node.label, status: node.status, detail: Array.isArray(data.assignments) ? (data.assignments as string[]).join(' · ') : undefined }
  return { id: node.id, at: node.startedAt, agent: node.agent, kind: 'agent', text: node.label, status: node.status, detail: Array.isArray(data.findings) ? (data.findings as string[]).join(' · ') : undefined }
}

export function traceFromFinding(finding: Finding): TraceItem {
  return { id: `finding-${finding.id}`, at: finding.createdAt, agent: finding.agent, kind: 'finding', text: `${finding.kind} · severity ${finding.severity}`, detail: finding.summary }
}

export function traceFromMessage(message: AgentMessage): TraceItem {
  return { id: `message-${message.id}`, at: message.createdAt, agent: message.from, kind: 'message', text: `${message.from} → ${message.to}: ${message.kind}`, detail: summarizeArgs(message.payload) }
}

export function traceFromToolCall(call: ToolCall): TraceItem {
  return { id: `tool-${call.id}`, at: '', agent: call.agent, kind: 'tool', text: `${call.agent} used ${call.tool}`, detail: summarizeArgs(call.args), status: call.ok ? 'done' : 'failed' }
}

function summarizeArgs(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined && item !== null && item !== '')
  if (!entries.length) return undefined
  return entries.map(([key, item]) => `${key}: ${typeof item === 'string' ? item : JSON.stringify(item)}`).join(' · ').slice(0, 220)
}

const ICON: Record<TraceItem['kind'], string> = { stage: '◆', tool: '⚙', message: '✉', finding: '✎', handoff: '⇄', browser: '⌘', agent: '●', system: '·' }

export function JuryTrace({ items, expanded, onToggle, jurorName, accent }: { items: TraceItem[]; expanded: boolean; onToggle: () => void; jurorName: (agent: string) => string; accent: (agent: string) => string }) {
  const counts = { tools: items.filter((item) => item.kind === 'tool').length, messages: items.filter((item) => item.kind === 'message').length, findings: items.filter((item) => item.kind === 'finding').length }
  return <aside className={`trace ${expanded ? 'expanded' : ''}`} aria-label="Jury deliberation trace">
    <button className="trace-head" onClick={onToggle} aria-expanded={expanded}>
      <span>JURY ROOM</span>
      <span className="trace-counts">{counts.tools} TOOLS · {counts.messages} MESSAGES · {counts.findings} FINDINGS</span>
      <span className="trace-toggle">{expanded ? 'HIDE' : 'OPEN'}</span>
    </button>
    {expanded && <ol className="trace-list">
      {items.length === 0 && <li className="trace-empty">The jury room is quiet. Finish your pitch to start the deliberation.</li>}
      {items.slice(-60).map((item) => <li key={item.id} className={`trace-item kind-${item.kind} status-${item.status ?? 'done'}`} style={{ '--agent-accent': accent(item.agent) } as React.CSSProperties}>
        <i aria-hidden="true">{ICON[item.kind]}</i>
        <div><b>{jurorName(item.agent)}</b><span>{item.text}</span>{item.detail && <small>{item.detail}</small>}</div>
      </li>)}
    </ol>}
  </aside>
}
