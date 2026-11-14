import { describe, expect, mock, test } from 'claude-code/testing'

import { advice, calibrate, cardText, configure, keepChoices, keepPings, droppedBy, estimate, fit, fnv, footerLine, forecastText, keepSuggestionDue, hitRate, isNewer, itemLabel, keepwarmHold, koDuration, largest, latestVersion, lostFiles, modelName, pace, pdfPages, readKind, recentForecast, redact, rewriteUsd, savedUsd, slices, stackCells, sumDays, svgBar, text, toolKey, trail, turnSample, turnsLeft, unusedServers, view } from '../hooks/register'
import type { Snapshot } from '../hooks/register'

// The test runner supplies native timers; production hooks use $.clock instead.
declare const setTimeout: (callback: () => void, delay: number) => unknown
import { dateKey, register } from '../hooks/register'

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

// The engine beneath the mod in a UI test: a session, its usage and the engine's own drawing at each site.
function engine(on: any) {
  mock.clock(on, { now: NOW })
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: 113_000, window: 1_000_000 }, rateLimits: calm.limits, cost: { usd: 1.27 } } }))
  // the question dialog is core's own node (it must stand once); elsewhere a text names the site
  on('ui.render', ($$: any, e: any) => (e.component === 'AskUserQuestion' ? { type: 'engine', ref: 0 } : $$.ui.resolve(e).Text({ children: `engine ${e.component}` })))
}
const QUESTION = { tool: 'AskUserQuestion', questions: [{ question: '어느 쪽?', header: '선택', multiSelect: false, options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] }] }

describe('token-gauge', () => {
  for (const rollover of [false, true]) {
    test(`today restores saved counters and counts only new cost${rollover ? ' across midnight' : ''}`, async ($: any, on: any) => {
      const start = new Date(2026, 10, 14, 23, 59, 59).getTime()
      const clock = mock.clock(on, { now: start })
      mock.store(on, { [`day:${dateKey(start)}:s`]: { usd: 2, input: 100, output: 20 } })
      on('session.id', () => ({ value: 's' }))
      on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
      on('session.usage', () => ({ value: { context: { tokens: 100_000, window: 1_000_000 }, cost: { usd: 10 }, rateLimits: [] } }))
      on('session.measure', () => ({ changed: ['cost'] }))
      on('turn.complete', () => ({ text: '' }))
      on('command.list', () => ({ value: [] }))
      on('ui.render', ($$: any, e: any) => $$.ui.resolve(e).Text({ children: 'engine band' }))
      await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/w' })
      if (rollover) await clock.advance(2000)
      await $.session.measure({ cost: { usd: 11 } })
      await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't', reason: 'answer' })
      const ui = await $.ui.mount({ plugin: 'token-gauge', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 200 } })
      await ui.press({ key: 'token-gauge-more' })
      expect(await ui.find({ type: 'Text', text: rollover ? '$1.00 · 세션 1개 · 입력 0 / 출력 0' : '$3.00 · 세션 1개 · 입력 100 / 출력 20' })).toBeDefined()
      await ui.unmount()
    })
  }

  for (const surface of ['desktop', 'terminal'] as const) {
    test(`cache counts down every second and catches up after remount (${surface})`, async ($: any, on: any) => {
      const clock = mock.clock(on, { now: NOW + 123 })
      mock.store(on, { 'cache-request:s': NOW })
      on('session.id', () => ({ value: 's' }))
      on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
      on('session.usage', () => ({ value: { context: { tokens: 100_000, window: 1_000_000 }, rateLimits: [] } }))
      on('agent.list', () => ({ value: [] }))
      on('ui.render', ($$: any, e: any) => $$.ui.resolve(e).Text({ children: 'engine band' }))
      await $.session.start({ surface, isInteractive: false, cwd: '/w' })
      const mount = () => $.ui.mount({ plugin: 'token-gauge', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 200 } })
      let ui = await mount()
      expect((await ui.findAll({ type: 'Text' })).map((t: any) => t.text)).toContain('60:00')
      await clock.advance(1000)
      expect((await ui.findAll({ type: 'Text' })).map((t: any) => t.text)).toContain('59:59')
      await ui.unmount()
      await clock.advance(31_000)
      ui = await mount()
      expect((await ui.findAll({ type: 'Text' })).map((t: any) => t.text)).toContain('59:28')
      await clock.advance(1000)
      expect((await ui.findAll({ type: 'Text' })).map((t: any) => t.text)).toContain('59:27')
      await ui.unmount()
    })
  }

  test('cache time starts at the request, not at the end of a long response', async ($: any, on: any) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    on('session.id', () => ({ value: 's' }))
    let finish!: () => void
    const response = new Promise<void>(resolve => { finish = resolve })
    on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
    on('session.usage', () => ({ value: { context: { tokens: 100_000, window: 1_000_000 }, rateLimits: [] } }))
    on('ui.render', ($$: any, e: any) => $$.ui.resolve(e).Text({ children: 'engine band' }))
    on('turn.step', async function* (engine$: any, e: any) {
      await response
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { cache_read_input_tokens: 100_000 } }
    })
    await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/w' })
    const pending = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1 }).next()
    await clock.settle()
    await clock.advance(5000)
    finish()
    await pending
    const ui = await $.ui.mount({ plugin: 'token-gauge', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 200 } })
    expect(await ui.find({ type: 'Text', text: '59:55' })).toBeDefined()
    await ui.unmount()
  })

  test('resume restores that conversation cache without resetting its age', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    mock.store(on, { 'cache-request:s': NOW - 54 * MIN, 'cache-request:other': NOW - 20 * MIN })
    on('session.id', () => ({ value: 's' }))
    on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
    on('session.end', (_$: any, e: any) => ({ sessionId: e.sessionId }))
    on('classic.SessionStart', () => ({}))
    on('session.usage', () => ({ value: { context: { tokens: 100_000, window: 1_000_000 }, rateLimits: [] } }))
    on('ui.render', ($$: any, e: any) => $$.ui.resolve(e).Text({ children: 'engine band' }))
    await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/w' })
    await $.session.end({ reason: 'resume', sessionId: 's' })
    await $.classic.SessionStart({ session_id: 'other', source: 'resume', cwd: '/w', transcript_path: '', permission_mode: 'default' })
    const ui = await $.ui.mount({ plugin: 'token-gauge', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 200 } })
    expect(await ui.find({ type: 'Text', text: '40:00' })).toBeDefined()
    await ui.unmount()
  })

  test('calm: three chips, forecast clear, cache blue', () => {
    const v = view(calm, NOW, true)
    expect(text(v)).toBe('[plan 5h 5% ▰▱ ↻2h52 · 7d 38% ↻3d0h · $1.27]  [☀ context ▰▱ 113k / 1M 11% · ▲1.3k · ≈ 675턴]  [❄ 59:06]')
    expect(v.ctx).toMatchObject({ color: '#6CC88A' })
    expect(v.cache?.offerKeep).toBe(false)
    expect(Math.round((v.plan?.five?.bar.marker ?? 0) * 10)).toBe(427) // 2h08 of 5h gone
  })

  test('detail panel lines', () => {
    expect(detail(calm, '5h')).toContain('→ 여유 · 이 속도면 리셋 때 ~12%')
    expect(detail(calm, '7d')).toMatch(/^리셋 .+ \(3d0h\) · 이 속도면 리셋 때 ~66%$/)
    expect(detail(calm, '오늘')).toBe('$4.80 · 세션 3개 · 입력 1.9M / 출력 84k')
    expect(detail(calm, 'context')).toBe('compact까지 854k · 최근 평균 +1.3k/턴')
    expect(detail(calm, '지난 턴')).toBe('큰 결과: Read register.tsx ≈18k')
    expect(detail(calm, '캐시')).toContain('적중률 94% · 재기록 0회')
    expect(view(calm, NOW, true).slices.map(x => x.color)).toEqual(['#6AA9F0', '#F59E4B']) // messages keep their own color
  })

  test('warning: violet forecast, keep button under 10 minutes', () => {
    const s: Snapshot = { ...calm, tokens: 660_000, deltas: [24_000], lastRequestAt: NOW - 52 * MIN }
    const v = view(s, NOW, true)
    expect(v.ctx).toMatchObject({ icon: '☂' }) // 68% of the compact line
    expect(v.cache).toMatchObject({ text: '8:00', offerKeep: true, color: '#E8C547' })
    expect(view(s, NOW, false).cache?.offerKeep).toBe(false) // no cache-tax, no button
  })

  test('danger: compact soon, cache cold with the rewrite size', () => {
    const s: Snapshot = { ...calm, tokens: 905_000, deltas: [20_000], lastRequestAt: NOW - 2 * 60 * MIN }
    const v = view(s, NOW, true)
    expect(v.ctx).toMatchObject({ icon: '↯' })
    expect(v.cache).toMatchObject({ text: 'cold', isCold: true, rewrite: '재기록 ~905k', offerKeep: false })
  })

  test('narrow: drops extras, then cost, then 7d', () => {
    const v = view(calm, NOW, false)
    expect(text(fit(v, 200))).toBe(text(v))
    expect(text(fit(v, 106))).toBe('[plan 5h 5% ▰▱ ↻2h52 · 7d 38% ↻3d0h · $1.27]  [☀ context ▰▱ 113k / 1M 11%]  [❄ 59:06]')
    expect(text(fit(v, 85))).toBe('[plan 5h 5% ▰▱ ↻2h52]  [☀ context ▰▱ 113k / 1M 11%]  [❄ 59:06]')
  })

  for (const [surface, hasSurvey] of [['terminal', false], ['desktop', false], ['desktop', true]] as const) {
    test(`mounts the band (${surface}${hasSurvey ? ', under a survey' : ''})`, async ($: any, on: any) => {
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
      const ui = await $.ui.mount({ plugin: 'token-gauge', surface, component: 'AbovePrompt', props: { hasSurvey, isWorking: false, maxRows: 10, bodyColumns: 160 } })
      expect(await ui.find({ type: 'Text', text: '☀' })).toBeDefined() // the chips stay, a survey or not
      expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined() // stacked, not replaced
      expect(Boolean(await ui.find({ type: 'Svg' }))).toBe(surface === 'desktop')
      expect(await ui.find({ type: 'Text', text: '│' })).toBeDefined() // no borders, one row high: the desktop since 1.7.0, the terminal since 1.8.0
      expect(Boolean(await ui.find({ type: 'Button', text: '▾ 상세' }))).toBe(!hasSurvey) // a survey keeps the row free of buttons
      expect(await ui.find({ type: 'Text', text: /^리셋/ })).toBeUndefined() // closed until pressed
      await ui.unmount()
    })
  }

  test('install options', () => {
    expect(configure({})).toEqual({ cacheTtlMs: 3_600_000, showCost: true, alerts: true })
    expect(configure({ actionsAt: 200, handoffDir: '  ' })).toEqual({ cacheTtlMs: 3_600_000, showCost: true, alerts: true }) // odd values keep defaults
    configure({ cacheTtl: '5m', actionsAt: 80, showCost: false, handoffDir: 'notes/' })
    const v = view(calm, NOW, true)
    expect(v.cache?.text).toBe('4:06') // 5 minutes from the last request
    expect(v.plan?.cost).toBeUndefined()
    expect(detail(calm, '오늘')).toBe('세션 3개 · 입력 1.9M / 출력 84k')
    configure({})
  })

  for (const [traffic, toasts] of [[undefined, 1], ['1', 0]] as const) {
    test(`update check, once a day${toasts ? '' : ', off with nonessential traffic disabled'}`, async ($: any, on: any) => {
      mock.clock(on, { now: NOW })
      mock.store(on)
      let asks = 0
      const urls: string[] = []
      const shown: string[] = []
      on('env.get', (_$: any, e: any) => {
        if (e.name !== 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC') return { value: undefined }
        asks++
        return { value: traffic }
      })
      on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
      on('http.fetch', (_$: any, e: any) => {
        urls.push(e.url)
        return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ plugins: [{ name: 'token-gauge', version: '9.0.0' }] }) } }
      })
      on('fs.read', () => ({ value: JSON.stringify({ version: '1.2.0' }) }))
      on('ui.toast', (_$: any, e: any) => {
        shown.push(e.text)
        return { value: undefined }
      })
      const tick = () => new Promise<void>(r => setTimeout(r, 1))
      for (let n = 1; n <= 2; n++) {
        // the second session the same day makes no request
        await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
        for (let i = 0; i < 200 && asks < n; i++) await tick()
        for (let i = 0; i < 20; i++) await tick() // the check runs on after the start
      }
      expect(asks).toBe(2)
      expect(urls.length).toBe(toasts)
      expect(shown.length).toBe(toasts)
      if (toasts) expect(shown[0]).toContain('새 버전 9.0.0(지금 1.2.0)')
    })
  }

  test('helpers', () => {
    expect([isNewer('1.10.0', '1.9.3'), isNewer('1.2.0', '1.2.0'), isNewer('1.1.9', '1.2.0'), isNewer('2', '1.9.9')]).toEqual([true, false, false, true])
    expect(latestVersion('{"plugins":[{"name":"other","version":"5.0.0"},{"name":"token-gauge","version":"1.3.0"}]}')).toBe('1.3.0')
    expect(latestVersion('<html>rate limited</html>')).toBeUndefined()
    expect(turnsLeft({ ...calm, deltas: [] })).toBeUndefined()
    expect(turnsLeft({ ...calm, deltas: [-50_000, 10_000] })).toBe(86) // shrinking turns are left out
    expect([pace(5, 43), pace(40, 43), pace(60, 43)]).toEqual(['여유', '적정', '과속'])
    expect(forecastText(5, 5, NOW + MIN, NOW)).toBe('') // too early to tell
    expect(forecastText(60, 50, NOW + 150 * MIN, NOW)).toMatch(/에 100%$/)
    expect(sumDays([{ usd: 1, input: 10, output: 1 }, { usd: 2.5, input: 5, output: 2 }])).toEqual({ usd: 3.5, input: 15, output: 3 })
    expect(itemLabel({ tool: 'Read', file_path: 'C:\\a\\b\\register.tsx' })).toBe('Read register.tsx')
    expect(itemLabel({ tool: 'Bash', command: 'claude  plugin test ./meter-line --verbose' })).toBe('Bash claude plugin test ./me…')
    expect(itemLabel({ tool: 'WebFetch', url: 'https://example.com/a/b' })).toBe('WebFetch example.com')
    expect(itemLabel({ tool: 'WebFetch', url: 'https://me:hunter2@example.com/a' })).toBe('WebFetch example.com')
    expect(itemLabel({ tool: 'Bash', command: 'API_TOKEN=abc123 npm publish' })).toBe('Bash API_TOKEN=*** npm publi…')
  })

  test('redact hides credentials and leaves ordinary commands alone', () => {
    const hidden: [string, string][] = [
      ['curl -H "Authorization: Bearer eyJhbGciOi.x.y" https://a.io', 'curl -H "Authorization: ***" https://a.io'],
      ["curl -H 'X-Api-Key: k123' https://a.io", "curl -H 'X-Api-Key: ***' https://a.io"],
      ['curl https://a.io -d bearer abcdefghijklmnopqrstu', 'curl https://a.io -d bearer ***'],
      ['npm login --token=s3cr3t --scope x', 'npm login --token=*** --scope x'],
      ['tool --password "a b c" run', 'tool --password *** run'],
      ['Connect-Thing -ApiKey abc -Name x', 'Connect-Thing -ApiKey *** -Name x'],
      ["$env:GH_PAT = 'ghx' ; git push", '$env:GH_PAT = *** ; git push'],
      ['export AWS_SECRET_ACCESS_KEY=abc/def', 'export AWS_SECRET_ACCESS_KEY=***'],
      ['git clone https://x-access-token:abc@github.com/o/r', 'git clone https://x-access-token:***@github.com/o/r'],
      ['curl -u admin:pw https://a.io', 'curl -u *** https://a.io'],
      ['echo ghp_abcdefghijklmnopqrstuvwxyz0123 | gh auth login --with-token', 'echo *** | gh auth login --with-token'],
    ]
    for (const [from, to] of hidden) expect(redact(from)).toBe(to)
    const kept = ['PATH=/usr/bin make', 'claude plugin test ./x --verbose', 'mysql -u root', 'git log --format=%h', 'grep -n token_count src', 'basic usage of Bearer auth']
    for (const s of kept) expect(redact(s)).toBe(s)
    expect(largest([{ label: 'a', tokens: 100 }, { label: 'b', tokens: 9000 }, { label: 'c', tokens: 600 }], 3).map(i => i.label)).toEqual(['b', 'c'])
    const c = hitRate(hitRate({ read: 0, total: 0, rewrites: 0, steps: 0 }, { cache_creation_input_tokens: 50_000 }), { cache_read_input_tokens: 40_000, cache_creation_input_tokens: 60_000, input_tokens: 10 })
    expect(c).toEqual({ read: 40_000, total: 150_010, rewrites: 1, steps: 2 }) // the first write is no rewrite
    expect(slices([{ name: 'a', tokens: 100 }], 1000)[0]!.share).toBe(10)
    // terminal breakdown: each category its share of 40 cells, at least one, then free space
    const runs = stackCells(slices([{ name: 'system prompt', tokens: 9700 }, { name: 'messages', tokens: 200_000 }], 1_000_000), 40)
    expect(runs).toEqual([{ color: '#6AA9F0', cells: 1 }, { color: '#F59E4B', cells: 8 }, { color: undefined, cells: 31 }])
    expect(svgBar({ percent: 1, color: '#000', marker: 50 }, 48)).toContain('x="24.0"')
  })

  test('k: measured growth over estimated results, kept within 0.5 to 2', () => {
    const t = { first: 10_000, last: 16_000, outputs: 1500, lastOutput: 500, count: 3, compacted: false }
    expect(turnSample(t, 4000)).toEqual({ growth: 5000, est: 4000 }) // outputs before the last are not results
    expect(turnSample({ ...t, compacted: true }, 4000)).toBeUndefined()
    expect(turnSample({ ...t, count: 1 }, 4000)).toBeUndefined()
    expect(calibrate([{ growth: 3000, est: 2000 }, { growth: 3000, est: 2000 }])).toBe(1.5)
    expect(calibrate([{ growth: 50_000, est: 2000 }])).toBe(2)
    expect(calibrate([{ growth: 5000, est: 1000 }, { growth: -10, est: 9000 }])).toBeUndefined() // too small, shrunk
    const k = view({ ...calm, k: 1.5 }, NOW, true)
    expect(k.detail.find(d => d.label === '지난 턴')?.text).toBe('큰 결과: Read register.tsx ≈27k · 추정 ×1.50')
  })

  test('re-reads: only an unchanged read of the same range in the same epoch is waste', () => {
    const prior = { hash: 1, epoch: 0, seq: 5 }
    expect(readKind(undefined, 0, 0, 1)).toBe('first')
    expect(readKind(prior, 6, 0, 1)).toBe('after-edit')
    expect(readKind(prior, 0, 1, 1)).toBe('after-compaction')
    expect(readKind(prior, 0, 0, 2)).toBe('changed')
    expect(readKind(prior, 0, 0, 1)).toBe('unchanged')
    expect(fnv('a')).not.toBe(fnv('b'))
    const s: Snapshot = { ...calm, waste: { rereads: 3, rereadTokens: 12_000, rereadTop: { name: 'a.ts', count: 2 }, repeats: 1, repeatTokens: 900, repeatTop: 'Bash make' } }
    expect(detail(s, '중복')).toBe('변경 없는 재읽기 3회 ≈12k (a.ts 2회) · 같은 출력 1회 ≈900 (Bash make)')
    expect(detail(calm, '중복')).toBeUndefined()
  })

  test('compaction: sizes and the edited files its summary dropped, carried into the handoff', () => {
    const lost = lostFiles(['/w/a.ts', 'C:\\w\\b.py'], [{ text: 'edited a.ts', toolUses: [] }])
    expect(lost).toEqual(['C:\\w\\b.py'])
    expect(detail({ ...calm, compaction: { before: 312_000, after: 41_000, lost } }, 'compact')).toBe('312k → 41k · 요약에 빠진 편집 파일 1개: b.py')
    expect(detail({ ...calm, compaction: { lost: [] } }, 'compact')).toBe('완료')
    expect(detail({ ...calm, compaction: { before: 312_000, after: 41_000, lost: [], count: 2 } }, 'compact')).toBe('2회 · 312k → 41k') // 2026-10-24
  })

  test('estimate: text by length, a picture by its 28-pixel patches, a PDF by its pages', () => {
    expect(estimate('x'.repeat(398))).toBe(100) // 400 characters with the quotes
    const picture = (dimensions: Record<string, number>) => ({ result: { type: 'image', file: { base64: 'A'.repeat(90_000), type: 'image/png', originalSize: 69_365, dimensions } } })
    expect(estimate(picture({ originalWidth: 1291, originalHeight: 317, displayWidth: 1291, displayHeight: 317 }))).toBe(47 * 12) // not 22k from the base64
    expect(estimate(picture({ originalWidth: 8000, originalHeight: 8000 }))).toBe(4784) // capped as the model downscales it
    expect(estimate(picture({}))).toBe(1600)
    const pdf = btoa('%PDF-1.4 1 0 obj <</Type /Pages /Kids [2 0 R 3 0 R] /Count 2>> 2 0 obj <</Type /Page>> 3 0 obj <</Type/Page>>')
    expect(pdfPages(pdf)).toBe(2)
    expect(pdfPages('not base64 at all!')).toBe(1)
    expect(estimate({ result: { type: 'pdf', file: { filePath: '/w/a.pdf', base64: pdf, originalSize: 99 } } })).toBe(2 * 3850)
    expect(estimate({ result: { type: 'parts', file: { filePath: '/w/a.pdf', originalSize: 99, count: 3, outputDir: '/t' } } })).toBe(3 * 1600)
  })

  test('advice: whole large files, long outputs, unused MCP servers', () => {
    expect(advice({ tool: 'Read', file_path: '/w/big.ts' }, 'Read big.ts', 12_000)?.key).toBe('large-read')
    expect(advice({ tool: 'Read', file_path: '/w/big.ts', offset: 1, limit: 200 }, 'Read big.ts', 12_000)).toBeUndefined()
    expect(advice({ tool: 'Read', file_path: '/w/shot.PNG' }, 'Read shot.PNG', 12_000)).toBeUndefined() // offset/limit does not apply to a picture
    expect(advice({ tool: 'Read', file_path: '/w/spec.pdf' }, 'Read spec.pdf', 12_000)).toBeUndefined()
    expect(advice({ tool: 'Bash', command: 'make' }, 'Bash make', 9000)?.text).toBe('긴 명령 출력: Bash make ≈9k · head/tail/grep으로 줄이면 됩니다')
    expect(advice({ tool: 'Agent' }, 'Agent', 9000)?.key).toBe('large-agent')
    expect(advice({ tool: 'Bash', command: 'ls' }, 'Bash ls', 300)).toBeUndefined()
    const tools = [
      { serverName: 'claude.ai Gmail', tokens: 6000, isLoaded: true },
      { serverName: 'github', tokens: 4000, isLoaded: true },
      { serverName: 'github', tokens: 4000, isLoaded: true },
      { serverName: 'docs', tokens: 9000, isLoaded: false }, // deferred: not in the window
      { serverName: 'small', tokens: 1000, isLoaded: true },
    ]
    expect(unusedServers(tools, new Set())).toEqual([{ server: 'github', tokens: 8000 }, { server: 'claude.ai Gmail', tokens: 6000 }])
    expect(unusedServers(tools, new Set(['github', 'claudeaigmail']))).toEqual([]) // mcp__claude_ai_Gmail__x was called
  })

  test('model chip: name and effort, dropped before the cost when narrow', () => {
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelName('claude-opus-4-20250514')).toBe('Opus 4')
    expect(modelName('claude-sonnet-4-6[1m]')).toBe('Sonnet 4.6 1M')
    expect(modelName('gpt-like-model')).toBe('gpt-like-model')
    const v = view({ ...calm, model: 'claude-opus-5-5', effort: 'high' }, NOW, false)
    expect(v.model).toEqual({ name: 'Opus 5.5', effort: 'high', color: '#A78BFA' })
    expect(text(v)).toMatch(/  \[Opus 5\.5 · high\]$/)
    expect(text(fit(v, 106))).toBe('[plan 5h 5% ▰▱ ↻2h52 · 7d 38% ↻3d0h · $1.27]  [☀ context ▰▱ 113k / 1M 11%]  [❄ 59:06]')
    expect(view({ ...calm, model: 'x' }, NOW, false).model?.color).toBe('#9A9A9A')
  })

  // Last: the module keeps this session's tracking, and the panel stays open.
  test('a session: re-reads and repeats in the panel, a long output advises once', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    mock.store(on)
    const shown: string[] = []
    on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: 50_000, window: 1_000_000 }, rateLimits: [] } }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('ui.toast', (_$: any, e: any) => {
      shown.push(e.text)
      return { value: undefined }
    })
    on('ui.render', ($$: any, e: any) => $$.ui.resolve(e).Text({ children: 'engine band' }))
    on('tool.call', (_$: any, e: any) => ({ result: e.tool === 'Bash' ? 'x'.repeat(40_000) : `content of ${e.file_path}` }))
    await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/w' })
    for (let i = 0; i < 2; i++) {
      await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })
      await $.tool.call({ tool: 'Bash', command: 'make log' })
    }
    const ui = await $.ui.mount({ plugin: 'token-gauge', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 200 } })
    expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()
    await ui.press({ key: 'token-gauge-more' })
    expect(await ui.find({ type: 'Text', text: /^변경 없는 재읽기 1회 ≈\d+ \(a\.ts 1회\) · 같은 출력 1회 ≈10k \(Bash make log\)$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Bash 2회 ≈20k · Read 2회 ≈\d+ · 세션 합계 4회 ≈20k$/ })).toBeDefined() // 2026-10-24: the session's results by tool; 10-26 with calls
    expect(shown.filter(t => t.startsWith('긴 명령 출력: Bash make log')).length).toBe(1)
    await ui.unmount()
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`a question dialog keeps the chips above it, text bars and no buttons (${surface})`, async ($: any, on: any) => {
      engine(on)
      await $.session.start({ surface, isInteractive: false, cwd: '/work' })
      const ui = await $.ui.mount({ plugin: 'token-gauge', surface, component: 'AskUserQuestion', props: QUESTION }) // validated: the node once, within the rows
      expect(await ui.find({ type: 'Text', text: /113k ?\/ ?1M/ })).toBeDefined() // terminal: one line; desktop: the chips
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ type: 'Button' })).toBeUndefined()
      await ui.unmount()
    })
  }

  // the ⏳ chip takes room of its own: on a narrow line the cost and then 7d give way, rather than the row wrapping
  test('while Claude works, the line leaves the ⏳ chip room', async ($: any, on: any) => {
    engine(on)
    on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
    await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/w' })
    const band = (isWorking: boolean) => $.ui.mount({ plugin: 'token-gauge', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking, maxRows: 10, bodyColumns: 94 } })
    let ui = await band(false)
    expect(await ui.find({ type: 'Text', text: '$1.27' })).toBeDefined() // idle: the whole line fits
    await ui.unmount()
    await $.turn.start({ text: 'go', turnId: 't1' })
    ui = await band(true)
    expect(await ui.find({ type: 'Text', text: '⏳' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '$1.27' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '7d' })).toBeUndefined()
    await ui.unmount()
  })

  // 2026-10-24: a subagent left running in the background after its turn keeps a chip until it ends
  test('subagents still running show a chip, a turn or not', async ($: any, on: any) => {
    const clock = mock.clock(on, { now: NOW })
    on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: 113_000, window: 1_000_000 }, rateLimits: calm.limits } }))
    on('ui.render', ($$: any, e: any) => $$.ui.resolve(e).Text({ children: `engine ${e.component}` }))
    let status = 'running'
    on('agent.list', () => ({ value: [{ id: 'a1', description: 'scan', type: 'Explore', status }, { id: 'a2', description: 'old', type: 'Explore', status: 'completed' }] }))
    await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/w' })
    await clock.advance(2000)
    await settle()
    let ui = await $.ui.mount({ plugin: 'token-gauge', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ type: 'Text', text: 'subagent' })).toBeDefined() // idle, no turn: the background one still counts
    expect(await ui.find({ type: 'Text', text: '1' })).toBeDefined() // the completed one does not
    await ui.press({ key: 'token-gauge-more' })
    expect(await ui.find({ type: 'Text', text: /^Explore scan 0:0\d$/ })).toBeDefined() // the panel names it, with the time since it was first seen
    await ui.press({ key: 'token-gauge-more' })
    await ui.unmount()
    status = 'completed'
    await clock.advance(2000)
    await settle()
    ui = await $.ui.mount({ plugin: 'token-gauge', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ type: 'Text', text: 'subagent' })).toBeUndefined()
    await ui.unmount()
  })

  // 2026-10-24 screen: the desktop's proportional font and key badge wrapped a row the estimate said fit
  test('the desktop folds sooner than the terminal at the same width', async ($: any, on: any) => {
    engine(on)
    await $.session.start({ surface: 'desktop', isInteractive: false, cwd: '/w' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'token-gauge', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 92 } })
      expect(Boolean(await ui.find({ type: 'Text', text: '$1.27' }))).toBe(surface === 'terminal')
      await ui.unmount()
    }
  })

  // under about 80 columns not even the folded chips fit: the band turns into one line of text, as above a question
  test('a band too narrow for the chips is one line of text', async ($: any, on: any) => {
    engine(on)
    on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
    await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/w' })
    const band = (isWorking: boolean, bodyColumns: number) => $.ui.mount({ plugin: 'token-gauge', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking, maxRows: 10, bodyColumns } })
    let ui = await band(false, 60)
    expect(await ui.find({ type: 'Text', text: /113k\/1M/ })).toBeDefined()
    expect(await ui.find({ type: 'Button' })).toBeUndefined() // no chips, no buttons
    await ui.unmount()
    await $.turn.start({ text: 'go', turnId: 't1' })
    ui = await band(true, 60)
    expect(await ui.find({ type: 'Text', text: '⏳ ' })).toBeDefined()
    await ui.unmount()
    ui = await band(false, 160)
    expect(await ui.find({ type: 'Button', text: '▾ 상세' })).toBeDefined() // wide enough: the chips as before
    await ui.unmount()
  })

  test('during a turn the context chip is read again every few seconds; ▲ is the growth since the turn began', async ($: any, on: any) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    let tokens = 100_000
    on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens, window: 1_000_000 }, rateLimits: [] } }))
    on('agent.list', () => ({ value: [] }))
    on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }))
    on('ui.render', ($$: any, e: any) => $$.ui.resolve(e).Text({ children: 'engine band' }))
    await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    tokens = 180_000
    await clock.advance(3_000)
    const props = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 160 }
    let ui = await $.ui.mount({ plugin: 'token-gauge', surface: 'terminal', component: 'AbovePrompt', props })
    expect(await ui.find({ type: 'Text', text: '180k / 1M' })).toBeDefined() // before the turn ends
    await ui.unmount()
    tokens = 200_000
    await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' })
    ui = await $.ui.mount({ plugin: 'token-gauge', surface: 'terminal', component: 'AbovePrompt', props: { ...props, isWorking: false } })
    expect(await ui.find({ type: 'Text', text: '· ▲100k' })).toBeDefined() // from 100k, not from the 180k read mid-turn
    await ui.unmount()
  })

  test('the card in Korean for cache-tax, any other reason as it came; the cold cache priced', () => {
    expect(koDuration('38h39m')).toBe('38시간 39분')
    expect(koDuration('3h00m')).toBe('3시간')
    expect(koDuration('5m')).toBe('5분')
    expect(koDuration('2d4h')).toBe('2일 4시간')
    expect(koDuration('15d 17h')).toBe('15일 17시간') // cache-tax spaces its longer durations
    expect(cardText('cache-tax', 'cache-tax: the prompt cache went cold 15d 17h ago. Sending this re-writes up to 70,146 tokens at $0.2/MTok = $0.01 (a warm turn would have cost $0.00). Send it again to pay it, and keepwarm will then hold the cache for 3h00m.', 60 * MIN, 'claude-haiku-5-5')).toMatchObject({ cost: '0.01', holds: [{ hold: '1h', usd: '0.00' }, { hold: '3h', usd: '0.00' }] })
    expect(cardText('cache-tax', 'cache-tax: the prompt cache went cold 1h ago. Sending this re-writes up to 252,672 tokens at $8/MTok = $2.02 (a warm turn would have cost $0.05). Send it again to pay it, and keepwarm will then hold the cache for 3h00m.', 60 * MIN, 'claude-opus-5-5').holds?.[1]!.usd).toBe('0.15') // Opus 5.5 reads the cache at $0.20, not 0.1x its $4
    expect(cardText('cache-tax', 'cache-tax: the prompt cache went cold 1h ago. Sending this re-writes up to 252,672 tokens at $8/MTok = $2.02 (a warm turn would have cost $0.05). Send it again to pay it, and keepwarm will then hold the cache for 3h00m.', 60 * MIN).holds?.[1]!.usd).toBeUndefined() // no model: no guess
    // 2026-10-26: the keep button asks how long, each hold priced; 6h is seven refreshes
    expect(keepChoices(252_672, 60 * MIN, 'claude-opus-5-5')).toEqual({ question: '캐시를 얼마나 유지할까요?\n50분마다 한 번 갱신합니다(회당 약 $0.05).\n식은 뒤 다시 보내면 재기록 약 $2.02', options: ['1시간 (약 $0.05)', '3시간 (약 $0.15)', '6시간 (약 $0.35)'] })
    expect(keepChoices(0, 5 * MIN)).toEqual({ question: '캐시를 얼마나 유지할까요?', options: ['1시간', '3시간', '6시간'] })
    expect(koDuration('soon')).toBe('soon')
    expect(keepPings('3h00m', 60 * MIN)).toBe(3)
    expect(keepPings('45m', 60 * MIN)).toBeUndefined() // over before the first refresh
    expect(keepPings('3h00m', 5 * MIN)).toBeUndefined() // a 5-minute cache's cadence is not known
    expect(cardText('guard', 'guard: not on Fridays', 60 * MIN)).toEqual({ question: 'guard 플러그인이 이 프롬프트를 막았습니다.\nnot on Fridays\n그래도 보낼까요? 취소하면 입력창에 되돌립니다.', cost: undefined })
    expect(Math.round(rewriteUsd('claude-opus-5-5', 252_672, 60 * MIN)! * 100)).toBe(202) // as cache-tax prices it: $8/MTok for the 1-hour cache
    expect(rewriteUsd('claude-sonnet-5-5[1m]', 1_000_000, 5 * MIN)).toBe(2.5)
    expect(rewriteUsd('claude-3-opus', 1_000, 60 * MIN)).toBeUndefined()
    expect(Math.round(rewriteUsd('claude-haiku-5-5', 252_672, 60 * MIN)! * 100)).toBe(25) // past 100K a Haiku 5.5 prompt costs $0.50 whole, as cache-tax showed
    expect(Math.round(rewriteUsd('claude-haiku-5-5', 50_000, 60 * MIN)! * 1000)).toBe(10) // $0.10 up to 100K
    const v = view({ ...calm, tokens: 252_672, model: 'claude-opus-5-5', lastRequestAt: NOW - 2 * 60 * MIN }, NOW, false)
    expect(v.cache?.rewrite).toBe('재기록 ~253k ≈$2.02')
  })

  test('a dropped prompt: the plugin that dropped it, and the hold cache-tax promises', () => {
    const trace = [
      { plugin: 'cache-tax', outcome: 'returned', returned: { drop: 'cache-tax: cold' } },
      { plugin: 'engine', outcome: 'skipped', returned: undefined },
    ]
    expect(droppedBy(trace)).toBe('cache-tax')
    expect(droppedBy([{ plugin: 'engine', outcome: 'returned', returned: { drop: 'stop' } }])).toBeUndefined() // the engine's own
    expect(droppedBy([{ plugin: 'other', outcome: 'returned', returned: { text: 'hi' } }])).toBeUndefined()
    expect(keepwarmHold('Send it again to pay it, and keepwarm will then hold the cache for 3h00m. Or /clear')).toBe('3h00m')
    expect(keepwarmHold('keepwarm will then hold the cache for 45m.')).toBe('45m')
    expect(keepwarmHold('dropped for another reason')).toBeUndefined()
  })

  // the desktop app hosts its sessions through the SDK: the person's typing arrives there as `sdk`
  // with the hold the person chose, /keepwarm holds it; sending alone turns off the hold cache-tax starts on its own
  // 2026-10-24: sending showed the drop and the prompt a second time; now the same submission passes, once
  for (const [choice, sent, filled, surface, kind, keepwarm, toast] of [
    ['보내고 1시간 유지 ($2.02 + 약 $0.05)', 1, 0, 'terminal', 'composer', '1h', '/keepwarm으로 1시간 동안 캐시를 유지합니다'],
    ['보내고 3시간 유지 ($2.02 + 약 $0.15)', 1, 0, 'terminal', 'composer', '3h', '/keepwarm으로 3시간 동안 캐시를 유지합니다'],
    ['보내기만 ($2.02)', 1, 0, 'desktop', 'sdk', 'off', '/keepwarm off: 보내기만 골라 cache-tax의 자동 캐시 유지를 껐습니다'],
    ['취소', 0, 1, 'desktop', 'sdk', '', ''],
  ] as const) {
    test(`a prompt another hook dropped is asked about before the drop shows (${choice}, ${surface})`, async ($: any, on: any) => {
      const clock = mock.clock(on, { now: NOW })
      const asked: any[] = []
      const submitted: any[] = []
      const fills: any[] = []
      const commands: any[] = []
      const toasts: string[] = []
      const reason = 'test: the prompt cache went cold 38h39m ago. Sending this re-writes up to 252,672 tokens at $8/MTok = $2.02 (a warm turn would have cost $0.05). Send it again to pay it, and keepwarm will then hold the cache for 3h00m. Or /clear and start from a note.'
      let passes = 0
      on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
      // as cache-tax: the same prompt goes through the second time it comes down
      on('prompt.submit', (_$: any, e: any) => {
        if (passes++ === 0) return { drop: reason }
        submitted.push(`${e.origin.kind}: ${e.text}`)
        return { text: e.text }
      })
      on('tool.call', (_$: any, e: any) => {
        asked.push(e)
        return { result: { questions: e.questions, answers: { [e.questions[0].question]: choice } } }
      })
      on('prompt.fill', (_$: any, e: any) => {
        fills.push(e)
        return { isFilled: true, text: e.text, cursor: e.text.length }
      })
      on('command.list', () => ({ value: [{ name: 'keepwarm' }] }))
      on('command.run', (_$: any, e: any) => {
        commands.push(e)
        return { text: 'ok' }
      })
      on('session.surfaces', () => ({ value: [surface] }))
      on('session.model', () => ({ value: 'claude-opus-5-5' }))
      on('ui.toast', (_$: any, e: any) => {
        toasts.push(e.text)
        return { value: undefined }
      })
      await $.session.start({ surface, isInteractive: true, cwd: '/w' })
      const r = await $.prompt.submit({ text: '이어서 해 줘', origin: { kind } })
      if (sent) expect(r).toEqual({ text: '이어서 해 줘' }) // entered as typed: no drop shown
      else expect(r.drop).toBe('token-gauge: 보내지 않았습니다. 입력창에 되돌렸습니다.') // the card's answer, not the hook's warning
      await clock.advance(1) // /keepwarm waits for a timer past the hook
      for (let i = 0; i < 50 && sent && toasts.length === 0; i++) await new Promise<void>(res => setTimeout(res, 1))
      expect(asked.length).toBe(1)
      expect(asked[0].questions[0]).toMatchObject({ header: 'token-gauge', question: 'test 플러그인이 이 프롬프트를 막았습니다.\n프롬프트 캐시가 38시간 39분 전에 식어서, 지금 보내면 252,672토큰을 다시 기록합니다: $2.02 (캐시가 살아 있었으면 $0.05)\n유지를 고르면 test가 50분마다 캐시를 갱신합니다(회당 약 $0.05). 보내기만 고르면 유지를 켜지 않습니다.\n그래도 보낼까요? 취소하면 입력창에 되돌립니다. 입력창에서 다시 보내면 test가 비용을 내는 것으로 보고 통과시킵니다.' }) // whose card, and the reason in Korean
      expect(submitted).toEqual(sent ? [`${kind}: 이어서 해 줘`] : []) // the person's own prompt, not a second one of the plugin's
      expect(fills.length).toBe(filled)
      if (sent) expect(commands).toMatchObject([{ command: 'keepwarm', args: keepwarm }])
      if (sent) expect(toasts).toEqual([toast])
      if (filled) expect(fills[0]).toMatchObject({ text: '이어서 해 줘', mode: 'replace' })
    })
  }

  test('a prompt dropped again on the second pass goes back in the box', async ($: any, on: any) => {
    const commands: any[] = []
    const fills: any[] = []
    on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
    on('prompt.submit', () => ({ drop: 'test: no' }))
    on('tool.call', (_$: any, e: any) => ({ result: { questions: e.questions, answers: { [e.questions[0].question]: '보내기' } } }))
    on('prompt.fill', (_$: any, e: any) => {
      fills.push(e.text)
      return { isFilled: true, text: e.text, cursor: e.text.length }
    })
    on('command.run', (_$: any, e: any) => {
      commands.push(e)
      return { text: 'ok' }
    })
    on('session.surfaces', () => ({ value: ['terminal'] }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const r = await $.prompt.submit({ text: 'go', origin: { kind: 'composer' } })
    expect(r.drop).toBe('token-gauge: 다시 보내도 막혀 입력창에 되돌렸습니다. test: no')
    expect(fills).toEqual(['go'])
    expect(commands).toEqual([])
  })

  // a prompt that went through with no cache-tax link beneath, while /keepwarm is there: cache-tax sits outside
  test('cache-tax outside token-gauge: warned once, on the first prompt that goes through', async ($: any, on: any) => {
    const toasts: string[] = []
    on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
    on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
    on('command.list', () => ({ value: [{ name: 'keepwarm' }] }))
    on('ui.toast', (_$: any, e: any) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.prompt.submit({ text: 'a', origin: { kind: 'composer' } })
    await $.prompt.submit({ text: 'b', origin: { kind: 'composer' } })
    for (let i = 0; i < 50 && toasts.length === 0; i++) await new Promise<void>(res => setTimeout(res, 1))
    expect(toasts.filter(t => t.startsWith('cache-tax가 먼저 실행돼')).length).toBe(1)
  })

  test('a plain -p run: a dropped sdk prompt keeps its drop and asks nothing', async ($: any, on: any) => {
    const asked: any[] = []
    on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
    on('prompt.submit', () => ({ drop: 'test: cold' }))
    on('tool.call', (_$: any, e: any) => {
      asked.push(e)
      return { result: {} }
    })
    on('session.surfaces', () => ({ value: [] }))
    await $.session.start({ isInteractive: false, cwd: '/w' })
    expect((await $.prompt.submit({ text: 'go', origin: { kind: 'sdk' } })).drop).toBe('test: cold')
    expect(asked.length).toBe(0)
  })

  // 2026-10-23: presses during a long turn showed nothing and queued /compact and the memo twice each
  test('unknown models show no price estimate', () => {
    expect(detail({ ...calm, model: 'claude-next-9' }, '비용')).toBe('단가표에 없는 모델(claude-next-9)이라 금액을 보이지 않습니다')
    expect(detail(calm, '비용')).toBeUndefined()
  })

  // 2026-10-23: the buttons sent at once; the person now sends, edits or clears what they put in the box
  test('compact and handoff buttons are absent even near the context limit', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    const toasts: string[] = []
    const sent: string[] = []
    const filled: string[] = []
    let isFilled = true
    on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: 800_000, window: 1_000_000 }, rateLimits: calm.limits } }))
    on('ui.render', ($$: any, e: any) => $$.ui.resolve(e).Text({ children: 'engine band' }))
    on('ui.toast', (_$: any, e: any) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('command.run', (_$: any, e: any) => {
      sent.push(e.command)
      return { text: '' }
    })
    on('prompt.submit', (_$: any, e: any) => {
      sent.push(e.text)
      return { text: e.text }
    })
    on('prompt.fill', (_$: any, e: any) => {
      filled.push(`${e.mode}: ${e.text}`)
      return { isFilled }
    })
    await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/w' })
    const ui = await $.ui.mount({ plugin: 'token-gauge', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 200 } })
    expect(await ui.find({ type: 'Button', text: '/compact' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', text: /^인계 메모/ })).toBeUndefined()
    expect(await ui.find({ type: 'Button', text: '▾ 상세' })).toBeDefined()
    expect(filled).toEqual([])
    expect(sent).toEqual([])
    expect(toasts).toEqual([])
    await ui.unmount()
  })

  // 2026-10-24: ccgauge ranks tools by context footprint, ccgauge/burnie show cache savings, the usage monitors forecast at the recent pace
  test('per-tool results, cache savings, the pace of the last hour', () => {
    expect(toolKey('mcp__rea__open_binary')).toBe('mcp__rea')
    expect(toolKey('Read')).toBe('Read')
    const tools = { Read: 120_000, Bash: 40_000, Agent: 18_000, mcp__rea: 9000, Grep: 300 }
    expect(detail({ ...calm, tools }, '도구별')).toBe('Read ≈120k · Bash ≈40k · Agent ≈18k · mcp__rea ≈9k 외 1종 · 세션 합계 ≈187k')
    expect(detail({ ...calm, tools: { Read: 400 } }, '도구별')).toBeUndefined() // too little to say anything
    // calls count subagents' too, so a tool only they called shows its calls alone
    expect(detail({ ...calm, tools: { Read: 120_000, Bash: 400 }, calls: { Read: 25, Bash: 31, Grep: 9 } }, '도구별')).toBe('Read 25회 ≈120k · Bash 31회 ≈400 · Grep 9회 · 세션 합계 65회 ≈120k')
    expect(detail({ ...calm, calls: { Bash: 2 } }, '도구별')).toBe('Bash 2회 · 세션 합계 2회')
    expect(Math.round(savedUsd('claude-opus-5-5', 1_000_000)! * 100)).toBe(380) // $4 input - $0.20 read, per million
    expect(savedUsd(undefined, 1_000_000)).toBeUndefined()
    const cache = { read: 2_000_000, total: 2_100_000, rewrites: 1, steps: 9 }
    expect(detail({ ...calm, model: 'claude-opus-5-5', cache }, '캐시')).toMatch(/ · 적중률 95% · 재기록 1회 · 절약 ≈\$7\.60$/)
    expect(detail({ ...calm, model: 'claude-opus-5-5' }, '캐시')).not.toContain('절약') // under a cent
    // readings: on each change and every 5 minutes, an hour kept, a drop starts over
    let t = trail([], 10, NOW)
    t = trail(t, 10, NOW + MIN)
    expect(t).toEqual([{ at: NOW, percent: 10 }])
    t = trail(t, 12, NOW + 2 * MIN)
    expect(t.length).toBe(2)
    expect(trail(t, 3, NOW + 3 * MIN)).toEqual([{ at: NOW + 3 * MIN, percent: 3 }])
    expect(trail([{ at: NOW - 70 * MIN, percent: 1 }], 1, NOW)).toEqual([{ at: NOW, percent: 1 }])
    const reset = NOW + 3 * 60 * MIN
    expect(recentForecast([{ at: NOW - 60 * MIN, percent: 20 }, { at: NOW, percent: 50 }], NOW, reset)).toMatch(/^ · 최근 1시간 속도면 .+에 100%$/) // 30 points an hour: full in 1h40, before the reset
    expect(recentForecast([{ at: NOW - 60 * MIN, percent: 20 }, { at: NOW, percent: 25 }], NOW, reset)).toBe(' · 최근 1시간 속도면 리셋 때 ~40%')
    expect(recentForecast([{ at: NOW - 5 * MIN, percent: 20 }, { at: NOW, percent: 30 }], NOW, reset)).toBe('') // under 10 minutes of readings
    expect(recentForecast([{ at: NOW - 30 * MIN, percent: 20 }, { at: NOW, percent: 20 }], NOW, reset)).toBe('') // no growth
  })

  // 2026-10-24: the context chip kept the size from before /compact until the next answer
  test('a compaction shows its size at once, then the window as the engine has it', async ($: any, on: any) => {
    const clock = mock.clock(on, { now: NOW })
    on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
    let usage: any = { tokens: 800_000, window: 1_000_000 }
    on('session.usage', () => ({ value: { startedAt: NOW, context: usage, rateLimits: calm.limits } }))
    const summary = [{ role: 'user', text: '요약', toolUses: [] }]
    on('session.compact', () => ({ messages: summary, tokensBefore: 800_000, tokensAfter: 40_000 }))
    on('ui.render', ($$: any, e: any) => $$.ui.resolve(e).Text({ children: `engine ${e.component}` }))
    await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/w' })
    await $.session.compact({ trigger: 'manual', messages: summary }) // usage still reads the request before it
    let ui = await $.ui.mount({ plugin: 'token-gauge', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ type: 'Text', text: '40k / 1M' })).toBeDefined()
    await ui.press({ key: 'token-gauge-more' })
    expect(await ui.find({ type: 'Text', text: '1회 · 800k → 40k' })).toBeDefined()
    await ui.press({ key: 'token-gauge-more' })
    await ui.unmount()
    // the engine took it: no response of the new window yet, so the estimate stands
    usage = { window: 1_000_000, breakdown: { rawMaxTokens: 1_000_000, totalTokens: 42_000, isAutoCompactEnabled: false, percentage: 4, categories: [] } }
    await clock.advance(2000)
    await settle()
    ui = await $.ui.mount({ plugin: 'token-gauge', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ type: 'Text', text: '42k / 1M' })).toBeDefined()
    await ui.unmount()
  })

  // 2026-10-24: the desktop hides the band under its next-step box; the footer under the prompt stays, cut after about
  // 27 characters (screen), so the context and the cache come first
  test('the footer line: what matters first, short, the model left out', () => {
    expect(footerLine(view(calm, NOW, false))).toBe('☀\uFE0F 11% · ❄\uFE0F 59:06 · 5h 5% · 7d 38%')
    const limits = [
      { kind: 'five_hour', percentUsed: 80, resetsAt: at(172 * MIN) },
      { kind: 'seven_day', percentUsed: 95, resetsAt: at(3 * 24 * 60 * MIN) },
    ]
    const busy: Snapshot = { ...calm, limits, tokens: 800_000, lastRequestAt: NOW - 55 * MIN }
    expect(footerLine(view(busy, NOW, false))).toBe('⛈\uFE0F 80% · ❄\uFE0F 5:00 ⚠\uFE0F · 5h 80% ⚠\uFE0F · 7d 95% ⚠\uFE0F') // yellow and red called out
    expect(footerLine(view({ ...busy, lastRequestAt: NOW - 2 * 60 * MIN }, NOW, false))).toMatch(/^⛈\uFE0F 80% · ❄\uFE0F cold ⚠\uFE0F · /)
    expect(footerLine(view({ ...calm, agents: [{ id: 'a1', type: 'Explore', description: 'scan', since: NOW }] }, NOW, false), { since: 0, elapsed: 7_000, tools: 1 })).toMatch(/ · ⏳ 0:07 · subagent 1$/) // while Claude works
    expect(footerLine(view({ ...calm, limits: [], costUsd: undefined, tokens: undefined, lastRequestAt: undefined }, NOW, false))).toBeUndefined()
  })

  const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise<void>(res => setTimeout(res, 1))
  }
  const LINE = /^☀\uFE0F 11% · 5h 5% · 7d 38%$/
  function footerEngine(on: any) {
    const lines: (string | undefined)[] = []
    on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: 113_000, window: 1_000_000 }, rateLimits: calm.limits } }))
    on('ui.render', ($$: any, e: any) => $$.ui.resolve(e).Text({ children: `engine ${e.component}` }))
    on('ui.status', (_$: any, e: any) => {
      lines.push(e.text)
      return { value: undefined }
    })
    return lines
  }
  const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 }

  // 2026-10-24: the band always above the prompt; the footer line stands in only while the next-step box hides it
  test('the footer line only while a next-step box hides the band', async ($: any, on: any) => {
    const clock = mock.clock(on, { now: NOW })
    const lines = footerEngine(on)
    on('tool.call', () => ({ result: 'ok' }))
    on('agent.list', () => ({ value: [] }))
    on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
    await $.session.start({ surface: 'desktop', isInteractive: false, cwd: '/w' })
    const ui = await $.ui.mount({ plugin: 'token-gauge', surface: 'desktop', component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ type: 'Button', text: '▾ 상세' })).toBeDefined() // the band is drawn
    expect(await ui.find({ type: 'Text', text: 'engine AbovePrompt' })).toBeDefined() // what others draw stays
    await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'done' }) // a recap alone draws no box
    await clock.advance(1000)
    await settle()
    expect(lines.filter(Boolean)).toEqual([])
    await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'done', ask: '진행할까요?' })
    await clock.advance(1000)
    await settle()
    expect(lines.at(-1)).toMatch(LINE)
    await $.turn.start({ text: 'go', turnId: 't1' }) // answered: the box is gone
    await clock.advance(1000)
    await settle()
    expect(lines.at(-1)).toBeUndefined()
    await ui.unmount()
  })

  // 2026-10-24: the status line under the prompt cannot be pressed; the empty box can take a suggestion instead
  test('/keepwarm 90m is suggested once a cache window, in its last 10 minutes, every 15 seconds until shown', () => {
    const at = NOW - 52 * MIN // 8 minutes left of the hour
    expect(keepSuggestionDue(at, NOW, 60 * MIN, undefined)).toBe(true) // NOW falls on a 15-second mark
    expect(keepSuggestionDue(at, NOW + 1000, 60 * MIN, undefined)).toBe(false) // between marks
    expect(keepSuggestionDue(at, NOW, 60 * MIN, at)).toBe(false) // shown for this cache already
    expect(keepSuggestionDue(NOW - 40 * MIN, NOW, 60 * MIN, undefined)).toBe(false) // 20 minutes left
    expect(keepSuggestionDue(NOW - 61 * MIN, NOW, 60 * MIN, undefined)).toBe(false) // already cold
    expect(keepSuggestionDue(undefined, NOW, 60 * MIN, undefined)).toBe(false) // no request yet
  })

  test('background forks refresh cached prefixes and preserve the latest request timestamp', async () => {
    const hooks: Record<string, any> = {}
    const on: any = (event: string, ...args: any[]) => {
      hooks[event] = args.at(-1)
      return { catch: () => {} }
    }
    register(on, { alerts: false })
    let now = NOW
    const saved: any[] = []
    const deleted: string[] = []
    const $: any = {
      clock: { now: async () => now },
      ui: { invalidate: () => {} },
      session: { usage: async () => ({}) },
      store: { get: async () => undefined, set: async (...args: any[]) => { saved.push(args) }, delete: async (key: string) => { deleted.push(key) } },
    }
    await hooks['classic.SessionStart']($, { session_id: 'fork-test' }, async () => ({}))
    const reply = { value: { isAnswered: true, text: '', usage: { input_tokens: 0, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 0, output_tokens: 1 } } }
    await hooks['model.fork']($, {}, async () => reply)
    expect(saved.at(-1)).toEqual(['cache-request:fork-test', NOW])
    let finish!: () => void
    const lateReply = new Promise<any>(resolve => { finish = () => resolve(reply) })
    const pending = hooks['model.fork']($, {}, () => lateReply)
    await Promise.resolve()
    now += 5000
    await hooks['model.fork']($, {}, async () => reply)
    finish()
    await pending
    expect(saved.at(-1)).toEqual(['cache-request:fork-test', NOW + 5000])
    await hooks['model.fork']($, {}, async () => ({ value: { isAnswered: false, reason: 'aborted' } }))
    expect(saved.at(-1)).toEqual(['cache-request:fork-test', NOW + 5000])
    const writes = saved.length
    const uncached = hooks['turn.step']($, { model: 'claude-opus-5-5' }, async function* () {
      return { stopReason: 'end_turn', usage: { input_tokens: 25, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
    })
    await uncached.next()
    expect(saved.length).toBe(writes)
    await hooks['classic.PostModelSwitch']($, { to_model: 'claude-sonnet-4-6' }, async () => ({}))
    expect(deleted).toEqual(['cache-request:fork-test'])
  })
})
