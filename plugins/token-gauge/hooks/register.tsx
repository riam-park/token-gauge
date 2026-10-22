// Token Gauge: plan usage, context and the prompt-cache countdown above the prompt, as three chips.
//   [plan 5h 5% ▰▱ ↻2h52 · 7d 38% · $1.27]  [☀ context ▰▱ 113k / 1M 11% · ▲1.3k · ≈ 600턴]  [❄ 59:06]  ▾ 상세
// Colors follow state as token-weather's forecast does; ▾ (or d with the band focused) opens a detail panel:
// reset forecasts, today's total over every session, /context's breakdown, the last turn's largest results
// and the cache hit rate. While Claude works a ⏳ chip shows the time, tool calls and running subagents.
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

// The userConfig options in plugin.json, asked at install and changed with /plugin configure or /config.
export type Config = { cacheTtlMs: number; actionsAt: number; showCost: boolean; alerts: boolean; handoffDir: string }
const DEFAULTS: Config = { cacheTtlMs: 60 * 60_000, actionsAt: 70, showCost: true, alerts: true, handoffDir: '.temp' }
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
    handoffDir: dir || DEFAULTS.handoffDir,
  }
  return cfg
}

export function handoffText(dir: string) {
  return (
    `지금까지의 작업을 인계 메모로 정리해 줘. 저장소의 \`${dir}/<YYMMDD>_<task>/PROMPT_<작업 내용>.md\`에 ` +
    '배경, 관련 파일 경로, 목표, 검증 기준, 범위 밖 항목을 쓰고 경로를 알려 줘. 새 세션에서 이 파일로 이어서 작업할 거야.'
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
// /context's categories in the detail bar; messages keep their own color, as context-bar draws them.
const SLICE_COLORS = [C.blue, C.cyan, C.violet, C.green, C.yellow, C.pink]
const MESSAGES = C.orange

type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Slice = { name: string; tokens: number }
export type Item = { label: string; tokens: number }
export type Day = { usd: number; input: number; output: number }
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
}
type Work = { since: number; tools: number; agents: number }

const empty = (): Snapshot => ({ limits: [], slices: [], deltas: [], top: [], cache: { read: 0, total: 0, rewrites: 0, steps: 0 } })
let snap: Snapshot = empty()
let timer: Timer | undefined
let hasKeepwarm = false
let showDetail = false
let work: Work | undefined // the main-thread turn in progress
let turnItems: Item[] = []
let mine: Day = { usd: 0, input: 0, output: 0 } // this session's share of today
const alerted = { fiveHour: '', ctx: false, cacheFor: 0 }

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
          if (work || shouldRedraw(snap, now)) $.ui.invalidate('ui.render')
          alert($, now)
        })
        .catch(() => {})
    })
    const usage = await $.session.usage().catch(() => null)
    if (usage) takeLimits(usage.rateLimits, usage.cost?.usd)
    await readContext($, false).catch(() => {})
    await readToday($).catch(() => {})
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
      $.ui.invalidate('ui.render')
    }
    return result
  })

  // Each model request: the cache clock restarts on the main thread; tokens count for today and the hit rate.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const u = result.usage
    if (u) {
      const input = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
      mine = { ...mine, input: mine.input + input, output: mine.output + (u.output_tokens ?? 0) }
      if (!e.agentId) snap = { ...snap, cache: hitRate(snap.cache, u) }
    }
    if (!e.agentId && result.stopReason !== null) {
      const now = await $.clock.now() // before the spread, so an update during the await is kept
      snap = { ...snap, lastRequestAt: now }
      $.ui.invalidate('ui.render')
    }
    return result
  })

  // Counts every tool call of the turn, and sizes the main thread's results for the largest-items line.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (work) work = { ...work, tools: work.tools + 1 }
    if (!(e as { agentId?: string }).agentId) turnItems.push({ label: itemLabel(e as Record<string, unknown>), tokens: estimate(result) })
    return result
  }).catch(async ($, e, next) => next(e)) // observer only: never stands in the way of a tool

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result // a subagent's turn fills its own window
    work = undefined
    snap = { ...snap, top: largest(turnItems, TOP) }
    await readContext($, true).catch(() => {})
    await saveToday($).catch(() => {})
    // cache-tax registers /keepwarm at its own session start; by the first turn it is there or not
    if (!hasKeepwarm) hasKeepwarm = JSON.stringify(await $.command.list().catch(() => [])).includes('"keepwarm"')
    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    void readContext($, false).catch(() => {}) // a compaction empties the window without a turn ending
    return result
  }).catch(async ($, e, next) => next(e)) // observer only: never stands in the way of a compaction

  // A /clear or a resume leaves the old conversation, and its cache, behind.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') snap = { ...empty(), limits: snap.limits, costUsd: snap.costUsd, today: snap.today }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    const now = await $.clock.now()
    const v = fit(view(snap, now, hasKeepwarm), e.props.bodyColumns - 2)
    if (!v.plan && !v.ctx && !v.cache) return rest
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
        $.prompt.submit({ text: handoffText(cfg.handoffDir), asUser: true }).catch(() => $.ui.toast('Claude가 작업 중이라 보내지 못했습니다'))
      },
      toggle: () => {
        showDetail = !showDetail
        if (showDetail) void readToday($).then(() => $.ui.invalidate('ui.render'))
        $.ui.invalidate('ui.render')
      },
    }
    const working = e.props.isWorking && work ? { ...work, elapsed: now - work.since } : undefined
    // A survey (a question in the band) keeps the chip row, without buttons or the detail panel, so the question keeps the room
    const band = draw($.ui.resolve(e), v, e.surface === 'terminal', act, working, e.props.hasSurvey)
    return { type: 'Box', props: { flexDirection: 'column' }, children: rest ? [band, rest] : [band] }
  })
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
  const delta = isTurn && snap.tokens !== undefined ? tokens - snap.tokens : undefined
  const deltas = delta === undefined ? snap.deltas : [...snap.deltas, delta].slice(-DELTAS)
  const slices = b ? b.categories.filter(x => x.kind === 'used' && x.tokens > 0).map(x => ({ name: x.name.toLowerCase(), tokens: x.tokens })) : snap.slices
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
  if (s.top.length) {
    v.detail.push({ label: '지난 턴', text: `큰 결과: ${s.top.map(i => `${i.label} ${short(i.tokens)}`).join(' · ')}` })
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

// Drops the extras, then the cost, then 7d, until the line fits.
export function fit(v: View, columns: number): View {
  const steps: ((x: View) => View)[] = [
    x => (x.ctx ? { ...x, ctx: { ...x.ctx, turns: undefined, delta: undefined } } : x),
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
  else if (str('command')) what = cut(str('command').replace(/\s+/g, ' '), 24)
  else if (str('url')) what = str('url').replace(/^https?:\/\//, '').split('/')[0]!
  else if (str('pattern')) what = cut(str('pattern'), 20)
  else if (str('description')) what = cut(str('description'), 20)
  return what ? `${tool} ${what}` : tool
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
