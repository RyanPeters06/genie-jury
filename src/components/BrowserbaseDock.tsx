import type { Evidence } from '../lib/jury-api'

/**
 * Gale's browser, on stage. Shows the live Browserbase session while a juror is
 * on the web, then the receipts: screenshot, source, and the evidence verdict.
 * The panel is explicit about the provider on purpose; the audience should
 * never wonder whether the research is real.
 */
export interface BrowserActivity {
  liveViewUrl: string | null
  sessionId: string | null
  agent: string | null
  status: 'idle' | 'searching' | 'browsing' | 'acting' | 'done' | 'error'
  currentUrl: string | null
  lastQuery: string | null
  lastAction: string | null
  hits: Array<{ title: string; url: string }>
  screenshots: Array<{ url: string; title: string; dataUrl: string }>
}

export const idleBrowserActivity: BrowserActivity = { liveViewUrl: null, sessionId: null, agent: null, status: 'idle', currentUrl: null, lastQuery: null, lastAction: null, hits: [], screenshots: [] }

const STATUS_LABEL: Record<BrowserActivity['status'], string> = { idle: 'STANDING BY', searching: 'SEARCHING THE WEB', browsing: 'OPENING THE SOURCE', acting: 'CLICKING THROUGH THE PAGE', done: 'RECEIPTS CAPTURED', error: 'SOURCE UNREACHABLE' }

export function BrowserbaseDock({ activity, evidence, expanded, onToggle, jurorName }: { activity: BrowserActivity; evidence: Evidence[]; expanded: boolean; onToggle: () => void; jurorName: (agent: string | null | undefined) => string }) {
  const latest = evidence[evidence.length - 1]
  const shot = activity.screenshots[activity.screenshots.length - 1]
  const live = activity.liveViewUrl && activity.status !== 'done' && activity.status !== 'idle'
  const host = (url: string | null | undefined) => { try { return url ? new URL(url).hostname.replace(/^www\./, '') : '' } catch { return url ?? '' } }
  return <aside className={`bb-dock ${expanded ? 'expanded' : ''} status-${activity.status}`} aria-label="Live research browser">
    <button className="bb-head" onClick={onToggle} aria-expanded={expanded}>
      <span className="bb-badge"><i className={`bb-dot ${live ? 'live' : ''}`} />BROWSERBASE</span>
      <span className="bb-status">{activity.agent ? `${jurorName(activity.agent).toUpperCase()} · ` : ''}{STATUS_LABEL[activity.status]}</span>
      <span className="bb-toggle">{expanded ? 'HIDE' : 'WATCH'}</span>
    </button>
    {expanded && <div className="bb-body">
      <div className="bb-frame">
        {live && activity.liveViewUrl ? <iframe src={activity.liveViewUrl} title="Browserbase live session" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" allow="clipboard-read; clipboard-write" />
          : shot ? <img src={shot.dataUrl} alt={`Screenshot of ${shot.title}`} />
          : <div className="bb-empty"><b>Live cloud browser</b><span>When a juror needs proof, a real browser opens here. The jury never invents a source.</span></div>}
        {activity.currentUrl && <span className="bb-url">{host(activity.currentUrl)}</span>}
      </div>
      <div className="bb-meta">
        {activity.lastQuery && <p><b>SEARCH</b>{activity.lastQuery}</p>}
        {activity.hits.length > 0 && <ul className="bb-hits">{activity.hits.slice(0, 3).map((hit) => <li key={hit.url}><a href={hit.url} target="_blank" rel="noreferrer">{hit.title || host(hit.url)}</a><small>{host(hit.url)}</small></li>)}</ul>}
        {activity.lastAction && <p><b>ACTION</b>{activity.lastAction}</p>}
        {latest && <div className={`bb-verdict ${latest.status}`}><b>{latest.status.toUpperCase()}</b>{latest.via && <i className="bb-provenance">{latest.via === 'live' ? 'LIVE' : latest.via === 'fetch' ? 'FETCHED' : 'SEARCH'}</i>}<span>{latest.rationale ?? latest.excerpt ?? 'No rationale recorded.'}</span>{latest.sourceUrl && <a href={latest.sourceUrl} target="_blank" rel="noreferrer">{latest.title || host(latest.sourceUrl)}</a>}</div>}
      </div>
    </div>}
  </aside>
}
