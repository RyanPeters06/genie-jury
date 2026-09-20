import type { Ledger } from './ledger.ts'
import { structured } from './llm.ts'
import type { ToolSpec } from './llm.ts'
import type { AgentId, Evidence, EvidenceStatus, JurorId, PageInteraction, SourceHit, SwarmEnv, SwarmRuntime } from './types.ts'

/**
 * Tools the jurors can actually call. Each tool is a real side effect on the
 * shared ledger, the message bus, or the web through Browserbase. The LLM sees
 * the `spec`; the orchestrator runs `run`. Every invocation is recorded in the
 * run tree so the demo can show *who* used *what* and *why*.
 *
 *   read_ledger       everyone   read claims, evidence, other jurors' findings
 *   message_juror     everyone   hand an angle to the juror who owns it
 *   search_web        Ember/Tide/Gale  Browserbase Search: real results, no browser needed
 *   research_claim    Gale       Search → open the top source in a live cloud browser → screenshot → judge
 *   act_on_page       Gale       Stagehand: natural-language action on the open page (dismiss, click, scroll)
 *   browse_site       Ember/Tide read one URL, via the Fetch API, falling back to the live browser
 *   request_research  Ember/Tide/Volt  file a research request for Gale
 */
export interface Tool {
  spec: ToolSpec
  run: (args: Record<string, unknown>) => Promise<unknown>
}

const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)

export function unprovenEvidence(extra: Partial<Evidence> = {}): Evidence {
  return { status: 'unproven', capturedAt: new Date().toISOString(), screenshotCaptured: false, ...extra }
}

function timed<T>(ledger: Ledger, agent: AgentId, tool: string, args: Record<string, unknown>, work: () => Promise<T>): Promise<T> {
  const started = Date.now()
  return work().then((result) => {
    ledger.recordTool({ agent, tool, args, result: stripScreenshots(result), ok: true, durationMs: Date.now() - started })
    return result
  }, (error: unknown) => {
    ledger.recordTool({ agent, tool, args, result: { error: error instanceof Error ? error.message : String(error) }, ok: false, durationMs: Date.now() - started })
    throw error
  })
}

function stripScreenshots(value: unknown): unknown {
  if (value && typeof value === 'object' && 'screenshotDataUrl' in (value as Record<string, unknown>)) return { ...(value as Record<string, unknown>), screenshotDataUrl: undefined }
  return value
}

/** Budgets for the guaranteed interactive read. These reach the browser's own
 * queue, so an abandoned call releases the lock instead of holding it. */
const ACT_BUDGET_MS = 9000
const EXTRACT_BUDGET_MS = 9000
/** Below this, a fetched page is treated as empty and the live browser takes over. */
const MIN_FETCH_CHARS = 400

/**
 * Read one page.
 *
 * Ember and Tide go through the Browserbase Fetch API so they do not queue
 * behind Gale on the single live browser; a thin or empty result, which is what
 * a JavaScript-heavy page returns, falls back to a live capture so quality never
 * regresses. Gale always passes `preferLive`, because the session on stage is
 * Gale's and the audience should see it working.
 */
export async function readPage(
  runtime: SwarmRuntime,
  agent: JurorId,
  url: string,
  options: { preferLive?: boolean } = {},
): Promise<{ finalUrl: string; title: string; excerpt: string; screenshotDataUrl?: string; capturedAt: string; via: 'fetch' | 'live' } | null> {
  if (!options.preferLive && runtime.fetchPage) {
    const fetched = await runtime.fetchPage(url, agent)
    if (fetched && fetched.text.trim().length >= MIN_FETCH_CHARS) {
      return { finalUrl: fetched.finalUrl, title: fetched.title, excerpt: fetched.text, capturedAt: new Date().toISOString(), via: 'fetch' }
    }
  }
  const browser = runtime.browser?.(agent)
  if (!browser) return null
  try {
    await browser.open()
    const capture = await browser.capture(url, { screenshot: true })
    // A navigation that failed still resolves, landing on an error page with no
    // text. Recording that as evidence puts a chrome-error:// URL in the
    // receipts the builder is shown, so treat it as an unread page.
    if (!isReadable(capture.finalUrl, capture.excerpt)) return null
    return { finalUrl: capture.finalUrl, title: capture.title, excerpt: capture.excerpt, screenshotDataUrl: capture.screenshotDataUrl, capturedAt: capture.capturedAt, via: 'live' }
  } catch { return null }
}

/** A page the browser could not actually load is not a source. */
function isReadable(finalUrl: string, text: string) {
  if (/^(chrome-error|about:blank|data:)/i.test(finalUrl)) return false
  return text.trim().length >= 120
}

/**
 * The evidence clerk. The only place a claim earns a status, so that everything
 * else in the system can treat an unjudged item as an observation.
 */
async function judgeEvidence(env: SwarmEnv, input: { claim: string; query: string; sources: SourceHit[]; pageText: string; pageUrl?: string; extraction?: string }) {
  return structured<{ status: EvidenceStatus; rationale: string; quote: string }>(env, {
    instructions: 'You are an evidence clerk. Given a claim, search results, and the text of the top source, decide: verified (the source clearly supports the claim), contested (credible sources disagree or the source partly contradicts it), or unproven (nothing here settles it). Never assume; only use the supplied text. An interactive read is a targeted answer taken from the page after dismissing overlays; treat it as more page text, not as a conclusion. "quote" is a short verbatim excerpt from the source text (max 200 chars) or empty. "rationale" is one sentence.',
    input: `Claim: ${input.claim}
Query: ${input.query}

Search results:
${input.sources.map((hit, index) => `${index + 1}. ${hit.title} — ${hit.url} | ${hit.snippet}`).join('\n') || '(none)'}

Top source (${input.pageUrl ?? 'not opened'}):
${input.pageText.slice(0, 2400) || '(no page text)'}
${input.extraction ? `\nInteractive read of that page:\n${input.extraction.slice(0, 800)}` : ''}`,
    schema: { name: 'evidence_judgement', schema: { type: 'object', properties: { status: { type: 'string', enum: ['verified', 'contested', 'unproven'] }, rationale: { type: 'string' }, quote: { type: 'string' } }, required: ['status', 'rationale', 'quote'], additionalProperties: false } },
  })
}

/**
 * Gale's full research routine: search for real sources, open the best one in
 * the live browser, screenshot it, and judge the claim against what the page
 * actually says. The judge may only answer verified / contested / unproven.
 *
 * Once per deliberation this also takes an interactive pass over the page,
 * dismissing overlays and reading a targeted answer, so the audience reliably
 * sees the browser being operated rather than merely loaded, and so an answer
 * hidden behind a click still reaches the verdict.
 *
 * `requestedBy` is whoever asked; Gale is always the one driving, because the
 * live view on stage belongs to Gale.
 */
export async function researchClaim(input: { query: string; claim?: string; claimId?: string; requestedBy: AgentId }, ledger: Ledger, env: SwarmEnv): Promise<Evidence> {
  const { runtime } = ledger
  const claim = input.claim ?? input.query
  const sources = runtime.search ? await runtime.search(input.query, 'gale', 5) : []
  const browser = runtime.browser?.('gale')
  let capture: Awaited<ReturnType<NonNullable<typeof browser>['capture']>> | null = null
  let interaction: PageInteraction | undefined

  if (browser && sources[0]) {
    try {
      await browser.open()
      capture = await browser.capture(sources[0].url)
    } catch { capture = null }

    // `mode` is only meaningful after open() resolves; reading it earlier always
    // says 'closed' and this pass would silently never run.
    if (capture && browser.mode === 'stagehand' && ledger.claimDeepRead()) {
      const instruction = `Dismiss any cookie banner, modal, or popup, then scroll to the part of the page about: ${claim}`
      const acted = await browser.act(instruction, ACT_BUDGET_MS)
      const read = await browser.extract(`Whether this page supports or contradicts: ${claim}`, EXTRACT_BUDGET_MS)
      if (acted.ok || read) interaction = { instruction, acted: acted.message, extracted: read?.answer, quotes: read?.quotes }
    }
  }

  if (!sources.length && !capture) {
    return unprovenEvidence({ query: input.query, claimId: input.claimId, requestedBy: input.requestedBy, rationale: 'No live source could be reached.' })
  }

  const judged = await judgeEvidence(env, { claim, query: input.query, sources, pageText: capture?.excerpt ?? '', pageUrl: capture?.finalUrl, extraction: interaction?.extracted })

  return {
    // A page that was opened but not adjudicated is unproven, never contested:
    // "contested" asserts that credible sources disagree, which nobody observed.
    status: judged?.status ?? 'unproven',
    judged: Boolean(judged),
    query: input.query, claimId: input.claimId, requestedBy: input.requestedBy,
    sourceUrl: capture?.finalUrl ?? sources[0]?.url, title: capture?.title ?? sources[0]?.title,
    excerpt: judged?.quote || capture?.excerpt.slice(0, 280) || sources[0]?.snippet,
    rationale: judged?.rationale ?? (capture ? 'A source was opened but no judgement was available.' : 'Search results only; the source was not opened.'),
    sources: sources.slice(0, 3), screenshotDataUrl: capture?.screenshotDataUrl,
    via: capture ? 'live' : 'search',
    interaction,
    capturedAt: capture?.capturedAt ?? new Date().toISOString(), screenshotCaptured: Boolean(capture?.screenshotDataUrl),
  }
}

export function toolsFor(agent: JurorId, ledger: Ledger, env: SwarmEnv): Tool[] {
  const { runtime } = ledger

  const readLedger: Tool = {
    spec: {
      name: 'read_ledger',
      description: 'Read the shared jury ledger: extracted claims, evidence gathered so far, findings other jurors have posted, and answers the builder has given.',
      parameters: { type: 'object', properties: { section: { type: 'string', enum: ['claims', 'evidence', 'findings', 'builder_answers', 'all'] } }, required: ['section'], additionalProperties: false },
    },
    run: (args) => timed(ledger, agent, 'read_ledger', args, async () => {
      const section = str(args.section, 'all')
      const view = {
        claims: ledger.claims.map(({ id, claim, type, importance, evidenceStatus }) => ({ id, claim, type, importance, evidenceStatus })),
        evidence: ledger.evidence.map(({ claimId, query, status, title, sourceUrl, excerpt, rationale }) => ({ claimId, query, status, title, sourceUrl, excerpt, rationale })),
        findings: ledger.findingsExcept(agent).map(({ id, agent: by, kind, summary, severity, claimId }) => ({ id, by, kind, summary, severity, claimId })),
        builder_answers: ledger.builderAnswers,
      }
      return section === 'all' ? view : { [section]: view[section as keyof typeof view] }
    }),
  }

  const messageJuror: Tool = {
    spec: {
      name: 'message_juror',
      description: 'Send a short note to another juror so they can build on it in their turn. Use it to hand off an angle you noticed but do not own.',
      parameters: { type: 'object', properties: { to: { type: 'string', enum: ['ember', 'gale', 'tide', 'volt'] }, note: { type: 'string' } }, required: ['to', 'note'], additionalProperties: false },
    },
    run: (args) => timed(ledger, agent, 'message_juror', args, async () => {
      const to = str(args.to) as JurorId
      if (to === agent || !['ember', 'gale', 'tide', 'volt'].includes(to)) return { error: 'Choose a different juror.' }
      const message = ledger.send(agent, to, 'finding.shared', { note: str(args.note).slice(0, 300) })
      return { delivered: true, messageId: message.id }
    }),
  }

  const searchWeb: Tool = {
    spec: {
      name: 'search_web',
      description: 'Search the live web through Browserbase and get real titles, URLs, and snippets. Good for: existing products or libraries (Ember), what real users complain about on forums and app stores (Tide), or a quick check before filing a research request.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
    },
    run: (args) => timed(ledger, agent, 'search_web', args, async () => {
      const query = str(args.query).trim()
      if (!query) return { error: 'A query is required.' }
      const hits: SourceHit[] = runtime.search ? await runtime.search(query, agent, 5) : []
      return { query, results: hits.map((hit) => ({ title: hit.title, url: hit.url, snippet: hit.snippet })) }
    }),
  }

  if (agent === 'gale') {
    const research: Tool = {
      spec: {
        name: 'research_claim',
        description: 'Full receipts: search the web through Browserbase, open the best source in a live cloud browser (the audience can watch), screenshot it, and judge the claim as verified, contested, or unproven. Call this for your highest-importance claim. Never assume a result.',
        parameters: { type: 'object', properties: { claimId: { type: 'string', description: 'Ledger claim id, or empty string for an ad-hoc query.' }, query: { type: 'string', description: 'A query a journalist would type.' } }, required: ['claimId', 'query'], additionalProperties: false },
      },
      run: (args) => timed(ledger, agent, 'research_claim', args, async () => {
        const query = str(args.query).trim()
        if (!query) return { error: 'A query is required.' }
        const claimId = str(args.claimId) || undefined
        const claim = claimId ? ledger.claims.find((item) => item.id === claimId)?.claim : undefined
        const evidence = ledger.addEvidence(await researchClaim({ query, claim, claimId, requestedBy: 'gale' }, ledger, env))
        return { status: evidence.status, rationale: evidence.rationale, title: evidence.title, sourceUrl: evidence.sourceUrl, excerpt: evidence.excerpt, otherSources: evidence.sources?.slice(1) }
      }),
    }
    const act: Tool = {
      spec: {
        name: 'act_on_page',
        description: 'Take a natural-language action in the live browser on the page you already opened, then read the result. Use when the answer is behind a click: dismiss a cookie banner, open the pricing tab, expand reviews, scroll to the comparison table. Example: "close the popup and click Pricing".',
        parameters: { type: 'object', properties: { instruction: { type: 'string' }, thenExtract: { type: 'string', description: 'What to read after acting, e.g. "the monthly price and what it includes". Empty string to skip.' }, claimId: { type: 'string', description: 'Ledger claim id this settles, or empty string.' } }, required: ['instruction', 'thenExtract', 'claimId'], additionalProperties: false },
      },
      run: (args) => timed(ledger, agent, 'act_on_page', args, async () => {
        const browser = runtime.browser?.('gale')
        if (!browser || !browser.active) return { error: 'Open a page with research_claim first.' }
        if (browser.mode !== 'stagehand') return { error: 'This session cannot act on pages.' }
        const instruction = str(args.instruction)
        const acted = await browser.act(instruction, ACT_BUDGET_MS)
        const question = str(args.thenExtract).trim()
        const extracted = question ? await browser.extract(question, EXTRACT_BUDGET_MS) : null

        // Whatever the click uncovered used to vanish into the tool result.
        // Record it, so a fact behind a cookie wall can still reach the verdict.
        const claimId = str(args.claimId) || undefined
        const claim = claimId ? ledger.claims.find((item) => item.id === claimId)?.claim : undefined
        const judged = claim && extracted?.answer
          ? await judgeEvidence(env, { claim, query: question || instruction, sources: [], pageText: extracted.answer, extraction: extracted.answer })
          : null
        const evidence = ledger.addEvidence({
          status: judged?.status ?? 'unproven', judged: Boolean(judged), via: 'live', claimId,
          query: question || instruction,
          excerpt: judged?.quote || extracted?.answer?.slice(0, 280) || acted.message.slice(0, 280),
          rationale: judged?.rationale ?? `Gale acted on the open page ("${instruction}") and read what it said.`,
          interaction: { instruction, acted: acted.message, extracted: extracted?.answer, quotes: extracted?.quotes },
          capturedAt: new Date().toISOString(), screenshotCaptured: false, requestedBy: 'gale',
        })
        return { acted, extracted, evidenceStatus: evidence.status }
      }),
    }
    return [readLedger, research, act, searchWeb, messageJuror]
  }

  const requestResearch: Tool = {
    spec: {
      name: 'request_research',
      description: 'Ask Gale, the Skeptic, to verify a factual claim with a live browser before the jury speaks. Gale will report back verified, contested, or unproven.',
      parameters: { type: 'object', properties: { query: { type: 'string' }, why: { type: 'string' }, claimId: { type: 'string', description: 'Ledger claim id or empty string.' } }, required: ['query', 'why', 'claimId'], additionalProperties: false },
    },
    run: (args) => timed(ledger, agent, 'request_research', args, async () => {
      const query = str(args.query).trim()
      if (!query) return { error: 'A query is required.' }
      const message = ledger.send(agent, 'gale', 'research.request', { query, why: str(args.why).slice(0, 200), claimId: str(args.claimId) || undefined })
      return { queued: true, messageId: message.id, note: 'Gale will research this before the jury speaks.' }
    }),
  }

  const browseSite: Tool = {
    spec: {
      name: 'browse_site',
      description: 'Read one URL and get its text. Use after search_web when a snippet is not enough: a competitor landing page, a GitHub README, a forum thread of user complaints.',
      parameters: { type: 'object', properties: { url: { type: 'string' }, lookingFor: { type: 'string' } }, required: ['url', 'lookingFor'], additionalProperties: false },
    },
    run: (args) => timed(ledger, agent, 'browse_site', args, async () => {
      const url = str(args.url).trim()
      if (!/^https?:\/\//.test(url)) return { error: 'A full http(s) URL is required.' }
      const browser = runtime.browser?.(agent)
      if (!browser) return { error: 'Browserbase is not configured.' }
      const page = await readPage(runtime, agent, url)
      if (!page) return { error: 'That page could not be read.' }
      const lookingFor = str(args.lookingFor)
      // Reading a page is an observation, not a judgement, so it stays unproven.
      // Only the evidence clerk may mark something verified or contested.
      ledger.addEvidence({
        status: 'unproven', judged: false, via: page.via,
        query: lookingFor, sourceUrl: page.finalUrl, title: page.title,
        excerpt: page.excerpt.slice(0, 280),
        rationale: `${agent} read this page while looking for: ${lookingFor}`,
        screenshotDataUrl: page.screenshotDataUrl, capturedAt: page.capturedAt,
        screenshotCaptured: Boolean(page.screenshotDataUrl), requestedBy: agent,
      })
      // The screenshot stays out of the return value: it would land in the run
      // tree and every subscriber as base64.
      return { url: page.finalUrl, title: page.title, via: page.via, text: page.excerpt.slice(0, 1600) }
    }),
  }

  return agent === 'volt' ? [readLedger, requestResearch, messageJuror] : [readLedger, searchWeb, browseSite, requestResearch, messageJuror]
}

export function specsOf(tools: Tool[]) { return tools.map((tool) => tool.spec) }

export function executorOf(tools: Tool[]) {
  const byName = new Map(tools.map((tool) => [tool.spec.name, tool]))
  return async (name: string, args: Record<string, unknown>) => {
    const tool = byName.get(name)
    if (!tool) return { error: `Unknown tool ${name}` }
    return tool.run(args)
  }
}
