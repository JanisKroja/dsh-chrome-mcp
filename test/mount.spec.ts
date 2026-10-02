import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply as chromeMcpApply, inject as chromeMcpInject, name as chromeMcpName } from '../src/index.ts'
import { DEFAULT_EXTRA_FLAGS, type ConfigValue } from '../src/config.ts'

/** Configs the mocked bridge received, in order. */
const bridgeConfigs = vi.hoisted(() => [] as { args: string[]; serverName: string }[])

vi.mock('@deepseek-ai/dsh-mcp-client', () => ({
  name: 'mcp-client',
  inject: [],
  Config: undefined,
  apply: (_ctx: unknown, config: { args: string[]; serverName: string }) => {
    bridgeConfigs.push(config)
  },
}))

const plugin = { name: chromeMcpName, inject: chromeMcpInject, apply: chromeMcpApply }

const rowConfig = {
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

describe('mounting the plugin', () => {
  // The empty candidate list keeps the startup check off real subprocesses.
  it('mounts the stdio bridge with the configured argv', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, { ...rowConfig, extraFlags: ['--headless'] })
    expect(bridgeConfigs).toHaveLength(1)
    expect(bridgeConfigs[0]).toMatchObject({
      serverName: 'chrome',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest', '--headless'],
    })
    await fiber.dispose()
  })

  it('remounts the bridge with new argv when the config updates', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, { ...rowConfig })
    const before = bridgeConfigs.length
    fiber.update({ ...rowConfig, extraFlags: ['--isolated'], chromePath: '/x/chrome' }, true)
    await vi.waitFor(() => expect(bridgeConfigs.length).toBeGreaterThan(before))
    const latest = bridgeConfigs.at(-1)
    expect(latest?.args).toEqual(['-y', 'chrome-devtools-mcp@latest', '--isolated', '--executablePath=/x/chrome'])
    await fiber.dispose()
  })
})
