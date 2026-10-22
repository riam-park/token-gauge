// Token Gauge: plan usage, context and the prompt-cache countdown above the prompt, as three chips.
//   [plan 5h 5% ▰▱ ↻2h52 · 7d 38% · $1.27]  [☀ context ▰▱ 113k / 1M 11% · ▲1.3k · ≈ 600턴]  [❄ 59:06]  ▾ 상세
// Colors follow state as token-weather's forecast does; ▾ (or d with the band focused) opens a detail panel:
// reset forecasts, today's total over every session, /context's breakdown, the last turn's largest results,
// unchanged re-reads and repeated outputs, what a compaction dropped and the cache hit rate. A fourth chip
// shows the model and its effort. While Claude works a ⏳ chip shows the time, tool calls and running subagents.
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
const QUESTION_COLUMNS = 100 // a site with no measured width
const REFRESH_TICKS = 3 // seconds between context reads while Claude works
const PERSON = new Set(['composer', 'bridge']) // prompt origins someone is there to ask about
const SEND_AGAIN = '다시 보내기'
const PUT_BACK = '취소'
const QUESTION_LINE = 80 // the terminal's line above a question: two of its 40-column rows

// The userConfig options in plugin.json, asked at install and changed with /plugin configure or /config.
// handoffDir '' asks for the handoff memo in the answer; a folder asks for a PROMPT file there.
// below: on the desktop, the chips go under the prompt as one line of text (desktopPlace 'below') rather than above it (the default).
export type Config = { cacheTtlMs: number; actionsAt: number; showCost: boolean; alerts: boolean; handoffDir: string; below: boolean }
const DEFAULTS: Config = { cacheTtlMs: 60 * 60_000, actionsAt: 70, showCost: true, alerts: true, handoffDir: '', below: false }
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
    below: o.desktopPlace === 'below',
  }
  return cfg
}

// `lost`: files edited this session that the last compaction's summary no longer names.
export function handoffText(dir: string, lost: readonly string[] = []) {
  const parts = '배경, 관련 파일 경로, 목표, 검증 기준, 범위 밖 항목'
  const keep = lost.length ? ` compact 요약에 빠진 편집 파일도 메모에 넣어 줘: ${lost.join(', ')}` : ''
  if (!dir) return `지금까지의 작업을 인계 메모로 정리해 줘. 파일은 만들지 말고 이 답변에 ${parts}을 써 줘. 새 세션에 이 답변을 붙여 넣어 이어서 작업할 거야.${keep}`
  return (
    `지금까지의 작업을 인계 메모로 정리해 줘. 저장소의 \`${dir}/<YYMMDD>_<task>/PROMPT_<작업 내용>.md\`에 ` +
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
export type Compaction = { before?: number; after?: number; lost: string[] }
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
}
type Bar = { percent: number; color: string; marker?: number }
export type View = {
  plan?: {
    color: string
    five?: { percent: number; color: string; bar: Bar; reset?: string }
    seven?: { percent: number; color: string; reset?: string }
    cost?: string
  }
  ctx?: { icon: string; color: string; used: string; window: string; percent: number; bar: Bar; delta?: string; turns?: string; offerActions: boolean }
  cache?: { color: string; text: string; isCold: boolean; rewrite?: string; offerKeep: boolean }
  detail: { label: string; text: string }[]
  slices: { name: string; tokens: number; color: string; share: number }[]
  model?: { name: string; effort?: string; color: string }
}
type Work = { since: number; tools: number; agents: number }
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
          if (work && tick % 2 === 0) {
            const agents = await $.agent.list().catch(() => [])
            work = work && { ...work, agents: agents.filter(a => a.status === 'running').length }
          }
          // while Claude works the context grows request by request and result by result: read it again
          if (work && tick % REFRESH_TICKS === 0) await readContext($, false).catch(() => {})
          if (work || shouldRedraw(snap, now)) $.ui.invalidate('ui.render')
          alert($, now)
        })
        .catch(() => {})
    })
    const usage = await $.session.usage().catch(() => null)
    if (usage) takeLimits(usage.rateLimits, usage.cost?.usd)
    const model = await $.session.model().catch(() => '')
    if (model && !snap.model) snap = { ...snap, model }
    await readContext($, false).catch(() => {})
    await readToday($).catch(() => {})
    if (e.isInteractive && cfg.alerts) void checkUpdate($).catch(() => {}) // offline or blocked: no toast
    return result
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    takeLimits(e.rateLimits, e.cost?.usd)
    if (e.cost) mine = { ...mine, usd: e.cost.usd }
    $.ui.invalidate('ui.render')
    return result
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      work = { since: await $.clock.now(), tools: 0, agents: 0 }
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
    if (!(e as { agentId?: string }).agentId) {
      const input = e as Record<string, unknown>
      const label = itemLabel(input)
      const tokens = estimate(result)
      turnItems.push({ label, tokens })
      observe($, input, label, tokens, fnv(resultText(result)))
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
      snap = { ...snap, compaction: { before: result.tokensBefore, after: result.tokensAfter, lost: lostFiles([...edited], result.messages) } }
    }
    void readContext($, false).catch(() => {})
    return result
  }).catch(async ($, e, next) => next(e)) // observer only: never stands in the way of a compaction

  // A switch shows at once; the effort is known again at the next request.
  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
    snap = { ...snap, model: e.to_model, effort: undefined }
    $.ui.invalidate('ui.render')
    return result
  })

  // A prompt the person sent that another plugin's hook dropped (cache-tax on a cold cache, say): a question card
  // offers to send it again or to put it back in the box. Asked after the drop is returned, holding nothing up.
  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    if (result.drop !== undefined && !e.command && !e.isMeta && PERSON.has(e.origin.kind)) {
      const by = droppedBy(next.trace)
      if (by) void askDropped($, e.text, by, result.drop).catch(() => {})
    }
    return result
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

  // The band above the prompt; on the desktop with desktopPlace 'below', under the prompt instead.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    if (e.surface === 'desktop' && cfg.below) return rest
    // A survey (a question in the band) keeps the chip row, without buttons or the detail panel, so the question keeps the room
    const band = await bandTree($, $.ui.resolve(e), e.surface === 'terminal', e.props.bodyColumns - 2, e.props.isWorking ? 'working' : 'idle', e.props.hasSurvey)
    if (!band) return rest
    return { type: 'Box', props: { flexDirection: 'column' }, children: rest ? [band, rest] : [band] }
  })

  // Under the prompt, after the engine's hint: the desktop draws this site one line high and clips the rest,
  // so the chips are one line of text there, without borders, buttons or the detail panel.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const rest = await next(e)
    if (e.surface !== 'desktop' || !cfg.below) return rest
    const line = questionLine($.ui.resolve(e), fit(view(snap, await $.clock.now(), false), (e.viewport?.columns ?? QUESTION_COLUMNS) - 2))
    if (!line) return rest
    return { type: 'Box', props: { flexDirection: 'row', gap: 2 }, children: rest ? [rest, line] : [line] }
  })

  // A question dialog takes the prompt's place, the band with it: the chips stand above the question.
  // The site takes no size, so bars are text; no buttons, no detail panel and no ⏳ chip (the turn only waits).
  // The terminal allows 12 rows around the dialog, so there the chips are one line of text.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const rest = await next(e)
    if (!rest) return rest // the engine's node stands once, nothing below it
    const columns = (e.viewport?.columns ?? QUESTION_COLUMNS) - 2
    const ui = $.ui.resolve(e)
    const band = e.surface === 'terminal' ? questionLine(ui, fit(view(snap, await $.clock.now(), false), QUESTION_LINE)) : await bandTree($, ui, true, columns, 'question', true)
    if (!band) return rest
    return { type: 'Box', props: { flexDirection: 'column' }, children: [band, rest] }
  }).catch(async ($, e, next) => next(e)) // never in the way of a question
}

// The chip row (and the detail panel when open) for one site; undefined with nothing to show yet.
async function bandTree($: EngineInterface, ui: unknown, textBars: boolean, columns: number, state: 'idle' | 'working' | 'question', isYielding: boolean) {
  const now = await $.clock.now()
  const v = fit(view(snap, now, hasKeepwarm), columns)
  if (!v.plan && !v.ctx && !v.cache) return undefined
  const act = {
    keepWarm: () => {
      $.command
        .run({ command: 'keepwarm', args: '90m' })
        .then(() => $.ui.toast('cache-tax: 90분 동안 캐시를 유지합니다 · /keepwarm off로 취소'))
        .catch(() => $.ui.toast('cache-tax의 /keepwarm을 실행하지 못했습니다'))
    },
    compact: () => {
      $.command.run({ command: 'compact' }).catch(() => $.ui.toast('/compact를 실행하지 못했습니다'))
    },
    handoff: () => {
      $.prompt.submit({ text: handoffText(cfg.handoffDir, snap.compaction?.lost), asUser: true }).catch(() => $.ui.toast('Claude가 작업 중이라 보내지 못했습니다'))
    },
    toggle: () => {
      showDetail = !showDetail
      if (showDetail) void readToday($).then(() => $.ui.invalidate('ui.render')).catch(() => {})
      $.ui.invalidate('ui.render')
    },
  }
  const working = state === 'working' && work ? { ...work, elapsed: now - work.since } : undefined
  return draw(ui, v, textBars, act, working, isYielding)
}

function takeLimits(rateLimits: readonly Limit[] | undefined, costUsd: number | undefined) {
  const limits = (rateLimits ?? []).filter(w => Number.isFinite(w.percentUsed))
  snap = { ...snap, limits: limits.length ? limits : snap.limits, costUsd: costUsd ?? snap.costUsd }
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

// Send again as the plugin's own prompt, which cache-tax lets through: so the cache hold its drop promised is
// asked of /keepwarm here. Anything else (cancel, a dismissed card, text typed under Other) goes back in the box.
async function askDropped($: EngineInterface, text: string, by: string, reason: string) {
  const why = reason.startsWith(`${by}:`) ? reason.slice(by.length + 1).trimStart() : reason // the card names the plugin already
  const question = `${by} 훅이 프롬프트를 막았습니다. ${why.length > 600 ? `${why.slice(0, 599)}…` : why} ${PUT_BACK}하면 입력창에 되돌립니다. 그대로 다시 보낼까요?`
  const answer = await $.ui.ask(question, { options: [SEND_AGAIN, PUT_BACK], header: '프롬프트 차단' }).catch(() => undefined)
  if (answer === SEND_AGAIN) {
    const sent = await $.prompt.submit({ text, asUser: true })
    if (sent.drop !== undefined) {
      $.ui.toast(`다시 보낸 프롬프트도 막혔습니다: ${sent.drop}`)
      await $.prompt.fill({ text, mode: 'replace' })
      return
    }
    const hold = keepwarmHold(reason)
    if (hold && JSON.stringify(await $.command.list().catch(() => [])).includes('"keepwarm"')) await $.command.run({ command: 'keepwarm', args: hold }).catch(() => {})
    return
  }
  await $.prompt.fill({ text: answer && answer !== PUT_BACK ? answer : text, mode: 'replace' })
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
    v.plan = { color: seven ? levelColor(seven.w.percentUsed) : C.green, cost }
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
          text: `리셋 ${clock(five.resetMs)} (${countdown(five.resetMs - now)}) · 경과 ${Math.round(five.elapsed)}% 대비 사용 ${Math.round(p)}% → ${pace(p, five.elapsed)}${forecastText(p, five.elapsed, five.resetMs, now)}`,
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
    v.detail.push({ label: 'compact', text: `${size}${lost}` })
  }
  if (s.model) {
    const name = modelName(s.model)
    v.model = { name, effort: s.effort === undefined ? undefined : String(s.effort), color: FAMILY[name.split(' ')[0]!.toLowerCase()] ?? C.marker }
  }
  if (s.lastRequestAt !== undefined) {
    const expires = s.lastRequestAt + cfg.cacheTtlMs
    const left = expires - now
    const rate = s.cache.total ? ` · 적중률 ${Math.round((s.cache.read / s.cache.total) * 100)}% · 재기록 ${s.cache.rewrites}회` : ''
    if (left <= 0) {
      v.cache = { color: C.red, text: 'cold', isCold: true, rewrite: s.tokens ? `재기록 ~${short(s.tokens)}` : undefined, offerKeep: false }
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
  return chips.join('  ')
}

function width(v: View) {
  // borders, padding, the bars drawn wider than their two glyphs, the ▾ button and the compact buttons
  return [...text(v)].length + 24 + (v.ctx?.offerActions ? 32 : 0)
}

type Actions = { keepWarm: () => void; compact: () => void; handoff: () => void; toggle: () => void }

function draw(ui: any, v: View, isTerminal: boolean, act: Actions, working: (Work & { elapsed: number }) | undefined, isYielding: boolean) {
  const { Box, Text, Button, Svg } = ui
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
  const chip = (key: string, color: string, kids: unknown[]) => (
    <Box key={key} flexDirection="row" alignItems="center" gap={1} paddingX={1} borderStyle="round" borderColor={color}>
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
    chips.push(chip('token-gauge-plan', p.color, kids))
  }
  if (v.ctx) {
    const c = v.ctx
    const kids: unknown[] = [<Text color={c.color}>{c.icon}</Text>, dim('context'), bar(c.bar, 8), num(`${c.used} / ${c.window}`), num(`${c.percent}%`, c.color)]
    for (const extra of [c.delta, c.turns]) if (extra) kids.push(dim(`· ${extra}`))
    chips.push(chip('token-gauge-ctx', c.color, kids))
  }
  if (v.cache) {
    const k = v.cache
    const kids: unknown[] = [<Text color={k.color}>❄</Text>, num(k.text, k.isCold ? k.color : undefined)]
    if (k.rewrite) kids.push(dim(k.rewrite))
    if (k.offerKeep && !isYielding) kids.push(<Button key="token-gauge-keep" label="유지 90분" onPress={act.keepWarm} />)
    chips.push(chip('token-gauge-cache', k.color, kids))
  }
  if (v.model) {
    const kids: unknown[] = [<Text>{v.model.name}</Text>]
    if (v.model.effort) kids.push(dim(`· ${v.model.effort}`))
    chips.push(chip('token-gauge-model', v.model.color, kids))
  }
  if (working) {
    const kids: unknown[] = [<Text color={C.yellow}>⏳</Text>, num(mmss(working.elapsed)), dim(`· 도구 ${working.tools}`)]
    if (working.agents) kids.push(dim(`· subagent ${working.agents} 실행 중`))
    chips.push(chip('token-gauge-work', C.yellow, kids))
  }
  if (v.ctx?.offerActions && !working && !isYielding) {
    chips.push(<Button key="token-gauge-compact" label="/compact" onPress={act.compact} />)
    chips.push(<Button key="token-gauge-handoff" label="인계 메모 후 새 세션" onPress={act.handoff} />)
  }
  if (!isYielding) chips.push(<Button key="token-gauge-more" label={showDetail ? '▴ 접기' : '▾ 상세'} hotkey="d" plain dimColor onPress={act.toggle} />)

  const rows: unknown[] = [
    <Box key="token-gauge-chips" flexDirection="row" alignItems="center" gap={1}>
      {chips}
    </Box>,
  ]
  if (showDetail && !isYielding) {
    const line = (label: string, kids: unknown[]) => (
      <Box key={`token-gauge-d-${label}`} flexDirection="row" gap={1}>
        <Box width={8}>{dim(label)}</Box>
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
          line(' ', [
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
    rows.push(
      <Box key="token-gauge-detail" flexDirection="column" paddingX={1} paddingTop={1}>
        {lines}
      </Box>,
    )
  }
  return (
    <Box flexDirection="column" paddingX={1}>
      {rows}
    </Box>
  )
}

// The chips as one line of colored text, for the terminal's few rows above a question dialog and the desktop's hint line.
function questionLine(ui: any, v: View) {
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

// Tokens of a tool result, from its length: about four characters a token.
export function estimate(result: unknown) {
  try {
    return Math.round((JSON.stringify(result) ?? '').length / 4)
  } catch {
    return 0
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
  if (tool === 'Read' && e.offset === undefined && e.limit === undefined && tokens >= LARGE_READ) {
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
