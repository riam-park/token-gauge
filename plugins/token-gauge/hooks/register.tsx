// Token Gauge: plan usage, context and the prompt-cache countdown above the prompt, as three chips.
//   [plan 5h 5% ▰▱ ↻2h52 · 7d 38% · $1.27]  [☀ context ▰▱ 113k / 1M 11% · ▲1.3k · ≈ 600턴]  [❄ 59:06]  ▾ 상세
// Colors follow state as token-weather's forecast does; ▾ (or d with the band focused) opens a detail panel:
// reset forecasts, today's total over every session, /context's breakdown, the last turn's largest results,
// unchanged re-reads and repeated outputs, what a compaction dropped and the cache hit rate. A fourth chip
// shows the model and its effort. While Claude works a ⏳ chip shows the time and tool calls; subagents still
// running, the turn's or ones left in the background after it, have a chip of their own.
// Estimates (≈) are characters / 4, scaled by k: the input growth measured between a turn's requests over
// the estimated tool results that caused it.
import type { EngineInterface, Register, Timer } from 'claude-code'

const WINDOW_MS: Record<string, number> = { five_hour: 5 * 60 * 60_000, seven_day: 7 * 24 * 60 * 60_000 }
const FAST_BELOW_MS = 2 * 60_000
const KEEP_BELOW_MS = 10 * 60_000
const CACHE_ALERT_MS = 5 * 60_000
const DELTAS = 5
const TOP = 3
const STACK_CELLS = 40 // width of the terminal's breakdown bar
const DAY_PREFIX = 'day:'
const KEEP_DAYS = 7
// What `claude plugin update` would install: the version in the marketplace on GitHub.
const UPDATE_URL = 'https://raw.githubusercontent.com/riam-park/token-gauge/main/.claude-plugin/marketplace.json'
const UPDATE_EVERY_MS = 24 * 60 * 60_000
const CHECKED_KEY = 'update:checkedAt'
const SAMPLES = 10 // turns k is measured over
const MIN_SAMPLE_EST = 2_000 // a turn whose results are smaller says little about k
const K_MIN = 0.5
const K_MAX = 2
const REPEAT_MIN = 200 // outputs smaller than this are not worth calling repeats
const LARGE_READ = 10_000
const LARGE_OUTPUT = 8_000
const UNUSED_MCP = 5_000
const UNUSED_AFTER_TURNS = 10
const LARGE_MEMORY = 8_000
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const MEDIA_FILE = /\.(png|jpe?g|gif|webp|pdf)$/i // Read sends these as pictures or a document: offset/limit does not apply
const PICTURE_MAX = 4_784 // the high-resolution tier's cap (Claude 4.7 and later); the standard tier's is 1,568
const PICTURE_TOKENS = 1_600 // shortcut: a picture of unknown size, taken as a standard-tier one
const PAGE_TEXT_TOKENS = 2_250 // the middle of the 1,500-3,000 a PDF page's text takes
const QUESTION_COLUMNS = 100 // a site with no measured width
const REFRESH_TICKS = 3 // seconds between context reads while Claude works
const PERSON = new Set(['composer', 'bridge']) // prompt origins someone is there to ask about
const SEND_ANYWAY = '보내기'
const PUT_BACK = '취소'
const QUESTION_LINE = 80 // the terminal's line above a question: two of its 40-column rows
const NEXT_STEP_TOOL = 'mcp__ccd_turn__wrap_up' // the desktop app's turn-end summary; with a question it is the next-step box
const DESKTOP_SLACK = 8 // columns the graphical surfaces' proportional font and key badge take beyond the estimate (2026-10-24 screen: it wrapped without)

// The userConfig options in plugin.json, asked at install and changed with /plugin configure or /config.
// handoffDir '' asks for the handoff memo in the answer; a folder asks for a PROMPT file there.
export type Config = { cacheTtlMs: number; actionsAt: number; showCost: boolean; alerts: boolean; handoffDir: string }
const DEFAULTS: Config = { cacheTtlMs: 60 * 60_000, actionsAt: 70, showCost: true, alerts: true, handoffDir: '' }
let cfg = DEFAULTS

// Options as saved, checked: a missing or odd value keeps its default.
export function configure(o: Record<string, unknown>): Config {
  const n = Number(o.actionsAt)
  const dir = typeof o.handoffDir === 'string' ? o.handoffDir.trim().replace(/[\\/]+$/, '') : ''
  cfg = {
    cacheTtlMs: o.cacheTtl === '5m' ? 5 * 60_000 : DEFAULTS.cacheTtlMs,
    actionsAt: Number.isFinite(n) && n >= 50 && n <= 95 ? n : DEFAULTS.actionsAt,
    showCost: o.showCost !== false,
    alerts: o.alerts !== false,
    handoffDir: dir,
  }
  return cfg
}

// What /compact is asked to keep: the files this session edited, which a summary may drop (the compact detail line).
export function compactArgs(paths: readonly string[]) {
  if (!paths.length) return ''
  const shown = paths.slice(-20)
  return `이번 세션에서 편집한 파일 경로를 요약에 모두 남겨 줘: ${shown.join(', ')}${paths.length > shown.length ? ` 외 ${paths.length - shown.length}개` : ''}`
}

// `lost`: files edited this session that the last compaction's summary no longer names.
export function handoffText(dir: string, lost: readonly string[] = []) {
  const parts = '배경, 관련 파일 경로, 목표, 검증 기준, 범위 밖 항목'
  const keep = lost.length ? ` compact 요약에 빠진 편집 파일도 메모에 넣어 줘: ${lost.join(', ')}` : ''
  if (!dir) return `지금까지의 작업을 인계 메모로 정리해 줘. 파일은 만들지 말고 이 답변에 ${parts}을 써 줘. 새 세션에 이 답변을 붙여 넣어 이어서 작업할 거야.${keep}`
  return (
    `지금까지의 작업을 인계 메모로 정리해 줘. 저장소의 \`${dir}\` 폴더에 Markdown 파일로 ` +
    `${parts}을 쓰고 경로를 알려 줘. 새 세션에서 이 파일로 이어서 작업할 거야.${keep}`
  )
}

const C = {
  green: '#6CC88A',
  cyan: '#4FC1D6',
  violet: '#A78BFA',
  orange: '#F59E4B',
  red: '#EF5F5F',
  yellow: '#E8C547',
  blue: '#6AA9F0',
  pink: '#E879A6',
  marker: '#9A9A9A',
}
// Context fill against the auto-compact line, as token-weather's forecast.
const FORECAST = [
  { below: 25, icon: '☀', color: C.green },
  { below: 50, icon: '☁', color: C.cyan },
  { below: 75, icon: '☂', color: C.violet },
  { below: 90, icon: '☇', color: C.orange },
  { below: Infinity, icon: '↯', color: C.red },
]
// The model chip's border, by family.
const FAMILY: Record<string, string> = { opus: C.violet, sonnet: C.blue, haiku: C.green, fable: C.pink }
// /context's categories in the detail bar; messages keep their own color, as context-bar draws them.
const SLICE_COLORS = [C.blue, C.cyan, C.violet, C.green, C.yellow, C.pink]
const MESSAGES = C.orange

type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Slice = { name: string; tokens: number }
export type Item = { label: string; tokens: number }
export type Day = { usd: number; input: number; output: number }
// Raw estimates; the view scales them by k.
export type Waste = { rereads: number; rereadTokens: number; rereadTop?: { name: string; count: number }; repeats: number; repeatTokens: number; repeatTop?: string }
export type Compaction = { before?: number; after?: number; lost: string[]; count?: number }
export type Running = { id: string; type: string; description: string; since: number }
export type Reading = { at: number; percent: number }
export type Snapshot = {
  limits: Limit[]
  costUsd?: number
  tokens?: number
  window?: number
  compactsAt?: number
  slices: Slice[]
  deltas: number[] // the last turns' growth, newest last
  lastRequestAt?: number
  top: Item[] // the last main-thread turn's largest tool results
  cache: { read: number; total: number; rewrites: number; steps: number }
  today?: { sessions: number } & Day
  k?: number // estimate scale, undefined until a turn measured it
  waste?: Waste
  compaction?: Compaction // the last one this session
  model?: string
  effort?: string | number
  agents?: Running[] // subagents running now, with or without a turn
  tools?: Record<string, number> // the main thread's tool results this session by tool, raw estimates
  calls?: Record<string, number> // tool calls this session by tool, subagents' included
  fiveTrail?: Reading[] // 5h readings over about the last hour, oldest first
}
type Bar = { percent: number; color: string; marker?: number }
export type View = {
  plan?: {
    five?: { percent: number; color: string; bar: Bar; reset?: string }
    seven?: { percent: number; color: string; reset?: string }
    cost?: string
  }
  ctx?: { icon: string; color: string; used: string; window: string; percent: number; bar: Bar; delta?: string; turns?: string; offerActions: boolean; memoUsd?: string }
  cache?: { color: string; text: string; isCold: boolean; rewrite?: string; offerKeep: boolean }
  detail: { label: string; text: string }[]
  slices: { name: string; tokens: number; color: string; share: number }[]
  model?: { name: string; effort?: string; color: string }
  agents?: number
}
type Work = { since: number; tools: number }
// A main-thread turn's requests: the first and last input, every output and the last one.
type Steps = { first?: number; last?: number; outputs: number; lastOutput: number; count: number; compacted: boolean }
export type Sample = { growth: number; est: number }
type Seen = { hash: number; epoch: number; seq: number }
type FileSeen = { ranges: Record<string, Seen>; editedAt: number }
export type ReadKind = 'first' | 'after-edit' | 'after-compaction' | 'changed' | 'unchanged'
type McpTool = { serverName: string; tokens: number; isLoaded: boolean }
type MemoryFile = { path: string; tokens: number }
type Advice = { key: string; text: string }

const empty = (): Snapshot => ({ limits: [], slices: [], deltas: [], top: [], cache: { read: 0, total: 0, rewrites: 0, steps: 0 } })
let snap: Snapshot = empty()
let timer: Timer | undefined
let hasKeepwarm = false
let showDetail = false
let work: Work | undefined // the main-thread turn in progress
let turnItems: Item[] = []
let turnBase: number | undefined // the context when the main-thread turn began, for its ▲ growth
let mine: Day = { usd: 0, input: 0, output: 0 } // this session's share of today
const alerted = { fiveHour: '', ctx: false, cacheFor: 0 }
const noSteps = (): Steps => ({ outputs: 0, lastOutput: 0, count: 0, compacted: false })
let steps = noSteps()
let samples: Sample[] = []
// What this conversation has read, edited and output; a compaction starts a new epoch, after which nothing earlier is in the window.
let epoch = 0
let seq = 0
let files: Record<string, FileSeen> = {}
let outputs: Record<string, number> = {} // tool and result hash -> the epoch it was last seen in
let rereadCounts: Record<string, number> = {}
let edited = new Set<string>()
let calledServers = new Set<string>()
let mainTurns = 0
let inWindow: { mcp: McpTool[]; memory: MemoryFile[] } = { mcp: [], memory: [] }
let advised = new Set<string>()
let orderChecked = false
let seenDesktop = false // the band was drawn on the desktop: the footer line is the desktop's
let turnCard = false // a next-step box is up, and the desktop hides the band under it
let footerShown: string | undefined | null = null // the footer line last written; null until the first write
let keepOfferedFor: number | undefined // the request whose cache the box was offered /keepwarm for

function forget() {
  turnBase = undefined
  steps = noSteps()
  samples = []
  epoch = 0
  seq = 0
  files = {}
  outputs = {}
  rereadCounts = {}
  edited = new Set()
  calledServers = new Set()
  mainTurns = 0
  advised = new Set()
}

export const register: Register = (on, options) => {
  configure(options ?? {})
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    timer?.cancel()
    let tick = 0
    timer = $.clock.every(1000, () => {
      tick++
      $.clock
        .now()
        .then(async now => {
          // a subagent can outlive the turn that started it: counted every other second, a turn or not
          if (tick % 2 === 0) {
            const running = (await $.agent.list().catch(() => [])).filter(a => a.status === 'running')
            const ids = (list: readonly { id: string }[]) => list.map(a => a.id).join()
            if (ids(running) !== ids(snap.agents ?? [])) {
              const since = (id: string) => snap.agents?.find(a => a.id === id)?.since ?? now // first seen, within 2 seconds
              snap = { ...snap, agents: running.map(a => ({ id: a.id, type: a.type, description: a.description, since: since(a.id) })) }
              $.ui.invalidate('ui.render')
            }
          }
          // while Claude works the context grows request by request and result by result: read it again
          if (work && tick % REFRESH_TICKS === 0) await readContext($, false).catch(() => {})
          if (work || shouldRedraw(snap, now)) $.ui.invalidate('ui.render')
          writeFooter($, now)
          suggestKeep($, now)
          alert($, now)
        })
        .catch(() => {})
    })
    const usage = await $.session.usage().catch(() => null)
    if (usage) takeLimits(usage.rateLimits, usage.cost?.usd, await $.clock.now())
    const model = await $.session.model().catch(() => '')
    if (model && !snap.model) snap = { ...snap, model }
    await readContext($, false).catch(() => {})
    await readToday($).catch(() => {})
    if (e.isInteractive && cfg.alerts) void checkUpdate($).catch(() => {}) // offline or blocked: no toast
    return result
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    takeLimits(e.rateLimits, e.cost?.usd, await $.clock.now())
    if (e.cost) mine = { ...mine, usd: e.cost.usd }
    $.ui.invalidate('ui.render')
    return result
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      turnCard = false // answered or passed over: a new turn closes the box
      work = { since: await $.clock.now(), tools: 0 }
      turnItems = []
      turnBase = snap.tokens
      steps = noSteps()
      $.ui.invalidate('ui.render')
    }
    return result
  })

  // Each model request: the cache clock restarts on the main thread; tokens count for today and the hit rate,
  // and the main thread's input and output are kept for k. An omitted effort is no change, for the same model.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) snap = { ...snap, model: e.model, effort: e.effort ?? (e.model === snap.model ? snap.effort : undefined) }
    const result = yield* next(e)
    const u = result.usage
    if (u) {
      const input = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
      const output = u.output_tokens ?? 0
      mine = { ...mine, input: mine.input + input, output: mine.output + output }
      if (!e.agentId) {
        snap = { ...snap, cache: hitRate(snap.cache, u) }
        steps = { ...steps, first: steps.first ?? input, last: input, outputs: steps.outputs + output, lastOutput: output, count: steps.count + 1 }
      }
    }
    if (!e.agentId && result.stopReason !== null) {
      const now = await $.clock.now() // before the spread, so an update during the await is kept
      snap = { ...snap, lastRequestAt: now }
      $.ui.invalidate('ui.render')
      if (work) void readContext($, false).catch(() => {}) // each request's usage, not only the turn's end
    }
    return result
  })

  // Counts every tool call of the turn; sizes the main thread's results for the largest-items line and
  // watches them for re-reads, repeats and oversized outputs.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (work) work = { ...work, tools: work.tools + 1 }
    const input = e as Record<string, unknown>
    const tool = toolKey(String(input.tool ?? 'tool'))
    snap = { ...snap, calls: { ...snap.calls, [tool]: (snap.calls?.[tool] ?? 0) + 1 } }
    if (!(e as { agentId?: string }).agentId) {
      const label = itemLabel(input)
      const tokens = estimate(result)
      turnItems.push({ label, tokens })
      snap = { ...snap, tools: { ...snap.tools, [tool]: (snap.tools?.[tool] ?? 0) + tokens } }
      observe($, input, label, tokens, fnv(resultText(result)))
      // shortcut: the desktop app's next-step box, read off its tool as 2.1.308 names it; a box closed by hand is not
      // seen, so the footer line stays until the next turn. Revisit if the app renames the tool.
      if (input.tool === NEXT_STEP_TOOL && typeof input.ask === 'string' && input.ask) turnCard = true
    }
    return result
  }).catch(async ($, e, next) => next(e)) // observer only: never stands in the way of a tool

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result // a subagent's turn fills its own window
    work = undefined
    const sample = turnSample(steps, turnItems.reduce((a, i) => a + i.tokens, 0))
    if (sample) samples = [...samples, sample].slice(-SAMPLES)
    mainTurns++
    snap = { ...snap, top: largest(turnItems, TOP), k: calibrate(samples) ?? snap.k }
    await readContext($, true).catch(() => {})
    if (mainTurns >= UNUSED_AFTER_TURNS) for (const u of unusedServers(inWindow.mcp, calledServers)) adviseOnce($, { key: `mcp:${u.server}`, text: `MCP 서버 ${u.server}의 도구 ≈${short(u.tokens)}가 컨텍스트에 있지만 이번 세션에서 쓰지 않았습니다 · /mcp에서 끌 수 있습니다` })
    for (const m of inWindow.memory) if (m.tokens >= LARGE_MEMORY) adviseOnce($, { key: `memory:${m.path}`, text: `큰 메모리 파일 ${fileName(m.path)} ≈${short(m.tokens)} · 요청마다 함께 보내집니다` })
    await saveToday($).catch(() => {})
    // cache-tax registers /keepwarm at its own session start; by the first turn it is there or not
    if (!hasKeepwarm) hasKeepwarm = JSON.stringify(await $.command.list().catch(() => [])).includes('"keepwarm"')
    return result
  })

  // A compaction empties the window without a turn ending: what was read before is gone, and the summary
  // may no longer name the files this session edited.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId && e.trigger !== 'precompute' && typeof result.skip !== 'string') {
      epoch++
      steps = { ...steps, compacted: true }
      const compaction = { before: result.tokensBefore, after: result.tokensAfter, lost: lostFiles([...edited], result.messages), count: (snap.compaction?.count ?? 0) + 1 }
      snap = { ...snap, tokens: result.tokensAfter ?? snap.tokens, compaction }
      $.ui.invalidate('ui.render')
      // until the engine takes the result, usage still reports the request before the compaction: read it after
      $.clock.after(2000, () => void readContext($, false).catch(() => {}))
    }
    return result
  }).catch(async ($, e, next) => next(e)) // observer only: never stands in the way of a compaction

  // A switch shows at once; the effort is known again at the next request.
  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
    snap = { ...snap, model: e.to_model, effort: undefined }
    $.ui.invalidate('ui.render')
    return result
  })

  // A prompt the person sent that another plugin's hook dropped (cache-tax on a cold cache, say): before the drop is
  // shown, a question card asks whether to send it anyway or put it back in the box. Waiting on the card does not
  // count against the hook's time. Sending passes the same prompt down once more, which cache-tax lets through the
  // second time: it enters as typed, once, with no drop shown. Otherwise the drop shown is the answer's short line.
  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    if (!orderChecked && result.drop === undefined) {
      orderChecked = true
      void warnIfCacheTaxAbove($, next.trace).catch(() => {})
    }
    if (result.drop === undefined || e.command || e.isMeta || !(await typedByPerson($, e.origin.kind))) return result
    const by = droppedBy(next.trace)
    if (!by) return result
    const answer = await askDropped($, e.text, by, result.drop)
    if (typeof answer === 'string') return { drop: answer }
    const again = await next(e)
    if (again.drop !== undefined) {
      await $.prompt.fill({ text: e.text, mode: 'replace' }).catch(() => {})
      return { drop: `token-gauge: 다시 보내도 막혀 입력창에 되돌렸습니다. ${again.drop}` }
    }
    $.clock.after(0, () => void holdCache($, answer.hold).catch(() => {})) // past this hook: a command waits for the turn to end
    return again
  }).catch(async ($, e, next) => next(e)) // observer only: never stands in the way of a prompt

  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const result = await next(e)
    snap = { ...snap, effort: undefined }
    $.ui.invalidate('ui.render')
    return result
  })

  // A /clear or a resume leaves the old conversation, and its cache, behind.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      snap = { ...empty(), limits: snap.limits, costUsd: snap.costUsd, today: snap.today, model: snap.model, effort: snap.effort }
      forget()
    }
    return next(e)
  })

  // The band above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    if (e.surface === 'desktop') seenDesktop = true
    // A survey (a question in the band) keeps the chip row, without buttons or the detail panel, so the question keeps the room
    const columns = e.props.bodyColumns - 2 - (e.surface === 'terminal' ? 0 : DESKTOP_SLACK)
    const band = await bandTree($, $.ui.resolve(e), e.surface === 'terminal', columns, e.props.isWorking ? 'working' : 'idle', e.props.hasSurvey)
    if (!band) return rest
    return { type: 'Box', props: { flexDirection: 'column' }, children: rest ? [band, rest] : [band] }
  })

  // A question dialog takes the prompt's place, the band with it: the chips stand above the question.
  // The site takes no size, so bars are text; no buttons, no detail panel and no ⏳ chip (the turn only waits).
  // The terminal allows 12 rows around the dialog, so there the chips are one line of text.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const rest = await next(e)
    if (!rest) return rest // the engine's node stands once, nothing below it
    const columns = (e.viewport?.columns ?? QUESTION_COLUMNS) - 2 - DESKTOP_SLACK // the terminal draws questionLine instead
    const ui = $.ui.resolve(e)
    const band = e.surface === 'terminal' ? questionLine(ui, fit(view(snap, await $.clock.now(), false), QUESTION_LINE)) : await bandTree($, ui, true, columns, 'question', true)
    if (!band) return rest
    return { type: 'Box', props: { flexDirection: 'column' }, children: [band, rest] }
  }).catch(async ($, e, next) => next(e)) // never in the way of a question
}

// The chip row (and the detail panel when open) for one site; undefined with nothing to show yet.
async function bandTree($: EngineInterface, ui: unknown, textBars: boolean, columns: number, state: 'idle' | 'working' | 'question', isYielding: boolean) {
  const now = await $.clock.now()
  const working = state === 'working' && work ? { ...work, elapsed: now - work.since } : undefined
  const room = columns - (working ? workCells(working) : 0)
  const v = fit(view(snap, now, hasKeepwarm), room)
  if (!v.plan && !v.ctx && !v.cache) return undefined
  if (width(v) > room) return questionLine(ui, v, working) // too narrow for the chips even folded: one line of text, as above a question
  return draw(ui, v, textBars, actions($), working, isYielding)
}

function actions($: EngineInterface): Actions {
  return {
    keepWarm: () => {
      $.command
        .run({ command: 'keepwarm', args: '90m' })
        .then(() => $.ui.toast('cache-tax: 90분 동안 캐시를 유지합니다 · /keepwarm off로 취소'))
        .catch(() => $.ui.toast('cache-tax의 /keepwarm을 실행하지 못했습니다'))
    },
    compact: () => fillPrompt($, `/compact ${compactArgs([...edited])}`.trim()),
    handoff: () => fillPrompt($, handoffText(cfg.handoffDir, snap.compaction?.lost)),
    toggle: () => {
      showDetail = !showDetail
      if (showDetail) void readToday($).then(() => $.ui.invalidate('ui.render')).catch(() => {})
      $.ui.invalidate('ui.render')
    },
  }
}

// A clean-up button only writes its request into the prompt box: the person sends it, edits it or clears it.
function fillPrompt($: EngineInterface, text: string) {
  $.prompt
    .fill({ text, mode: 'replace' })
    .then(r => r.isFilled || $.ui.toast('입력창에 넣지 못했습니다'))
    .catch(() => $.ui.toast('입력창에 넣지 못했습니다'))
}

function takeLimits(rateLimits: readonly Limit[] | undefined, costUsd: number | undefined, now: number) {
  const limits = (rateLimits ?? []).filter(w => Number.isFinite(w.percentUsed))
  const five = limits.find(l => l.kind === 'five_hour')
  snap = { ...snap, limits: limits.length ? limits : snap.limits, costUsd: costUsd ?? snap.costUsd, fiveTrail: five ? trail(snap.fiveTrail ?? [], five.percentUsed, now) : snap.fiveTrail }
}

// The 5h readings of about the last hour, for its recent pace: one on each change and every 5 minutes; a drop is a new window.
export function trail(list: readonly Reading[], percent: number, now: number): Reading[] {
  const last = list.at(-1)
  if (last && percent < last.percent) return [{ at: now, percent }]
  const kept = list.filter(x => now - x.at <= 65 * 60_000)
  return last && last.percent === percent && now - last.at < 5 * 60_000 ? kept : [...kept, { at: now, percent }]
}

// /context's summary, estimated locally: the compact line and the categories too.
async function readContext($: EngineInterface, isTurn: boolean) {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const c = usage.context
  const b = c?.breakdown
  const window = c?.window || b?.rawMaxTokens
  if (!window) return
  const tokens = c.tokens ?? b?.totalTokens ?? 0
  const compactsAt = b?.isAutoCompactEnabled ? b.autoCompactThreshold : undefined
  // a turn's growth from where it began: the reads during it moved snap.tokens already
  const base = turnBase ?? snap.tokens
  const delta = isTurn && base !== undefined ? tokens - base : undefined
  if (isTurn) turnBase = undefined
  const deltas = delta === undefined ? snap.deltas : [...snap.deltas, delta].slice(-DELTAS)
  const slices = b ? b.categories.filter(x => x.kind === 'used' && x.tokens > 0).map(x => ({ name: x.name.toLowerCase(), tokens: x.tokens })) : snap.slices
  if (b) inWindow = { mcp: b.mcpTools ?? [], memory: b.memoryFiles ?? [] }
  snap = { ...snap, tokens, window, compactsAt, deltas, slices }
  $.ui.invalidate('ui.render')
}

// Today's figures, one store key per session so sessions never overwrite each other.
async function saveToday($: EngineInterface) {
  const now = await $.clock.now()
  await $.store.set(`${DAY_PREFIX}${dateKey(now)}:${await $.session.id()}`, mine)
  await readToday($)
}

async function readToday($: EngineInterface) {
  const now = await $.clock.now()
  const keys = await $.store.keys()
  const today = `${DAY_PREFIX}${dateKey(now)}:`
  const days: Day[] = []
  for (const key of keys) {
    if (key.startsWith(today)) {
      const d = (await $.store.get(key)) as Day | undefined
      if (d) days.push(d)
    } else if (key.startsWith(DAY_PREFIX) && isOld(key, now)) await $.store.delete(key)
  }
  snap = { ...snap, today: { sessions: days.length, ...sumDays(days) } }
}

export function sumDays(days: Day[]): Day {
  return days.reduce((a, d) => ({ usd: a.usd + (d.usd || 0), input: a.input + (d.input || 0), output: a.output + (d.output || 0) }), { usd: 0, input: 0, output: 0 })
}

// Once a day across sessions: one GET of the marketplace file, a toast when it lists a newer version. Nothing is sent.
async function checkUpdate($: EngineInterface) {
  if (/^(1|true|yes|on)$/i.test((await $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')) ?? '')) return
  const now = await $.clock.now()
  if (now - Number(await $.store.get(CHECKED_KEY)) < UPDATE_EVERY_MS) return
  await $.store.set(CHECKED_KEY, now) // before the request, so sessions opened together ask once
  const res = await $.http.fetch(UPDATE_URL)
  if (!res.ok) return
  const latest = latestVersion(res.text)
  const current = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)).version
  if (latest && typeof current === 'string' && isNewer(latest, current)) {
    $.ui.toast(`token-gauge 새 버전 ${latest}(지금 ${current}) · Claude에게 "token-gauge 업데이트해줘"라고 하면 됩니다`, { timeoutMs: 15_000 })
  }
}

export function latestVersion(marketplace: string): string | undefined {
  try {
    const entry = (JSON.parse(marketplace).plugins ?? []).find((p: { name?: string }) => p.name === 'token-gauge')
    return typeof entry?.version === 'string' ? entry.version : undefined
  } catch {
    return undefined
  }
}

export function isNewer(a: string, b: string) {
  const x = a.split('.').map(n => Number(n) || 0)
  const y = b.split('.').map(n => Number(n) || 0)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

function isOld(key: string, now: number) {
  const day = Date.parse(key.slice(DAY_PREFIX.length, DAY_PREFIX.length + 10))
  return Number.isFinite(day) && now - day > KEEP_DAYS * 24 * 60 * 60_000
}

// One toast per crossing: 5h past 90% (per reset), context past 80% of the compact line, 5 minutes of cache left.
function alert($: EngineInterface, now: number) {
  if (!cfg.alerts) return
  const five = snap.limits.find(l => l.kind === 'five_hour')
  if (five && five.percentUsed >= 90 && alerted.fiveHour !== (five.resetsAt ?? '?')) {
    alerted.fiveHour = five.resetsAt ?? '?'
    $.ui.toast(`5h 사용량 ${Math.round(five.percentUsed)}%${five.resetsAt ? ` · ${countdown(Date.parse(five.resetsAt) - now)} 뒤 리셋` : ''}`)
  }
  const level = ctxLevel(snap)
  if (level !== undefined) {
    if (level >= 80 && !alerted.ctx) {
      alerted.ctx = true
      $.ui.toast(`컨텍스트가 compact 기준선의 ${Math.round(level)}%`)
    } else if (level < 60) alerted.ctx = false
  }
  const at = snap.lastRequestAt
  if (at !== undefined && alerted.cacheFor !== at) {
    const left = at + cfg.cacheTtlMs - now
    if (left > 0 && left <= Math.min(CACHE_ALERT_MS, cfg.cacheTtlMs / 2)) {
      alerted.cacheFor = at
      $.ui.toast(`캐시 ${Math.ceil(left / 60_000)}분 남음${hasKeepwarm ? ' · 자리를 비우면 유지 버튼' : ''}`)
    }
  }
}

// One main-thread tool call: edits mark their file; a Read is classified against the last read of the same
// range; any other output that came back unchanged in this epoch is a repeat. Oversized outputs advise once.
function observe($: EngineInterface, e: Record<string, unknown>, label: string, tokens: number, hash: number) {
  seq++
  const tool = String(e.tool ?? '')
  const path = typeof e.file_path === 'string' ? e.file_path : typeof e.notebook_path === 'string' ? e.notebook_path : ''
  const w: Waste = snap.waste ?? { rereads: 0, rereadTokens: 0, repeats: 0, repeatTokens: 0 }
  if (tool.startsWith('mcp__')) calledServers.add(serverKey(tool.split('__')[1] ?? ''))
  if (EDIT_TOOLS.has(tool) && path) {
    edited.add(path)
    files[path] = { ranges: files[path]?.ranges ?? {}, editedAt: seq }
    return
  }
  if (tool === 'Read' && path) {
    const range = `${e.offset ?? ''}:${e.limit ?? ''}`
    const f = files[path] ?? { ranges: {}, editedAt: 0 }
    const kind = readKind(f.ranges[range], f.editedAt, epoch, hash)
    files[path] = { ...f, ranges: { ...f.ranges, [range]: { hash, epoch, seq } } }
    if (kind === 'unchanged') {
      const count = (rereadCounts[path] ?? 0) + 1
      rereadCounts[path] = count
      const top = w.rereadTop && w.rereadTop.count >= count && w.rereadTop.name !== fileName(path) ? w.rereadTop : { name: fileName(path), count }
      snap = { ...snap, waste: { ...w, rereads: w.rereads + 1, rereadTokens: w.rereadTokens + tokens, rereadTop: top } }
      if (w.rereads + 1 >= 3) adviseOnce($, { key: 'reread', text: `변경 없는 재읽기 ${w.rereads + 1}회 ≈${short(scaled(w.rereadTokens + tokens))} · 이미 읽은 내용은 다시 읽지 않아도 됩니다` })
    }
  } else if (tokens >= REPEAT_MIN) {
    const key = `${tool}:${hash}`
    if (outputs[key] === epoch) snap = { ...snap, waste: { ...w, repeats: w.repeats + 1, repeatTokens: w.repeatTokens + tokens, repeatTop: label } }
    outputs[key] = epoch
  }
  const a = advice(e, label, scaled(tokens))
  if (a) adviseOnce($, a)
}

function scaled(tokens: number) {
  return Math.round(tokens * (snap.k ?? 1))
}

// The desktop app hosts its sessions through the SDK, so there the person's typing arrives as `sdk`; in a plain -p
// run, with no surface to draw on, an `sdk` prompt is nobody's to ask about.
async function typedByPerson($: EngineInterface, kind: string) {
  return PERSON.has(kind) || (kind === 'sdk' && (await $.session.surfaces().catch(() => [])).length > 0)
}

// The person's choice: `{ hold }` to send, or the line their drop shows. The card is headed token-gauge and names the
// plugin that dropped the prompt, its reason in Korean when it is cache-tax's (cardText). Anything but sending (cancel,
// text typed under Other) goes back in the box; a card never answered (dismissed, or no surface to ask on) keeps the
// hook's own reason.
// With a cache hold on offer, the person picks whether to keep the cache warm as well as whether to send.
async function askDropped($: EngineInterface, text: string, by: string, reason: string): Promise<string | { hold?: string }> {
  const card = cardText(by, reason, cfg.cacheTtlMs, snap.model)
  const cost = card.cost ? `$${card.cost}` : ''
  const keep = card.hold ? `보내고 ${koDuration(card.hold)} 유지 (${[cost, card.keepUsd && `약 $${card.keepUsd}`].filter(Boolean).join(' + ') || '비용 미상'})` : undefined
  const send = card.hold ? `보내기만${cost && ` (${cost})`}` : `${SEND_ANYWAY}${cost && ` (${cost})`}`
  const answer = await $.ui.ask(card.question, { options: keep ? [keep, send, PUT_BACK] : [send, PUT_BACK], header: 'token-gauge' }).catch(() => undefined)
  if (answer === keep || answer === send) return { hold: answer === keep ? card.hold : undefined }
  await $.prompt.fill({ text: answer && answer !== PUT_BACK ? answer : text, mode: 'replace' }).catch(() => {})
  return answer ? 'token-gauge: 보내지 않았습니다. 입력창에 되돌렸습니다.' : reason
}

// The card's question: who dropped the prompt, why (cache-tax's English reason read into Korean; any other reason as
// it came), and what cancelling does. `cost` is what sending costs, when the reason says; `hold` the cache hold the
// reason offers, `keepUsd` what holding it costs.
export function cardText(by: string, reason: string, ttlMs: number, model?: string) {
  const why = reason.startsWith(`${by}:`) ? reason.slice(by.length + 1).trimStart() : reason
  const m = /went cold (.+?) ago\. Sending this re-writes up to ([\d,]+) tokens at \$([\d.]+)\/MTok = \$([\d.]+) \(a warm turn would have cost \$([\d.]+)\)/.exec(why)
  const hold = keepwarmHold(why)
  const pings = hold ? keepPings(hold, ttlMs) : undefined
  // a ping reads the cache once, at the model's cache-read price
  const tokens = m ? Number(m[2]!.replace(/,/g, '')) : 0
  const read = prices(model, tokens)?.read
  const keepUsd = m && pings && read !== undefined ? ((tokens / 1e6) * read * pings).toFixed(2) : undefined
  const lines = [`${by} 플러그인이 이 프롬프트를 막았습니다.`]
  if (m) {
    lines.push(`프롬프트 캐시가 ${koDuration(m[1]!)} 전에 식어서, 지금 보내면 ${m[2]}토큰을 다시 기록합니다: $${m[4]} (캐시가 살아 있었으면 $${m[5]})`)
    if (hold) lines.push(`${koDuration(hold)} 유지를 고르면 ${by}가 ${keepUsd ? `50분마다 캐시를 갱신합니다(${pings}번, 약 $${keepUsd})` : '/keepwarm으로 캐시를 유지합니다'}. 보내기만 고르면 유지를 켜지 않습니다.`)
  } else lines.push(why.length > 600 ? `${why.slice(0, 599)}…` : why)
  // cache-tax lets the same prompt through when it is sent again: cancelling then resending pays all the same
  lines.push(`그래도 보낼까요? ${PUT_BACK}하면 입력창에 되돌립니다.${m ? ` 입력창에서 다시 보내면 ${by}가 비용을 내는 것으로 보고 통과시킵니다.` : ''}`)
  return { question: lines.join('\n'), cost: m?.[4], hold, keepUsd }
}

// How many times cache-tax refreshes a 1-hour cache over the hold: every 50 minutes, as its status line counts down.
// shortcut: its 5-minute cadence is not known here, so a 5-minute cache gets no count and no cost
export function keepPings(hold: string, ttlMs: number) {
  const p = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(hold)
  if (!p || ttlMs < 60 * 60_000) return undefined
  return Math.floor(((Number(p[1]) || 0) * 60 + (Number(p[2]) || 0)) / 50) || undefined
}

// 38h39m -> 38시간 39분, 3h00m -> 3시간, 15d 17h -> 15일 17시간, 5m -> 5분; anything else as it came.
export function koDuration(d: string) {
  const parts = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/.exec(d.replace(/\s+/g, ''))
  if (!parts || !d) return d
  const [, days, hours, mins] = parts.map(n => Number(n) || 0)
  return [days && `${days}일`, hours && `${hours}시간`, mins && `${mins}분`].filter(Boolean).join(' ') || '0분'
}

// cache-tax drops a cold prompt and answers without passing it on, so the card needs token-gauge's hook outside its
// own. A prompt that went through and saw no cache-tax link beneath, while /keepwarm (cache-tax's) is there, means
// cache-tax sits outside: say so once.
async function warnIfCacheTaxAbove($: EngineInterface, trace: readonly { plugin: string }[]) {
  if (!cfg.alerts || trace.some(t => t.plugin === 'cache-tax')) return
  if (!JSON.stringify(await $.command.list().catch(() => [])).includes('"keepwarm"')) return
  $.ui.toast('cache-tax가 먼저 실행돼 막힘 확인 카드가 안 뜹니다 · token-gauge를 플러그인 목록 앞으로(README)', { timeoutMs: 15_000 }) // one terminal line
}

// The hold the person chose is asked of /keepwarm; with none, `/keepwarm off`, since cache-tax holds the cache on its
// own once a cold write is paid. Commands wait for the turn to end, so this runs after cache-tax's own.
async function holdCache($: EngineInterface, hold: string | undefined) {
  if (!JSON.stringify(await $.command.list().catch(() => [])).includes('"keepwarm"')) return
  const done = await $.command.run({ command: 'keepwarm', args: hold ?? 'off' }).then(() => true).catch(() => false)
  $.ui.toast(!done ? '/keepwarm을 실행하지 못했습니다' : hold ? `/keepwarm으로 ${koDuration(hold)} 동안 캐시를 유지합니다` : '/keepwarm off: 보내기만 골라 cache-tax의 자동 캐시 유지를 껐습니다')
}

// A tip toast, once per key a session, when alerts are on.
function adviseOnce($: EngineInterface, a: Advice) {
  if (!cfg.alerts || advised.has(a.key)) return
  advised.add(a.key)
  $.ui.toast(a.text, { timeoutMs: 10_000 })
}

function ctxLevel(s: Snapshot) {
  if (s.tokens === undefined || !s.window) return undefined
  return (s.tokens / (s.compactsAt || s.window)) * 100
}

export function view(s: Snapshot, now: number, canKeep: boolean): View {
  const v: View = { detail: [], slices: [] }
  const live = (kind: string) => {
    const w = s.limits.find(l => l.kind === kind)
    const resetMs = w?.resetsAt ? Date.parse(w.resetsAt) : NaN
    if (!w || resetMs <= now) return undefined // a window past its reset waits for a fresh reading
    const elapsed = Number.isFinite(resetMs) && WINDOW_MS[kind] ? clamp(100 - ((resetMs - now) / WINDOW_MS[kind]!) * 100) : undefined
    return { w, resetMs, elapsed }
  }
  const five = live('five_hour')
  const seven = live('seven_day')
  const cost = cfg.showCost && s.costUsd ? `$${s.costUsd.toFixed(2)}` : undefined
  if (five || seven || cost) {
    v.plan = { cost }
    if (five) {
      const p = five.w.percentUsed
      v.plan.five = {
        percent: Math.round(p),
        color: levelColor(p),
        bar: { percent: p, color: levelColor(p), marker: five.elapsed },
        reset: Number.isFinite(five.resetMs) ? countdown(five.resetMs - now) : undefined,
      }
      if (five.elapsed !== undefined) {
        v.detail.push({
          label: '5h',
          text: `리셋 ${clock(five.resetMs)} (${countdown(five.resetMs - now)}) · 경과 ${Math.round(five.elapsed)}% 대비 사용 ${Math.round(p)}% → ${pace(p, five.elapsed)}${forecastText(p, five.elapsed, five.resetMs, now)}${recentForecast(s.fiveTrail ?? [], now, five.resetMs)}`,
        })
      }
    }
    if (seven) {
      const reset = Number.isFinite(seven.resetMs) ? countdown(seven.resetMs - now) : undefined
      v.plan.seven = { percent: Math.round(seven.w.percentUsed), color: levelColor(seven.w.percentUsed), reset }
      if (reset) {
        const p = seven.w.percentUsed
        v.detail.push({ label: '7d', text: `리셋 ${day(seven.resetMs)} (${reset})${seven.elapsed === undefined ? '' : forecastText(p, seven.elapsed, seven.resetMs, now)}` })
      }
    }
  }
  if (s.today && s.today.sessions > 0) {
    const t = s.today
    v.detail.push({ label: '오늘', text: `${cfg.showCost ? `$${t.usd.toFixed(2)} · ` : ''}세션 ${t.sessions}개 · 입력 ${short(t.input)} / 출력 ${short(t.output)}` })
  }
  const level = ctxLevel(s)
  if (level !== undefined && s.tokens !== undefined && s.window) {
    const f = FORECAST.find(x => level < x.below)!
    const last = s.deltas.at(-1)
    const left = turnsLeft(s)
    v.ctx = {
      icon: f.icon,
      color: f.color,
      used: short(s.tokens),
      window: short(s.window),
      percent: Math.round((s.tokens / s.window) * 100),
      bar: { percent: (s.tokens / s.window) * 100, color: f.color },
      delta: last ? (last > 0 ? `▲${short(last)}` : `▼${short(-last)}`) : undefined,
      turns: left === undefined ? undefined : `≈ ${left > 999 ? '999+' : left}턴`,
      offerActions: level >= cfg.actionsAt,
    }
    const isCold = s.lastRequestAt !== undefined && now >= s.lastRequestAt + cfg.cacheTtlMs
    const memo = cfg.showCost ? memoUsd(s.model, s.tokens, isCold, cfg.cacheTtlMs) : undefined
    if (memo !== undefined) v.ctx.memoUsd = memo.toFixed(2)
    v.slices = slices(s.slices, s.window)
    if (s.compactsAt) {
      const growth = average(s.deltas)
      v.detail.push({ label: 'context', text: `compact까지 ${short(Math.max(0, s.compactsAt - s.tokens))}${growth ? ` · 최근 평균 +${short(Math.round(growth))}/턴` : ''}` })
    }
  }
  const adj = (n: number) => short(Math.round(n * (s.k ?? 1)))
  if (s.top.length) {
    v.detail.push({ label: '지난 턴', text: `큰 결과: ${s.top.map(i => `${i.label} ≈${adj(i.tokens)}`).join(' · ')}${s.k === undefined ? '' : ` · 추정 ×${s.k.toFixed(2)}`}` })
  }
  // by result size, then by calls: a tool only subagents called has calls and no size
  const calls = s.calls ?? {}
  const byTool = [...new Set([...Object.keys(s.tools ?? {}), ...Object.keys(calls)])]
    .map(t => [t, s.tools?.[t] ?? 0, calls[t] ?? 0] as const)
    .sort((a, b) => b[1] - a[1] || b[2] - a[2])
  const toolTotal = byTool.reduce((a, [, n]) => a + n, 0)
  const callTotal = byTool.reduce((a, [, , c]) => a + c, 0)
  const sized = (c: number, n: number) => [c && `${c}회`, n && `≈${adj(n)}`].filter(Boolean).join(' ')
  if (toolTotal >= 1000 || callTotal) {
    const more = byTool.length > 4 ? ` 외 ${byTool.length - 4}종` : ''
    v.detail.push({ label: '도구별', text: `${byTool.slice(0, 4).map(([t, n, c]) => `${t} ${sized(c, n)}`).join(' · ')}${more} · 세션 합계 ${sized(callTotal, toolTotal)}` })
  }
  const w = s.waste
  if (w && (w.rereads || w.repeats)) {
    const parts: string[] = []
    if (w.rereads) parts.push(`변경 없는 재읽기 ${w.rereads}회 ≈${adj(w.rereadTokens)}${w.rereadTop ? ` (${w.rereadTop.name} ${w.rereadTop.count}회)` : ''}`)
    if (w.repeats) parts.push(`같은 출력 ${w.repeats}회 ≈${adj(w.repeatTokens)}${w.repeatTop ? ` (${w.repeatTop})` : ''}`)
    v.detail.push({ label: '중복', text: parts.join(' · ') })
  }
  if (s.compaction) {
    const c = s.compaction
    const size = c.before && c.after ? `${short(c.before)} → ${short(c.after)}` : '완료'
    const names = c.lost.map(fileName)
    const lost = names.length ? ` · 요약에 빠진 편집 파일 ${names.length}개: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ' 외' : ''}` : ''
    v.detail.push({ label: 'compact', text: `${c.count ? `${c.count}회 · ` : ''}${size}${lost}` })
  }
  if (s.model) {
    if (cfg.showCost && !prices(s.model, 0)) v.detail.push({ label: '비용', text: `단가표에 없는 모델(${s.model})이라 금액을 보이지 않습니다` })
    const name = modelName(s.model)
    v.model = { name, effort: s.effort === undefined ? undefined : String(s.effort), color: FAMILY[name.split(' ')[0]!.toLowerCase()] ?? C.marker }
  }
  if (s.agents?.length) {
    v.agents = s.agents.length
    const what = (d: string) => (d.length > 24 ? `${d.slice(0, 23)}…` : d)
    v.detail.push({ label: 'subagent', text: s.agents.map(a => `${a.type} ${what(a.description)} ${mmss(now - a.since)}`).join(' · ') })
  }
  if (s.lastRequestAt !== undefined) {
    const expires = s.lastRequestAt + cfg.cacheTtlMs
    const left = expires - now
    const saved = cfg.showCost ? savedUsd(s.model, s.cache.read) : undefined
    const rate = s.cache.total ? ` · 적중률 ${Math.round((s.cache.read / s.cache.total) * 100)}% · 재기록 ${s.cache.rewrites}회${saved && saved >= 0.01 ? ` · 절약 ≈$${saved.toFixed(2)}` : ''}` : ''
    if (left <= 0) {
      const usd = cfg.showCost && s.tokens ? rewriteUsd(s.model, s.tokens, cfg.cacheTtlMs) : undefined
      v.cache = { color: C.red, text: 'cold', isCold: true, rewrite: s.tokens ? `재기록 ~${short(s.tokens)}${usd === undefined ? '' : ` ≈$${usd.toFixed(2)}`}` : undefined, offerKeep: false }
      v.detail.push({ label: '캐시', text: `만료됨 · 다음 메시지가 컨텍스트 전체를 다시 기록${rate}` })
    } else {
      const sec = Math.ceil(left / 1000)
      v.cache = {
        color: left <= KEEP_BELOW_MS ? C.yellow : C.blue,
        text: `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`,
        isCold: false,
        offerKeep: canKeep && left <= KEEP_BELOW_MS,
      }
      v.detail.push({ label: '캐시', text: `만료 ${clock(expires)} · ${cfg.cacheTtlMs >= 60 * 60_000 ? '1시간' : '5분'} 캐시${rate}` })
    }
  }
  return v
}

// Base input price per million tokens by model id (platform.claude.com pricing, 2026-10). Writing the cache costs 2x that
// for the 1-hour cache, 1.25x for the 5-minute one.
// A Haiku 5.5 prompt past 100K tokens is billed at $0.50 whole (cache-tax prices it the same). The second number is
// a cache read: 0.1x the input price, except where the price list says otherwise (Opus 5.5, Fable/Mythos 5.1).
// Output costs 5x the input price on every model here.
// shortcut: older models (Opus 4.1 and before, Sonnet 3.x) are left out and show no cost; add rows as models ship
// shortcut: the Haiku 5.5 and Fable/Mythos 5 cache reads are not listed, so 0.1x is assumed; replace once published
const PRICES: [RegExp, number, number][] = [
  [/fable-5-1|mythos-5-1/i, 10, 0.25],
  [/fable|mythos/i, 10, 1],
  [/opus-5-5/i, 4, 0.2],
  [/opus-(5|4-[5-8])/i, 5, 0.5],
  [/sonnet-5/i, 2, 0.2],
  [/sonnet-4-[56]/i, 3, 0.3],
  [/haiku-5/i, 0.1, 0.01],
  [/haiku-4-5/i, 1, 0.1],
]
const OUTPUT_X = 5
const MEMO_OUTPUT = 3_000 // shortcut: a memo's output, thinking included, is a guess; measure one memo turn's usage if it matters

// Input and cache-read prices per million tokens for a prompt of `tokens`; undefined for a model the table does not know.
export function prices(model: string | undefined, tokens: number) {
  if (!model) return undefined
  if (/haiku-5/i.test(model) && tokens > 100_000) return { input: 0.5, read: 0.05 }
  const row = PRICES.find(([re]) => re.test(model))
  return row && { input: row[1], read: row[2] }
}

// What re-writing `tokens` into a cold cache costs at list price.
export function rewriteUsd(model: string | undefined, tokens: number, ttlMs: number) {
  const p = prices(model, tokens)
  return p && (tokens / 1e6) * p.input * (ttlMs >= 60 * 60_000 ? 2 : 1.25)
}

// What reading `readTokens` from the cache saved over sending them uncached, at list price.
// shortcut: priced at the current model's rates, so a session that switched models is off by the mix
export function savedUsd(model: string | undefined, readTokens: number) {
  const p = prices(model, 0)
  return p && (readTokens / 1e6) * (p.input - p.read)
}

// What the handoff memo costs: one request over the context, read from the cache or written again if it went cold,
// and the memo it writes.
export function memoUsd(model: string | undefined, tokens: number, isCold: boolean, ttlMs: number) {
  const p = prices(model, tokens)
  return p && (isCold ? rewriteUsd(model, tokens, ttlMs)! : (tokens / 1e6) * p.read) + (MEMO_OUTPUT / 1e6) * p.input * OUTPUT_X
}

// Drops the extras, then the model chip, then the cost, then 7d, until the line fits.
export function fit(v: View, columns: number): View {
  const steps: ((x: View) => View)[] = [
    x => (x.ctx ? { ...x, ctx: { ...x.ctx, turns: undefined, delta: undefined } } : x),
    x => ({ ...x, model: undefined }),
    x => (x.plan ? { ...x, plan: { ...x.plan, cost: undefined } } : x),
    x => (x.plan ? { ...x, plan: { ...x.plan, seven: undefined } } : x),
  ]
  let kept = v
  for (const step of steps) {
    if (width(kept) <= columns) break
    kept = step(kept)
  }
  return kept
}

// The chips as plain text, one cell per character: for width and for tests.
export function text(v: View): string {
  const chips: string[] = []
  if (v.plan) {
    const p = v.plan
    const parts = [p.five && `5h ${p.five.percent}% ▰▱${p.five.reset ? ` ↻${p.five.reset}` : ''}`, p.seven && `7d ${p.seven.percent}%${p.seven.reset ? ` ↻${p.seven.reset}` : ''}`, p.cost].filter(Boolean)
    chips.push(`[plan ${parts.join(' · ')}]`)
  }
  if (v.ctx) {
    const c = v.ctx
    chips.push(`[${c.icon} context ▰▱ ${c.used} / ${c.window} ${c.percent}%${[c.delta, c.turns].filter(Boolean).map(x => ` · ${x}`).join('')}]`)
  }
  if (v.cache) {
    const k = v.cache
    chips.push(`[❄ ${k.text}${k.rewrite ? ` ${k.rewrite}` : ''}${k.offerKeep ? ' (유지 90분)' : ''}]`)
  }
  if (v.model) chips.push(`[${v.model.name}${v.model.effort ? ` · ${v.model.effort}` : ''}]`)
  if (v.agents) chips.push(`[subagent ${v.agents} 실행 중]`)
  return chips.join('  ')
}

// The forecast and cache icons as color emoji (U+FE0F asks for the emoji form): the footer keeps an emoji's colors.
const EMOJI: Record<string, string> = { '☀': '☀️', '☁': '☁️', '☂': '☂️', '☇': '⛈️', '↯': '⚡' }
// A chip the band draws yellow or red, called out where the footer has no colors.
const warn = (color: string) => (color === C.yellow || color === C.red ? ' ⚠️' : '')

// The band as text, for the footer under the prompt, which draws text alone (ANSI codes show as text there) and is
// cut to about 27 characters on the desktop (2026-10-24 screen): what matters first, short, so a cut keeps the
// context and the cache. The icons in color, ⚠️ where the band goes yellow or red; bars, resets, the cost and the
// model (the footer shows it beside) are left out.
//   ☀️ 11% · ❄️ 51:20 · 5h 23% · 7d 83% ⚠️ · ⏳ 0:06 · subagent 1
export function footerLine(v: View, working?: Work & { elapsed: number }) {
  const parts: string[] = []
  if (v.ctx) parts.push(`${EMOJI[v.ctx.icon] ?? v.ctx.icon} ${v.ctx.percent}%`)
  if (v.cache) parts.push(`❄️ ${v.cache.text}${warn(v.cache.color)}`)
  if (v.plan?.five) parts.push(`5h ${v.plan.five.percent}%${warn(v.plan.five.color)}`)
  if (v.plan?.seven) parts.push(`7d ${v.plan.seven.percent}%${warn(v.plan.seven.color)}`)
  if (working) parts.push(`⏳ ${mmss(working.elapsed)}`)
  if (v.agents) parts.push(`subagent ${v.agents}`)
  return parts.join(' · ') || undefined
}

// The footer line, on the desktop while a next-step box hides the band, the only time the band is gone that a plugin
// can tell. Written each second it changes, the cache countdown and the ⏳ time with it.
function writeFooter($: EngineInterface, now: number) {
  const working = work && { ...work, elapsed: now - work.since }
  const text = seenDesktop && turnCard ? footerLine(view(snap, now, false), working) : undefined
  if (text === footerShown) return
  footerShown = text
  $.ui.status(text)
}

// When cache-tax's hold goes in the empty prompt box as a suggestion, for Tab to take: once a cache window, in its last
// 10 minutes, tried every 15 seconds until the box shows it (it shows only while the box is empty and idle).
export function keepSuggestionDue(lastRequestAt: number | undefined, now: number, ttlMs: number, offeredFor: number | undefined) {
  if (lastRequestAt === undefined || offeredFor === lastRequestAt) return false
  const left = lastRequestAt + ttlMs - now
  return left > 0 && left <= KEEP_BELOW_MS && Math.floor(now / 1000) % 15 === 0
}

function suggestKeep($: EngineInterface, now: number) {
  const at = snap.lastRequestAt
  if (!hasKeepwarm || work || !keepSuggestionDue(at, now, cfg.cacheTtlMs, keepOfferedFor)) return
  void $.prompt
    .suggest({ text: '/keepwarm 90m' })
    .then(r => {
      if (r.isShown) keepOfferedFor = at
    })
    .catch(() => {})
}

// Cells a text takes: a Hangul syllable or ⏳ two.
const cells = (t: string) => [...t].reduce((n, c) => n + (/[가-힣⏳]/.test(c) ? 2 : 1), 0)

// The ⏳ chip's cells, so the line leaves it room: its text and the bar with a gap on each side before it.
function workCells(w: Work & { elapsed: number }) {
  return cells(`⏳ ${mmss(w.elapsed)} · 도구 ${w.tools}`) + 3
}

// The clean-up buttons; the memo says what it costs.
function actionLabels(v: View) {
  return { compact: '/compact', handoff: `인계 메모${v.ctx?.memoUsd ? ` ≈$${v.ctx.memoUsd}` : ''}` }
}

function width(v: View) {
  // the bars between chips for text's brackets, padding, the bars drawn wider than their two glyphs, the ▾ button
  // and the clean-up buttons with their gaps
  const a = actionLabels(v)
  return cells(text(v)) + 16 + (v.ctx?.offerActions ? cells(a.compact) + cells(a.handoff) + 4 : 0)
}

type Actions = { keepWarm: () => void; compact: () => void; handoff: () => void; toggle: () => void }

function draw(ui: any, v: View, isTerminal: boolean, act: Actions, working: (Work & { elapsed: number }) | undefined, isYielding: boolean) {
  const { Box, Text, Button } = ui
  const keep = v.cache?.offerKeep && !isYielding ? <Button key="token-gauge-keep" label="유지 90분" onPress={act.keepWarm} /> : undefined
  const row = chipRow(ui, v, isTerminal, keep, working)
  if (v.ctx?.offerActions && !working && !isYielding) {
    const a = actionLabels(v)
    row.push(<Button key="token-gauge-compact" label={a.compact} onPress={act.compact} />)
    row.push(<Button key="token-gauge-handoff" label={a.handoff} onPress={act.handoff} />)
  }
  if (!isYielding) row.push(<Button key="token-gauge-more" label={showDetail ? '▴ 접기' : '▾ 상세'} hotkey="d" plain dimColor onPress={act.toggle} />)

  const rows: unknown[] = [
    <Box key="token-gauge-chips" flexDirection="row" alignItems="center" gap={1}>
      {row}
    </Box>,
  ]
  if (showDetail && !isYielding) {
    rows.push(
      <Box key="token-gauge-detail" flexDirection="column" paddingX={1} paddingTop={1}>
        {detailLines(ui, v, isTerminal)}
      </Box>,
    )
  }
  return (
    <Box flexDirection="column" paddingX={1}>
      {rows}
    </Box>
  )
}

// The chips in one row, split by a dim bar, with no borders; `keep` sits in the cache chip.
function chipRow(ui: any, v: View, isTerminal: boolean, keep: unknown, working: (Work & { elapsed: number }) | undefined) {
  const { Box, Text, Svg } = ui
  const dim = (s: string) => <Text dimColor>{s}</Text>
  const num = (s: string, color?: string) => (
    <Text color={color} tabular>
      {s}
    </Text>
  )
  const bar = (b: Bar, cells: number) =>
    isTerminal ? (
      <Text color={b.color}>{textBar(b.percent, cells)}</Text>
    ) : (
      <Svg source={svgBar(b, cells * 8)} alt={`${Math.round(b.percent)}%`} width={cells * 8} height={8} />
    )
  const chip = (key: string, kids: unknown[]) => (
    <Box key={key} flexDirection="row" alignItems="center" gap={1}>
      {kids}
    </Box>
  )
  const chips: unknown[] = []
  if (v.plan) {
    const p = v.plan
    const kids: unknown[] = [dim('plan')]
    if (p.five) {
      kids.push(dim('5h'), num(`${p.five.percent}%`, p.five.color), bar(p.five.bar, 6))
      if (p.five.reset) kids.push(dim(`↻${p.five.reset}`))
    }
    if (p.seven) {
      kids.push(dim('·'), dim('7d'), num(`${p.seven.percent}%`, p.seven.color))
      if (p.seven.reset) kids.push(dim(`↻${p.seven.reset}`))
    }
    if (p.cost) kids.push(dim('·'), num(p.cost))
    chips.push(chip('token-gauge-plan', kids))
  }
  if (v.ctx) {
    const c = v.ctx
    const kids: unknown[] = [<Text color={c.color}>{c.icon}</Text>, dim('context'), bar(c.bar, 8), num(`${c.used} / ${c.window}`), num(`${c.percent}%`, c.color)]
    for (const extra of [c.delta, c.turns]) if (extra) kids.push(dim(`· ${extra}`))
    chips.push(chip('token-gauge-ctx', kids))
  }
  if (v.cache) {
    const k = v.cache
    const kids: unknown[] = [<Text color={k.color}>❄</Text>, num(k.text, k.isCold ? k.color : undefined)]
    if (k.rewrite) kids.push(dim(k.rewrite))
    if (keep) kids.push(keep)
    chips.push(chip('token-gauge-cache', kids))
  }
  if (v.model) {
    const kids: unknown[] = [<Text>{v.model.name}</Text>]
    if (v.model.effort) kids.push(dim(`· ${v.model.effort}`))
    chips.push(chip('token-gauge-model', kids))
  }
  if (working) chips.push(chip('token-gauge-work', [<Text color={C.yellow}>⏳</Text>, num(mmss(working.elapsed)), dim(`· 도구 ${working.tools}`)]))
  if (v.agents) chips.push(chip('token-gauge-agents', [dim('subagent'), num(String(v.agents), C.cyan), dim('실행 중')]))
  return chips.flatMap((c, i) => (i ? [<Text key={`token-gauge-bar-${i}`} dimColor>│</Text>, c] : [c]))
}

// The detail panel's lines in a column of labels, the context breakdown under its line.
function detailLines(ui: any, v: View, isTerminal: boolean) {
  const { Box, Text, Svg } = ui
  const line = (label: string, kids: unknown[]) => (
    <Box key={`token-gauge-d-${label}`} flexDirection="row" gap={1}>
      <Box width={8}>
        <Text dimColor>{label}</Text>
      </Box>
      {kids}
    </Box>
  )
  const lines: unknown[] = []
  for (const d of v.detail) {
    lines.push(line(d.label, [<Text>{d.text}</Text>]))
    if (d.label === 'context' && v.slices.length) {
      const stack = isTerminal ? (
        <Box flexDirection="row">
          {stackCells(v.slices, STACK_CELLS).map((r, i) => (
            <Text key={String(i)} color={r.color} dimColor={!r.color}>
              {(r.color ? '█' : '░').repeat(r.cells)}
            </Text>
          ))}
        </Box>
      ) : (
        <Svg source={svgStack(v.slices, 420)} alt="context breakdown" width={420} height={10} />
      )
      lines.push(line(' ', [stack]))
      lines.push(
        line('  ', [
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {v.slices.map(x => (
              <Text>
                <Text color={x.color}>■ </Text>
                <Text dimColor>{x.name} </Text>
                {short(x.tokens)}
                <Text dimColor>{` ${pct(x.share)}`}</Text>
              </Text>
            ))}
          </Box>,
        ]),
      )
    }
  }
  return lines
}

// The chips as one line of colored text: for the terminal's few rows above a question dialog, and for a band too
// narrow for the chips; there a turn in progress shows its time.
function questionLine(ui: any, v: View, working?: Work & { elapsed: number }) {
  const { Text } = ui
  const parts: unknown[] = []
  const dim = (s: string) => parts.push(<Text dimColor>{s}</Text>)
  const num = (s: string, color?: string) => parts.push(<Text color={color}>{s}</Text>)
  const gap = () => parts.length && dim('  ')
  if (v.plan?.five) {
    dim('5h ')
    num(`${v.plan.five.percent}%`, v.plan.five.color)
    if (v.plan.five.reset) dim(` ↻${v.plan.five.reset}`)
  }
  if (v.plan?.seven) {
    dim(' · 7d ')
    num(`${v.plan.seven.percent}%`, v.plan.seven.color)
  }
  if (v.ctx) {
    gap()
    num(`${v.ctx.icon} `, v.ctx.color)
    num(`${v.ctx.used}/${v.ctx.window} `)
    num(`${v.ctx.percent}%`, v.ctx.color)
  }
  if (v.cache) {
    gap()
    num('❄ ', v.cache.color)
    num(v.cache.text, v.cache.isCold ? v.cache.color : undefined)
  }
  if (v.model) {
    gap()
    num(v.model.name, v.model.color)
    if (v.model.effort) dim(` · ${v.model.effort}`)
  }
  if (working) {
    gap()
    num('⏳ ', C.yellow)
    num(mmss(working.elapsed))
  }
  if (v.agents) {
    gap()
    dim('subagent ')
    num(String(v.agents), C.cyan)
  }
  return parts.length ? <Text>{parts}</Text> : undefined
}

// The terminal's breakdown bar as runs of cells: each category its share of `n`, at least one cell, then free space (no color).
export function stackCells(list: View['slices'], n: number) {
  const runs = list.map(s => ({ color: s.color as string | undefined, cells: Math.max(1, Math.round((s.share / 100) * n)) }))
  const used = runs.reduce((a, r) => a + r.cells, 0)
  return used < n ? [...runs, { color: undefined, cells: n - used }] : runs
}

// The categories with their colors and their share of the whole window.
export function slices(list: Slice[], window: number) {
  let next = 0
  return list.map(x => ({ ...x, share: (x.tokens / window) * 100, color: x.name === 'messages' ? MESSAGES : SLICE_COLORS[next++ % SLICE_COLORS.length]! }))
}

export function svgStack(list: View['slices'], w: number) {
  let x = 0
  const rects = list
    .map(s => {
      const width = Math.max(1, (s.share / 100) * w)
      const r = `<rect x="${x.toFixed(1)}" y="1" width="${width.toFixed(1)}" height="8" fill="${s.color}"/>`
      x += width
      return r
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="10" viewBox="0 0 ${w} 10"><rect x="0" y="1" width="${w}" height="8" rx="2" fill="${C.marker}" fill-opacity="0.18"/>${rects}</svg>`
}

export function svgBar(b: Bar, w: number) {
  const fill = b.percent > 0 ? Math.max(3, Math.round((clamp(b.percent) / 100) * w)) : 0
  const marker = b.marker === undefined ? '' : `<rect x="${Math.min(w - 1.5, (b.marker / 100) * w).toFixed(1)}" y="0" width="1.5" height="8" fill="${C.marker}"/>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="8" viewBox="0 0 ${w} 8">` +
    `<rect x="0" y="1" width="${w}" height="6" rx="3" fill="${b.color}" fill-opacity="0.22"/>` +
    (fill ? `<rect x="0" y="1" width="${fill}" height="6" rx="3" fill="${b.color}"/>` : '') +
    marker +
    `</svg>`
  )
}

function textBar(percent: number, cells: number) {
  const full = Math.round((clamp(percent) / 100) * cells)
  return '▰'.repeat(full) + '▱'.repeat(cells - full)
}

// What a tool call is, briefly: Read register.tsx, Bash npm test, WebFetch example.com.
export function itemLabel(e: Record<string, unknown>) {
  const tool = String(e.tool ?? 'tool')
  const str = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
  const base = (p: string) => p.split(/[\\/]/).pop() || p
  let what = ''
  if (str('file_path')) what = base(str('file_path'))
  else if (str('command')) what = cut(redact(str('command')).replace(/\s+/g, ' '), 24)
  else if (str('url')) what = str('url').replace(/^https?:\/\//, '').split('/')[0]!.replace(/^[^@]*@/, '')
  else if (str('pattern')) what = cut(redact(str('pattern')), 20)
  else if (str('description')) what = cut(redact(str('description')), 20)
  return what ? `${tool} ${what}` : tool
}

// A shell word: quoted, or up to the next space or quote.
const WORD = String.raw`("[^"]*"|'[^']*'|[^\s"']+)`
const SECRET_NAME = String.raw`(?:[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Z0-9_]*|[A-Z0-9_]+_PAT)` // GH_PAT, not PATH
const HIDDEN = '***'
const SECRETS: [RegExp, string][] = [
  // a header value runs to its closing quote or the end of the line: "Authorization: Bearer x", 'X-Api-Key: x';
  // a *-token name needs a space after its colon, so https://x-access-token:...@ is left to the URL rule
  [/((?:authorization\s*:|[a-z0-9-]+-(?:key|token|secret)\s*:(?=\s))\s*)[^"'\r\n]+/gi, `$1${HIDDEN}`],
  [/\b(bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, `$1${HIDDEN}`],
  // --token x, --api-key=x, and PowerShell's -Token x / -ApiKey x
  [new RegExp(String.raw`(\s--?(?:password|passwd|token|api-?key|secret|client-?secret)(?:=|:|\s+))` + WORD, 'gi'), `$1${HIDDEN}`],
  // API_TOKEN=x, export GH_PAT=x, $env:API_KEY = 'x'; upper case only, so path=x or monkey=x stay
  [new RegExp(String.raw`\b(` + SECRET_NAME + String.raw`\s*=\s*)` + WORD, 'g'), `$1${HIDDEN}`],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]*:)[^\s/@'"]+@/gi, `$1${HIDDEN}@`],
  [new RegExp(String.raw`(\s(?:-u|--user)(?:=|\s+))("[^"]*:[^"]*"|'[^']*:[^']*'|[^\s"':]*:[^\s"']+)`, 'g'), `$1${HIDDEN}`],
  // well-known token shapes passed as bare arguments
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[A-Z0-9]{16})\b/g, HIDDEN],
]

// Hides what looks like a credential before a command is shown; a best effort, not a guarantee.
export function redact(s: string) {
  return SECRETS.reduce((out, [pattern, to]) => out.replace(pattern, to), s)
}

// Tokens of a tool result, from its length: about four characters a token. A picture or a PDF that Read
// returns is counted as the model is billed for it, not by the length of its base64.
export function estimate(result: unknown) {
  const media = mediaTokens((result as { result?: unknown } | undefined)?.result)
  if (media !== undefined) return media
  try {
    return Math.round((JSON.stringify(result) ?? '').length / 4)
  } catch {
    return 0
  }
}

// Read's picture, PDF and PDF-as-pictures records: a picture costs one token per 28 x 28 pixel patch, a PDF
// page its text and its picture (platform.claude.com vision and pdf-support docs). Undefined for anything else.
type MediaRead = { type?: string; file?: { base64?: string; count?: number; dimensions?: Record<string, number | undefined> } }
function mediaTokens(r: unknown) {
  const { type, file } = (r ?? {}) as MediaRead
  if (type === 'image') {
    const d = file?.dimensions ?? {}
    const w = d.displayWidth ?? d.originalWidth
    const h = d.displayHeight ?? d.originalHeight
    return w && h ? Math.min(PICTURE_MAX, Math.ceil(w / 28) * Math.ceil(h / 28)) : PICTURE_TOKENS
  }
  if (type === 'pdf') return pdfPages(file?.base64 ?? '') * (PAGE_TEXT_TOKENS + PICTURE_TOKENS)
  if (type === 'parts') return (file?.count ?? 1) * PICTURE_TOKENS
  return undefined
}

// shortcut: counts page objects in the raw file, so a PDF that packs them in compressed object streams counts as one page; parse the page tree if that matters
export function pdfPages(base64: string) {
  try {
    return Math.max(1, atob(base64).match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 0)
  } catch {
    return 1
  }
}

export function largest(items: Item[], n: number) {
  return [...items].sort((a, b) => b.tokens - a.tokens).slice(0, n).filter(i => i.tokens >= 500)
}

// What the tool returned, for hashing: the result itself, not the envelope around it.
function resultText(result: unknown) {
  const r = result as { result?: unknown; text?: unknown } | undefined
  try {
    return JSON.stringify(r?.result ?? r?.text ?? r) ?? ''
  } catch {
    return ''
  }
}

// FNV-1a, 32 bits: enough to tell two outputs apart within a session.
export function fnv(text: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// Between a turn's first and last request the input grew by the outputs before the last and the tool results;
// a turn with one request, or a compaction in it, measures nothing.
export function turnSample(t: Steps, est: number): Sample | undefined {
  if (t.compacted || t.count < 2 || t.first === undefined || t.last === undefined) return undefined
  return { growth: t.last - t.first - (t.outputs - t.lastOutput), est }
}

// k over the kept turns, summed so a large turn weighs more: within 0.5 to 2, undefined with nothing to go on.
export function calibrate(list: readonly Sample[]) {
  const ok = list.filter(x => x.est >= MIN_SAMPLE_EST && x.growth > 0)
  const est = ok.reduce((a, x) => a + x.est, 0)
  if (!est) return undefined
  return Math.min(K_MAX, Math.max(K_MIN, ok.reduce((a, x) => a + x.growth, 0) / est))
}

// A Read against the last read of the same range of the same file; only 'unchanged' is waste.
export function readKind(prior: Seen | undefined, editedAt: number, now: number, hash: number): ReadKind {
  if (!prior) return 'first'
  if (editedAt > prior.seq) return 'after-edit'
  if (prior.epoch !== now) return 'after-compaction'
  if (prior.hash !== hash) return 'changed'
  return 'unchanged'
}

// Edited files the compacted conversation no longer names, by file name, in its text or its tool calls.
export function lostFiles(paths: readonly string[], messages: readonly { text: string; toolUses?: readonly unknown[] }[]) {
  const kept = messages.map(m => `${m.text}\n${JSON.stringify(m.toolUses ?? [])}`).join('\n')
  return paths.filter(p => !kept.includes(fileName(p)))
}

// A tip for an output that cost more than it had to; tokens already scaled.
export function advice(e: Record<string, unknown>, label: string, tokens: number): Advice | undefined {
  const tool = String(e.tool ?? '')
  if (tool === 'Read' && e.offset === undefined && e.limit === undefined && !MEDIA_FILE.test(String(e.file_path ?? '')) && tokens >= LARGE_READ) {
    return { key: 'large-read', text: `큰 파일 통째 읽기: ${label} ≈${short(tokens)} · offset/limit로 필요한 부분만 읽으면 줄어듭니다` }
  }
  if (tool === 'Bash' && tokens >= LARGE_OUTPUT) return { key: 'large-bash', text: `긴 명령 출력: ${label} ≈${short(tokens)} · head/tail/grep으로 줄이면 됩니다` }
  if ((tool === 'Agent' || tool === 'Task') && tokens >= LARGE_OUTPUT) return { key: 'large-agent', text: `긴 subagent 결과: ${label} ≈${short(tokens)} · 요약만 돌려 달라고 하면 줄어듭니다` }
  return undefined
}

// The plugin whose own hook answered with the drop, from next.trace; undefined for the engine's own drop
// (a settings hook's block, a Stop) or a trace that does not say.
export function droppedBy(trace: readonly { plugin: string; outcome: string; returned?: unknown }[]) {
  const entry = trace.find(t => t.outcome === 'returned' && (t.returned as { drop?: unknown } | undefined)?.drop !== undefined)
  return entry && entry.plugin !== 'engine' ? entry.plugin : undefined
}

// The hold cache-tax's drop promises ("keepwarm will then hold the cache for 3h00m"), in the form /keepwarm takes.
export function keepwarmHold(reason: string) {
  return /hold the cache for (\d+h\d{2}m|\d+m)\b/.exec(reason)?.[1]
}

// MCP servers whose loaded tools hold a sizeable share of the window and that this session never called.
export function unusedServers(tools: readonly McpTool[], called: ReadonlySet<string>) {
  const by: Record<string, number> = {}
  for (const t of tools) if (t.isLoaded) by[t.serverName] = (by[t.serverName] ?? 0) + t.tokens
  return Object.entries(by)
    .filter(([server, tokens]) => tokens >= UNUSED_MCP && !called.has(serverKey(server)))
    .map(([server, tokens]) => ({ server, tokens }))
    .sort((a, b) => b.tokens - a.tokens)
}

// A tool as the per-tool line counts it: an MCP tool by its server (mcp__rea__open_binary → mcp__rea).
export function toolKey(tool: string) {
  return tool.startsWith('mcp__') ? tool.split('__').slice(0, 2).join('__') : tool
}

// mcp__claude_ai_Gmail__x and "claude.ai Gmail" name the same server.
function serverKey(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

// claude-opus-5-5 → Opus 5.5, claude-haiku-4-5-20251001 → Haiku 4.5, claude-sonnet-4-6[1m] → Sonnet 4.6 1M.
export function modelName(id: string) {
  const m = /(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  const wide = /\[1m\]/i.test(id) ? ' 1M' : ''
  if (!m) return id.replace(/^claude-/, '').slice(0, 16)
  return `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1).toLowerCase()} ${m[2]}${m[3] ? `.${m[3]}` : ''}${wide}`
}

function fileName(p: string) {
  return p.split(/[\\/]/).pop() || p
}

// The share of input read from the cache; a request that wrote more than it read re-cached the prefix.
export function hitRate(c: Snapshot['cache'], u: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }) {
  const read = u.cache_read_input_tokens ?? 0
  const wrote = u.cache_creation_input_tokens ?? 0
  const total = (u.input_tokens ?? 0) + read + wrote
  const isRewrite = c.steps > 0 && wrote > read
  return { read: c.read + read, total: c.total + total, rewrites: c.rewrites + (isRewrite ? 1 : 0), steps: c.steps + 1 }
}

// Turns until auto-compaction at the recent pace; undefined without a line or growth.
export function turnsLeft(s: Pick<Snapshot, 'compactsAt' | 'tokens' | 'deltas'>) {
  const growth = average(s.deltas)
  if (!s.compactsAt || s.tokens === undefined || !growth) return undefined
  return Math.max(0, Math.ceil((s.compactsAt - s.tokens) / growth))
}

function average(deltas: number[]) {
  const grew = deltas.filter(d => d > 0)
  return grew.length ? grew.reduce((a, b) => a + b, 0) / grew.length : 0
}

// Usage against the share of the window already gone.
export function pace(used: number, elapsed: number) {
  if (used <= elapsed * 0.8) return '여유'
  if (used <= elapsed * 1.1) return '적정'
  return '과속'
}

// Where the window ends at the pace so far: " · 이 속도면 리셋 때 ~61%", or when it hits 100% first.
export function forecastText(used: number, elapsed: number, resetMs: number, now: number) {
  if (elapsed < 10 || used <= 0) return '' // too early to tell
  const projected = (used / elapsed) * 100
  if (projected < 100) return ` · 이 속도면 리셋 때 ~${Math.round(projected)}%`
  const windowLeft = resetMs - now
  const windowTotal = windowLeft / (1 - elapsed / 100)
  const fullAt = now + ((100 - used) / used) * (windowTotal - windowLeft)
  return ` · 이 속도면 ${clock(fullAt)}에 100%`
}

// Where the 5h window ends at the pace of the last hour's readings, which a window-long average hides: a busy
// last hour after a quiet start. Needs at least 10 minutes of readings and some growth.
export function recentForecast(list: readonly Reading[], now: number, resetMs: number) {
  const from = list.find(x => now - x.at <= 60 * 60_000)
  const last = list.at(-1)
  if (!from || !last || last.at - from.at < 10 * 60_000 || last.percent <= from.percent) return ''
  const rate = (last.percent - from.percent) / (last.at - from.at)
  const fullAt = last.at + (100 - last.percent) / rate
  if (fullAt < resetMs) return ` · 최근 1시간 속도면 ${clock(fullAt)}에 100%`
  return ` · 최근 1시간 속도면 리셋 때 ~${Math.round(last.percent + rate * (resetMs - last.at))}%`
}

// Redraws each minute for the reset countdown, and for the cache every 15 s, every second in its last two minutes.
function shouldRedraw(s: Snapshot, now: number) {
  const sec = Math.floor(now / 1000)
  if (sec % 60 === 0) return true
  if (s.lastRequestAt === undefined) return false
  const left = s.lastRequestAt + cfg.cacheTtlMs - now
  if (left <= -1000) return false // already drawn cold
  return left <= FAST_BELOW_MS || sec % 15 === 0
}

export function levelColor(percent: number) {
  if (percent >= 90) return C.red
  if (percent >= 75) return C.yellow
  return C.green
}

export function countdown(ms: number) {
  const minutes = Math.max(0, Math.ceil(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${String(minutes % 60).padStart(2, '0')}`
  return `${Math.floor(hours / 24)}d${hours % 24}h`
}

function mmss(ms: number) {
  const sec = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

// Local wall-clock time: 오후 3:52
function clock(ms: number) {
  const d = new Date(ms)
  const h = d.getHours()
  return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Local date and time: 10/26(일) 09:00
function day(ms: number) {
  const d = new Date(ms)
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${d.getMonth() + 1}/${d.getDate()}(${'일월화수목금토'[d.getDay()]}) ${hhmm}`
}

// Local calendar date: 2026-10-22
export function dateKey(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function pct(share: number) {
  return share < 0.1 ? '<0.1%' : `${Math.round(share * 10) / 10}%`
}

function clamp(p: number) {
  return Math.min(100, Math.max(0, p))
}

export function short(n: number) {
  const one = (x: number) => String(Math.round(x * 10) / 10)
  if (n >= 1_000_000) return `${one(n / 1_000_000)}M`
  if (n >= 100_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${one(n / 1000)}k`
  return String(n)
}
