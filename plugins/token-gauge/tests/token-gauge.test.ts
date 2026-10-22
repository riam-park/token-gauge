import { describe, expect, mock, test } from 'claude-code/testing'

import { advice, calibrate, configure, fit, fnv, forecastText, handoffText, hitRate, isNewer, itemLabel, largest, latestVersion, lostFiles, modelName, pace, readKind, redact, slices, stackCells, sumDays, svgBar, text, turnSample, turnsLeft, unusedServers, view } from '../hooks/register'
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
    expect(detail(calm, '지난 턴')).toBe('큰 결과: Read register.tsx ≈18k')
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
      expect(Boolean(await ui.find({ type: 'Button', label: '▾ 상세' }))).toBe(!hasSurvey) // a survey keeps the row free of buttons
      expect(await ui.find({ type: 'Text', text: /^리셋/ })).toBeUndefined() // closed until pressed
      await ui.unmount()
    })
  }

  test('install options', () => {
    expect(configure({})).toEqual({ cacheTtlMs: 3_600_000, actionsAt: 70, showCost: true, alerts: true, handoffDir: '' })
    expect(configure({ actionsAt: 200, handoffDir: '  ' })).toMatchObject({ actionsAt: 70, handoffDir: '' }) // odd values keep defaults
    expect(handoffText('')).toContain('파일은 만들지 말고 이 답변에') // no folder: the memo comes as the answer
    configure({ cacheTtl: '5m', actionsAt: 80, showCost: false, handoffDir: 'notes/' })
    const v = view(calm, NOW, true)
    expect(v.cache?.text).toBe('4:06') // 5 minutes from the last request
    expect(v.plan?.cost).toBeUndefined()
    expect(detail(calm, '오늘')).toBe('세션 3개 · 입력 1.9M / 출력 84k')
    expect(view({ ...calm, tokens: 700_000 }, NOW, true).ctx?.offerActions).toBe(false) // 72% < 80%
    expect(handoffText('notes')).toContain('`notes/<YYMMDD>_<task>/PROMPT_<작업 내용>.md`')
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
      const tick = () => new Promise(r => setTimeout(r, 1))
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
    expect(handoffText('', lost)).toMatch(/compact 요약에 빠진 편집 파일도 메모에 넣어 줘: C:\\w\\b\.py$/)
    expect(handoffText('')).not.toContain('compact')
  })

  test('advice: whole large files, long outputs, unused MCP servers', () => {
    expect(advice({ tool: 'Read', file_path: '/w/big.ts' }, 'Read big.ts', 12_000)?.key).toBe('large-read')
    expect(advice({ tool: 'Read', file_path: '/w/big.ts', offset: 1, limit: 200 }, 'Read big.ts', 12_000)).toBeUndefined()
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
    expect(text(fit(v, 114))).toBe('[plan 5h 5% ▰▱ ↻2h52 · 7d 38% ↻3d0h · $1.27]  [☀ context ▰▱ 113k / 1M 11%]  [❄ 59:06]')
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
    expect(shown.filter(t => t.startsWith('긴 명령 출력: Bash make log')).length).toBe(1)
    await ui.unmount()
  })
})
