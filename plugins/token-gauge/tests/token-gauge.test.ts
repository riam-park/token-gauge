import { describe, expect, mock, test } from 'claude-code/testing'

import { configure, fit, forecastText, handoffText, hitRate, itemLabel, largest, pace, slices, sumDays, svgBar, text, turnsLeft, view } from '../hooks/register'
import type { Snapshot } from '../hooks/register'

const NOW = Date.parse('2026-10-22T00:00:00Z')
const MIN = 60_000
const at = (ms: number) => new Date(NOW + ms).toISOString()

const calm: Snapshot = {
  limits: [
    { kind: 'five_hour', percentUsed: 5, resetsAt: at(172 * MIN) },
    { kind: 'seven_day', percentUsed: 38, resetsAt: at(3 * 24 * 60 * MIN) },
  ],
  costUsd: 1.27,
  tokens: 113_000,
  window: 1_000_000,
  compactsAt: 967_000,
  slices: [
    { name: 'system prompt', tokens: 9700 },
    { name: 'messages', tokens: 45_000 },
  ],
  deltas: [1000, 1500, 1300],
  lastRequestAt: NOW - 54_000,
  top: [{ label: 'Read register.tsx', tokens: 18_000 }],
  cache: { read: 940, total: 1000, rewrites: 0, steps: 4 },
  today: { sessions: 3, usd: 4.8, input: 1_900_000, output: 84_000 },
}
const detail = (s: Snapshot, label: string) => view(s, NOW, true).detail.find(d => d.label === label)?.text

describe('token-gauge', () => {
  test('calm: three chips, forecast clear, cache blue', () => {
    const v = view(calm, NOW, true)
    expect(text(v)).toBe('[plan 5h 5% ▰▱ ↻2h52 · 7d 38% ↻3d0h · $1.27]  [☀ context ▰▱ 113k / 1M 11% · ▲1.3k · ≈ 675턴]  [❄ 59:06]')
    expect(v.ctx).toMatchObject({ color: '#6CC88A', offerActions: false })
    expect(v.cache?.offerKeep).toBe(false)
    expect(Math.round((v.plan?.five?.bar.marker ?? 0) * 10)).toBe(427) // 2h08 of 5h gone
  })

  test('detail panel lines', () => {
    expect(detail(calm, '5h')).toContain('→ 여유 · 이 속도면 리셋 때 ~12%')
    expect(detail(calm, '7d')).toMatch(/^리셋 .+ \(3d0h\) · 이 속도면 리셋 때 ~66%$/)
    expect(detail(calm, '오늘')).toBe('$4.80 · 세션 3개 · 입력 1.9M / 출력 84k')
    expect(detail(calm, 'context')).toBe('compact까지 854k · 최근 평균 +1.3k/턴')
    expect(detail(calm, '지난 턴')).toBe('큰 결과: Read register.tsx 18k')
    expect(detail(calm, '캐시')).toContain('적중률 94% · 재기록 0회')
    expect(view(calm, NOW, true).slices.map(x => x.color)).toEqual(['#6AA9F0', '#F59E4B']) // messages keep their own color
  })

  test('plan chip takes its color from 7d alone', () => {
    const s = { ...calm, limits: [{ ...calm.limits[0]!, percentUsed: 93 }, calm.limits[1]!] }
    const v = view(s, NOW, false)
    expect(v.plan?.color).toBe('#6CC88A')
    expect(v.plan?.five?.color).toBe('#EF5F5F')
  })

  test('warning: violet forecast, keep button under 10 minutes', () => {
    const s: Snapshot = { ...calm, tokens: 660_000, deltas: [24_000], lastRequestAt: NOW - 52 * MIN }
    const v = view(s, NOW, true)
    expect(v.ctx).toMatchObject({ icon: '☂', offerActions: false }) // 68% of the compact line
    expect(view({ ...s, tokens: 680_000 }, NOW, true).ctx).toMatchObject({ offerActions: true }) // 70%
    expect(v.cache).toMatchObject({ text: '8:00', offerKeep: true, color: '#E8C547' })
    expect(view(s, NOW, false).cache?.offerKeep).toBe(false) // no cache-tax, no button
  })

  test('danger: compact soon with buttons, cache cold with the rewrite size', () => {
    const s: Snapshot = { ...calm, tokens: 905_000, deltas: [20_000], lastRequestAt: NOW - 2 * 60 * MIN }
    const v = view(s, NOW, true)
    expect(v.ctx).toMatchObject({ icon: '↯', offerActions: true })
    expect(v.cache).toMatchObject({ text: 'cold', isCold: true, rewrite: '재기록 ~905k', offerKeep: false })
  })

  test('narrow: drops extras, then cost, then 7d', () => {
    const v = view(calm, NOW, false)
    expect(text(fit(v, 200))).toBe(text(v))
    expect(text(fit(v, 114))).toBe('[plan 5h 5% ▰▱ ↻2h52 · 7d 38% ↻3d0h · $1.27]  [☀ context ▰▱ 113k / 1M 11%]  [❄ 59:06]')
    expect(text(fit(v, 93))).toBe('[plan 5h 5% ▰▱ ↻2h52]  [☀ context ▰▱ 113k / 1M 11%]  [❄ 59:06]')
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`mounts the band (${surface})`, async ($: any, on: any) => {
      mock.clock(on, { now: NOW })
      on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
      on('session.usage', () => ({
        value: {
          startedAt: NOW,
          context: {
            tokens: 113_000,
            window: 1_000_000,
            breakdown: {
              rawMaxTokens: 1_000_000,
              totalTokens: 113_000,
              autoCompactThreshold: 967_000,
              isAutoCompactEnabled: true,
              percentage: 11,
              categories: [
                { name: 'System prompt', tokens: 9700, color: 'x', kind: 'used' },
                { name: 'Free space', tokens: 850_000, color: 'x', kind: 'free' },
              ],
            },
          },
          rateLimits: calm.limits,
          cost: { usd: 1.27 },
        },
      }))
      on('ui.render', ($$: any, e: any) => $$.ui.resolve(e).Text({ children: 'engine band' }))
      await $.session.start({ surface, isInteractive: true, cwd: '/work' })
      const ui = await $.ui.mount({ plugin: 'token-gauge', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 } })
      expect(await ui.find({ type: 'Text', text: '☀' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined() // stacked, not replaced
      expect(Boolean(await ui.find({ type: 'Svg' }))).toBe(surface === 'desktop')
      expect(await ui.find({ type: 'Button', label: '▾ 상세' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^리셋/ })).toBeUndefined() // closed until pressed
      await ui.unmount()
    })
  }

  test('install options', () => {
    expect(configure({})).toEqual({ cacheTtlMs: 3_600_000, actionsAt: 70, showCost: true, alerts: true, handoffDir: '.temp' })
    expect(configure({ actionsAt: 200, handoffDir: '  ' })).toMatchObject({ actionsAt: 70, handoffDir: '.temp' }) // odd values keep defaults
    configure({ cacheTtl: '5m', actionsAt: 80, showCost: false, handoffDir: 'notes/' })
    const v = view(calm, NOW, true)
    expect(v.cache?.text).toBe('4:06') // 5 minutes from the last request
    expect(v.plan?.cost).toBeUndefined()
    expect(detail(calm, '오늘')).toBe('세션 3개 · 입력 1.9M / 출력 84k')
    expect(view({ ...calm, tokens: 700_000 }, NOW, true).ctx?.offerActions).toBe(false) // 72% < 80%
    expect(handoffText('notes')).toContain('`notes/<YYMMDD>_<task>/PROMPT_<작업 내용>.md`')
    configure({})
  })

  test('helpers', () => {
    expect(turnsLeft({ ...calm, deltas: [] })).toBeUndefined()
    expect(turnsLeft({ ...calm, deltas: [-50_000, 10_000] })).toBe(86) // shrinking turns are left out
    expect([pace(5, 43), pace(40, 43), pace(60, 43)]).toEqual(['여유', '적정', '과속'])
    expect(forecastText(5, 5, NOW + MIN, NOW)).toBe('') // too early to tell
    expect(forecastText(60, 50, NOW + 150 * MIN, NOW)).toMatch(/에 100%$/)
    expect(sumDays([{ usd: 1, input: 10, output: 1 }, { usd: 2.5, input: 5, output: 2 }])).toEqual({ usd: 3.5, input: 15, output: 3 })
    expect(itemLabel({ tool: 'Read', file_path: 'C:\\a\\b\\register.tsx' })).toBe('Read register.tsx')
    expect(itemLabel({ tool: 'Bash', command: 'claude  plugin test ./meter-line --verbose' })).toBe('Bash claude plugin test ./me…')
    expect(itemLabel({ tool: 'WebFetch', url: 'https://example.com/a/b' })).toBe('WebFetch example.com')
    expect(largest([{ label: 'a', tokens: 100 }, { label: 'b', tokens: 9000 }, { label: 'c', tokens: 600 }], 3).map(i => i.label)).toEqual(['b', 'c'])
    const c = hitRate(hitRate({ read: 0, total: 0, rewrites: 0, steps: 0 }, { cache_creation_input_tokens: 50_000 }), { cache_read_input_tokens: 40_000, cache_creation_input_tokens: 60_000, input_tokens: 10 })
    expect(c).toEqual({ read: 40_000, total: 150_010, rewrites: 1, steps: 2 }) // the first write is no rewrite
    expect(slices([{ name: 'a', tokens: 100 }], 1000)[0]!.share).toBe(10)
    expect(svgBar({ percent: 1, color: '#000', marker: 50 }, 48)).toContain('x="24.0"')
  })
})
