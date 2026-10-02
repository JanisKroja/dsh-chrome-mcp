/**
 * The bridge configuration assembly: the stdio argv for one flags list, the
 * launch-environment override, and the config object handed to
 * `@deepseek-ai/dsh-mcp-client`.
 * @module dsh-chrome-mcp/src/bridge
 */
import { carriesExecutablePath } from './chrome-check.ts'
import { DEFAULT_EXTRA_FLAGS, FLAG_PATTERN, liveChromePath, type ConfigValue } from './config.ts'

/** The stdio-branch config dsh-mcp-client consumes. */
export interface BridgeConfig {
  serverName: string
  transport: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
  toolCallTimeoutMs: number
  failOnStartupError: boolean
  reconnect: ConfigValue['reconnect']
}

/**
 * Build the stdio argv tail for one flags list: `-y <package> [extraFlags]`
 * (spawned with `command`, default `npx`), so the final invocation is
 * `npx -y chrome-devtools-mcp@latest [extraFlags]`. When an executable is
 * selected and the flags do not already carry an executable-path option,
 * `--executablePath=<path>` is appended.
 * @param entry - the launcher spec and the live executable selection.
 * @param extraFlags - the flags list to append.
 * @returns the argv tail for one bridge launch.
 */
export function buildServerArgs(
  entry: { package: string; chromePath: string },
  extraFlags: readonly string[],
): string[] {
  const flags = Array.isArray(extraFlags) ? extraFlags.filter((flag) => typeof flag === 'string') : []
  const args = ['-y', entry.package, ...flags]
  const executable = typeof entry.chromePath === 'string' ? entry.chromePath.trim() : ''
  if (executable !== '' && !flags.some((flag) => carriesExecutablePath(flag))) {
    args.push(`--executablePath=${executable}`)
  }
  return args
}

/** True when two flags lists are element-wise equal. */
export function sameFlags(a: readonly string[], b: readonly string[]): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  return a.every((flag, index) => flag === b[index])
}

/**
 * Environment variable that seeds the launch flags for one dsh run: a
 * whitespace-separated extraFlags list, e.g.
 * `DSH_CHROME_MCP_FLAGS="--headless --isolated"`.
 */
export const FLAGS_ENV_VAR = 'DSH_CHROME_MCP_FLAGS'

/** The outcome of resolving the launch flags, with the reason a valid env list was not used. */
export interface ResolvedFlags {
  flags: string[]
  /** Non-null when the environment supplied a value that was not adopted. */
  note: 'invalid' | 'explicit-config' | null
}

/**
 * Resolve the launch flags: the environment list wins only while the row
 * config still carries the schema default (0.2 has no separate user layer to
 * outrank the environment — an explicit config or Settings edit is exactly
 * the row config). A malformed environment list is ignored with a note.
 * @param configured - the row-config `extraFlags` value.
 * @param envValue - `DSH_CHROME_MCP_FLAGS` as seen in the launch environment.
 * @returns the flags to launch with and why an environment value was dropped.
 */
export function resolveLaunchFlags(
  configured: readonly string[],
  envValue?: string,
): ResolvedFlags {
  if (typeof envValue !== 'string' || envValue.trim() === '') return { flags: [...configured], note: null }
  const flags = envValue.split(/\s+/u).filter((flag) => flag !== '')
  if (flags.length === 0 || flags.some((flag) => !FLAG_PATTERN.test(flag))) {
    return { flags: [...configured], note: 'invalid' }
  }
  if (!sameFlags(configured, DEFAULT_EXTRA_FLAGS)) return { flags: [...configured], note: 'explicit-config' }
  return { flags, note: null }
}

/** The stdio bridge config for one launch: argv assembled from the live executable selection. */
export function bridgeConfig(config: ConfigValue, extraFlags: readonly string[]): BridgeConfig {
  return {
    serverName: config.serverName,
    transport: 'stdio',
    command: config.command,
    args: buildServerArgs({ package: config.package, chromePath: liveChromePath(config) }, extraFlags),
    env: config.env,
    cwd: config.cwd,
    toolCallTimeoutMs: config.toolCallTimeoutMs,
    failOnStartupError: config.failOnStartupError,
    reconnect: config.reconnect,
  }
}
