import { describe, expect, it } from 'vitest'
import { Config, DEFAULT_EXTRA_FLAGS, defaultChromePaths, liveChromePath, liveExtraFlags, readLive } from '../src/config.ts'

/** The schema node surface the volatile-meta assertions read. */
interface SchemaNode {
  meta?: { volatile?: boolean }
  dict?: Record<string, SchemaNode>
}

/** Volatile callables return live references; read through them. */
function get<T>(field: T | { get(): T }): T {
  return typeof field === 'object' && field !== null && 'get' in field ? (field as { get(): T }).get() : field
}

describe('Config schema', () => {
  it('supplies the row-config defaults', () => {
    const resolved = Config()
    expect(resolved.serverName).toBe('chrome')
    expect(resolved.command).toBe('npx')
    expect(resolved.package).toBe('chrome-devtools-mcp@latest')
    expect(get(resolved.extraFlags as never)).toEqual([...DEFAULT_EXTRA_FLAGS])
    expect(get(resolved.chromePath as never)).toBe('')
    expect(resolved.toolCallTimeoutMs).toBe(60000)
    expect(resolved.failOnStartupError).toBe(false)
    expect(resolved.reconnect).toMatchObject({ enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 })
  })

  it('rejects flag entries with control characters or empty strings at the schema', () => {
    expect(() => Config({ extraFlags: ['bad\nline'] })).toThrow()
    expect(() => Config({ extraFlags: [''] })).toThrow()
    expect(() => Config({ extraFlags: ['--headless'] })).not.toThrow()
  })

  it('marks extraFlags and chromePath volatile (Settings-editable without remount)', () => {
    const node = Config as unknown as SchemaNode
    expect(node.dict?.extraFlags?.meta?.volatile).toBe(true)
    expect(node.dict?.chromePath?.meta?.volatile).toBe(true)
    expect(node.dict?.chromePaths?.meta?.volatile).not.toBe(true)
    expect(node.dict?.serverName?.meta?.volatile).not.toBe(true)
  })

  it('rejects server names outside the tool-namespace charset', () => {
    expect(() => Config({ serverName: 'bad name!' })).toThrow()
    expect(() => Config({ serverName: 'chrome' })).not.toThrow()
  })
})

describe('defaultChromePaths', () => {
  it('lists the darwin stable channel and nothing for unknown platforms', () => {
    expect(defaultChromePaths('darwin')).toEqual(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'])
    expect(defaultChromePaths('plan9')).toEqual([])
  })

  it('returns a fresh array per call', () => {
    const a = defaultChromePaths('linux')
    a.push('/mutated')
    expect(defaultChromePaths('linux')).not.toContain('/mutated')
  })
})

describe('volatile reads', () => {
  it('reads plain values outside a Loader composition', () => {
    const config = {
      extraFlags: ['--headless'],
      chromePath: ' /x/chrome ',
      chromePaths: [],
    } as never
    expect(liveExtraFlags(config)).toEqual(['--headless'])
    expect(liveChromePath(config)).toBe('/x/chrome')
  })

  it('reads through stable references inside one', () => {
    const ref = { get: () => ['--isolated'] }
    expect(readLive(ref)).toEqual(['--isolated'])
  })
})
