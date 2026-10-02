import { describe, expect, it } from 'vitest'
import { bridgeConfig, buildServerArgs, resolveLaunchFlags, sameFlags } from '../src/bridge.ts'
import { DEFAULT_EXTRA_FLAGS, type ConfigValue } from '../src/config.ts'

const base = {
  serverName: 'chrome',
  command: 'npx',
  package: 'chrome-devtools-mcp@latest',
  extraFlags: [...DEFAULT_EXTRA_FLAGS],
  chromePath: '',
  chromePaths: [],
  env: {},
  cwd: '',
  toolCallTimeoutMs: 60000,
  failOnStartupError: false,
  reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 },
} satisfies ConfigValue

describe('buildServerArgs', () => {
  it('assembles the npx argv tail', () => {
    expect(buildServerArgs({ package: 'chrome-devtools-mcp@latest', chromePath: '' }, DEFAULT_EXTRA_FLAGS)).toEqual([
      '-y',
      'chrome-devtools-mcp@latest',
      '--no-usage-statistics',
      '--no-performance-crux',
    ])
  })

  it('appends the executable selection when the flags do not pin one', () => {
    const args = buildServerArgs({ package: 'p', chromePath: '/x/chrome' }, ['--headless'])
    expect(args).toEqual(['-y', 'p', '--headless', '--executablePath=/x/chrome'])
  })

  it('leaves argv untouched when the flags already pin the executable', () => {
    for (const pinned of ['--executablePath=/y/chrome', '--executable-path /y/chrome', '-e /y/chrome', '-e=/y/chrome']) {
      const args = buildServerArgs({ package: 'p', chromePath: '/x/chrome' }, [pinned])
      expect(args).not.toContain('--executablePath=/x/chrome')
    }
  })

  it('does not confuse -e-prefixed flags with the executable pin', () => {
    const args = buildServerArgs({ package: 'p', chromePath: '/x/chrome' }, ['--env-var=1'])
    expect(args).toContain('--executablePath=/x/chrome')
  })
})

describe('resolveLaunchFlags', () => {
  it('uses the row config without an environment value', () => {
    expect(resolveLaunchFlags(['--a'])).toEqual({ flags: ['--a'], note: null })
    expect(resolveLaunchFlags(['--a'], '   ')).toEqual({ flags: ['--a'], note: null })
  })

  it('adopts a valid environment list while the config holds the schema default', () => {
    const resolved = resolveLaunchFlags([...DEFAULT_EXTRA_FLAGS], '--headless  --isolated')
    expect(resolved).toEqual({ flags: ['--headless', '--isolated'], note: null })
  })

  it('keeps an explicit config over the environment', () => {
    const resolved = resolveLaunchFlags(['--explicit'], '--headless')
    expect(resolved).toEqual({ flags: ['--explicit'], note: 'explicit-config' })
  })

  it('ignores an environment list carrying control characters', () => {
    const resolved = resolveLaunchFlags([...DEFAULT_EXTRA_FLAGS], '--a\x00b')
    expect(resolved).toEqual({ flags: [...DEFAULT_EXTRA_FLAGS], note: 'invalid' })
  })
})

describe('sameFlags', () => {
  it('compares element-wise', () => {
    expect(sameFlags(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameFlags(['a'], ['a', 'b'])).toBe(false)
    expect(sameFlags(['a', 'b'], ['b', 'a'])).toBe(false)
  })
})

describe('bridgeConfig', () => {
  it('builds the stdio branch with argv assembled from the flags', () => {
    const config = bridgeConfig({ ...base, chromePath: { get: () => '/x/chrome' } } as ConfigValue, ['--headless'])
    expect(config.transport).toBe('stdio')
    expect(config.command).toBe('npx')
    expect(config.args).toEqual(['-y', 'chrome-devtools-mcp@latest', '--headless', '--executablePath=/x/chrome'])
    expect(config.reconnect).toEqual(base.reconnect)
    expect(config.toolCallTimeoutMs).toBe(60000)
  })
})
