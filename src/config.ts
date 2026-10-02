/**
 * Plugin configuration — the single source of truth for the Settings page.
 *
 * On dsh 0.2 the harness derives the Settings → Plugins form from this
 * schema: fields marked `.volatile()` are editable from the GUI and are
 * committed to the running fiber without a remount (the fiber then receives
 * `loader/volatile-update`). Every other field is ordinary row config,
 * changed through the profile patch (a restart re-applies it).
 *
 * @module dsh-chrome-mcp/src/config
 */
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Flags every launch carries unless the user overrides them. */
export const DEFAULT_EXTRA_FLAGS = ['--no-usage-statistics', '--no-performance-crux']

/**
 * A flag reaches Chrome through a direct `execve` (no shell), so shell
 * metacharacters cannot execute here; control characters break argv framing
 * and empty entries are noise, so the schema rejects both.
 */
export const FLAG_PATTERN = /^[^\x00-\x1f\x7f]+$/u

/** Upstream configuration docs surfaced in log hints. */
export const CONFIGURATION_DOCS_URL =
  'https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md'

/**
 * Google Chrome stable-channel locations probed by discovery when
 * `chromePath` is empty — mirrors the upstream (puppeteer) system-channel
 * resolution. WSL Windows-side locations (`/mnt/c/...`) are deliberately
 * absent: the interop launch cannot work (see README), and reporting a found
 * Windows binary as healthy would be a false negative for the known
 * executable-missing state. Unknown platforms probe nothing.
 */
export const DEFAULT_CHROME_PATHS: Record<string, readonly string[]> = {
  linux: [
    '/opt/google/chrome/chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/local/bin/google-chrome',
    'google-chrome',
  ],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
}

/** The default discovery candidate list for one platform; empty probes nothing. */
export function defaultChromePaths(platform: string = process.platform): string[] {
  const candidates = DEFAULT_CHROME_PATHS[platform]
  return Array.isArray(candidates) ? [...candidates] : []
}

/** Reconnect policy passthrough; mirrors dsh-mcp-client's schema. */
const Reconnect = z.object({
  enabled: z.boolean().default(true).description('Retry a lost bridge connection before giving up.'),
  initialDelayMs: z.number().min(1).max(600000).default(500).description('First reconnect backoff.'),
  maxDelayMs: z.number().min(1).max(600000).default(30000).description('Backoff ceiling.'),
  maxAttempts: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(10).description('Attempts before giving up.'),
})

export const Config = z.object({
  serverName: z
    .string()
    .pattern(/^[A-Za-z0-9_-]{1,32}$/u)
    .default('chrome')
    .description('Tool namespace prefix (tools register as mcp__<serverName>__<tool>).'),
  command: z.string().default('npx').description('Launcher executable for the MCP server.'),
  package: z.string().min(1).default('chrome-devtools-mcp@latest').description('npm spec passed to the launcher.'),
  extraFlags: z
    .array(z.string().pattern(FLAG_PATTERN).description('One server flag, e.g. --headless or --isolated.'))
    .default([...DEFAULT_EXTRA_FLAGS])
    .description('Flags appended after the package spec. Editable from Settings without restarting.')
    .volatile(),
  chromePath: z
    .string()
    .default('')
    .description('Chrome executable override, passed as --executablePath when the flags do not pin one. Empty discovers from the candidate list. Editable from Settings without restarting.')
    .volatile(),
  chromePaths: z
    .array(z.string())
    .default(defaultChromePaths())
    .description('Discovery candidates probed when the Chrome executable is empty.'),
  env: z.dict(z.string()).default({}).description('Extra environment variables for the bridge process.'),
  cwd: z.string().default('').description('Working directory for the bridge process; empty inherits the harness.'),
  toolCallTimeoutMs: z.number().min(1000).max(600000).default(60000).description('Timeout for one MCP tool call.'),
  failOnStartupError: z.boolean().default(false).description('Fail the plugin when the bridge cannot start, instead of logging and retrying.'),
  reconnect: Reconnect.description('Reconnect policy passed through to the MCP bridge.'),
})

/** Reconnect fields as parsed from {@link Config}. */
export interface ReconnectValue {
  enabled: boolean
  initialDelayMs: number
  maxDelayMs: number
  maxAttempts: number
}

/**
 * A live config field: a stable reference inside a Loader composition (the
 * Loader re-points it on Settings commits), or the plain value when the
 * plugin is mounted directly with a literal config.
 */
export type Live<T> = T | Volatile<T>

/**
 * The validated plugin config as it reaches `apply`. Volatile fields arrive
 * as stable references the loader re-points on Settings edits; the others
 * are plain values fixed for the fiber's lifetime.
 */
export interface ConfigValue {
  serverName: string
  command: string
  package: string
  extraFlags: Live<readonly string[]>
  chromePath: Live<string>
  chromePaths: string[]
  env: Record<string, string>
  cwd: string
  toolCallTimeoutMs: number
  failOnStartupError: boolean
  reconnect: ReconnectValue
}

/**
 * Read a volatile field through its reference. Outside a Loader composition
 * (direct `ctx.plugin` mounts in tests) cordis may hand the plain value, so
 * the read accepts both shapes.
 * @param field - the volatile reference or the plain value.
 * @returns the current value as a mutable copy-free read.
 */
export function readLive<T>(field: Live<T>): T {
  const candidate = field as Partial<{ get: () => T }> | null
  if (candidate !== null && typeof candidate === 'object' && typeof candidate.get === 'function') return candidate.get()
  return field as T
}

/** The live `extraFlags` value as a fresh plain array. */
export function liveExtraFlags(config: ConfigValue): string[] {
  return [...readLive(config.extraFlags)]
}

/** The live `chromePath` value trimmed. */
export function liveChromePath(config: ConfigValue): string {
  return readLive(config.chromePath).trim()
}
