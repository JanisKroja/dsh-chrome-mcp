/**
 * Chrome executable discovery and version probe — pure logic around one
 * injected `--version` probe, so every decision is testable without a
 * Chrome install.
 * @module dsh-chrome-mcp/src/chrome-check
 */
import { spawn } from 'node:child_process'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { defaultChromePaths } from './config.ts'

/** Timeout for one `--version` probe subprocess. */
export const CHECK_TIMEOUT_MS = 15000

/** Max length of a reported error line. */
export const ERROR_CAP = 240

/** One spawned `--version` child, as far as this module needs it. */
export interface ProbeChild {
  stdout: { on(event: 'data', listener: (chunk: unknown) => void): void }
  stderr: { on(event: 'data', listener: (chunk: unknown) => void): void }
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): void
  on(event: 'close', listener: (code: number | null) => void): void
}

/** The spawn shape {@link createProbe} consumes. */
export type SpawnLike = (command: string, args: readonly string[], options: unknown) => ProbeChild

/** The probe shape the check pipeline consumes. */
export type Probe = (target: string) => Promise<string>

/** First non-empty line of a text block, capped. */
export function firstLine(text: unknown, cap = ERROR_CAP): string {
  const line =
    String(text ?? '')
      .split(/\r?\n/u)
      .find((candidate) => candidate.trim() !== '') ?? ''
  return line.trim().slice(0, cap)
}

/**
 * Build the `chromePath --version` probe: scrubs the parent env, bounds the
 * subprocess, resolves the version line, and classifies failures — ENOENT
 * rejects with code `ENOENT` carrying "Chrome executable not found: <path>";
 * a timeout rejects with the budget; a non-zero exit rejects with the first
 * stderr/stdout line.
 * @param spawnImpl - the spawn implementation to drive.
 * @param timeoutMs - the subprocess timeout.
 * @returns the probe for one executable path.
 */
export function createProbe(spawnImpl: SpawnLike, timeoutMs = CHECK_TIMEOUT_MS): Probe {
  return (target) =>
    new Promise<string>((resolve, reject) => {
      let child: ProbeChild
      try {
        child = spawnImpl(target, ['--version'], {
          env: scrubbedParentEnv(),
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: timeoutMs,
          killSignal: 'SIGKILL',
        })
      } catch (error) {
        reject(new Error(`could not run "${target} --version": ${String(error)}`))
        return
      }
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => (stdout += chunk))
      child.stderr.on('data', (chunk) => (stderr += chunk))
      child.on('error', (error) => {
        if (error.code === 'ENOENT') {
          const missing = new Error(`Chrome executable not found: ${target}`) as NodeJS.ErrnoException
          missing.code = 'ENOENT'
          reject(missing)
          return
        }
        reject(new Error(`could not run "${target} --version": ${String(error)}`))
      })
      child.on('close', (code) => {
        if (code === null) {
          reject(new Error(`"${target} --version" timed out after ${String(timeoutMs)}ms`))
          return
        }
        if (code !== 0) {
          const detail = firstLine(stderr) !== '' ? firstLine(stderr) : firstLine(stdout) !== '' ? firstLine(stdout) : `exit code ${String(code)}`
          reject(new Error(`"${target} --version" failed: ${detail}`))
          return
        }
        resolve(firstLine(stdout))
      })
    })
}

/** The probe shared by the check pipeline when none is injected. */
export const defaultProbe: Probe = createProbe((command, args, options) =>
  spawn(command, [...args], options as never) as unknown as ProbeChild,
)

/** True when a flag already selects the Chrome executable (upstream flags:
 * `--executablePath` / `--executable-path` / `-e`, with or without `=`). */
export function carriesExecutablePath(flag: string): boolean {
  return /^(?:--executablePath|--executable-path|-e)(?:=|(?=\s)|$)/u.test(flag)
}

/** True when one flag declares a connect mode (no local executable needed). */
export function carriesConnectionMode(flag: string): boolean {
  return /^--(?:browserUrl|wsEndpoint)(?:=|(?=\s)|$)/iu.test(flag)
}

/** The inputs one check run consults. */
export interface CheckEntry {
  /** Explicit executable path; empty discovers. */
  chromePath: string
  /** Discovery candidates used when `chromePath` is empty. */
  chromePaths: readonly string[]
  /** The flags the bridge launches with; only inspected for pinning/connect-mode options. */
  extraFlags: readonly string[]
}

/** The `code` property of an unknown catch-site error, stringified or empty. */
function errCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return ''
}

/**
 * Discover a usable Google Chrome executable when `chromePath` is empty:
 * probe every candidate in order. The first runnable candidate resolves its
 * version line. A candidate that exists but is not usable (non-ENOENT
 * failure) reports that detail — the binary is there and broken. All
 * candidates ENOENT reject with the known executable-not-found error listing
 * the checked paths. An empty candidate list resolves `""` — nothing probed
 * (unknown platform).
 * @param candidatePaths - candidate executable paths (default: platform list).
 * @param probe - the `--version` probe implementation.
 * @returns the discovered executable version line.
 */
export async function discoverChrome(
  candidatePaths: readonly string[] = defaultChromePaths(),
  probe: Probe = defaultProbe,
): Promise<string> {
  const candidates = (Array.isArray(candidatePaths) ? candidatePaths : defaultChromePaths())
    .map((candidate) => String(candidate ?? '').trim())
    .filter((candidate) => candidate !== '')
  if (candidates.length === 0) return ''
  let presentFailure = ''
  for (const candidate of candidates) {
    try {
      return await probe(candidate)
    } catch (error) {
      if (errCode(error) === 'ENOENT') continue
      if (presentFailure === '') presentFailure = error instanceof Error ? error.message : String(error)
    }
  }
  if (presentFailure !== '') throw new Error(presentFailure)
  throw new Error(`Chrome executable not found: no executable detected (checked: ${candidates.join(', ')})`)
}

/**
 * Run one check: an explicit `chromePath` probes that executable; otherwise
 * the flags pinning an executable (`--executablePath`, …) or declaring a
 * connect mode (`--browserUrl` / `--wsEndpoint`) skip the probe ("" — the
 * bridge resolves the executable, or needs none, itself); otherwise
 * {@link discoverChrome} runs over the candidate list.
 *
 * NOTE: from WSL the executable must be a Linux binary. Launching the
 * Windows chrome.exe through the WSL interop layer fails: chrome-devtools-mcp
 * connects with `pipe: true` (inherited fd 3/4), which Windows-side
 * processes cannot receive, and the WebSocket fallback hard-codes 127.0.0.1
 * in the DevToolsActivePort file, unreachable across the WSL2 NAT bridge.
 * Do not "fix" discovery by pointing candidates at a /mnt/c executable.
 * @param entry - the fields one check run consults.
 * @param probe - the `--version` probe implementation.
 * @returns the executable version line, or `""` when nothing is probed.
 */
export function checkChrome(entry: CheckEntry, probe: Probe = defaultProbe): Promise<string> {
  const target = typeof entry.chromePath === 'string' ? entry.chromePath.trim() : ''
  if (target !== '') return probe(target)
  const flags = Array.isArray(entry.extraFlags) ? entry.extraFlags : []
  if (flags.some((flag) => typeof flag === 'string' && (carriesExecutablePath(flag) || carriesConnectionMode(flag)))) {
    return Promise.resolve('')
  }
  return discoverChrome(entry.chromePaths, probe)
}

/**
 * Recognize the known, developer-actionable "no Chrome executable was
 * detected" failure: our own ENOENT/discovery lines, the upstream
 * executable-discovery failures (puppeteer's channel miss), and the umbrella
 * launch failure chrome-devtools-mcp surfaces when it cannot start a browser
 * binary. Upstream starts the browser lazily (first tool call), so the check
 * probe is what surfaces the state without one.
 * @param text - an error message (or first line thereof).
 * @returns whether the failure is the known executable-missing state.
 */
export function isChromeMissing(text: unknown): boolean {
  const message = String(text ?? '')
  return (
    /chrome executable not found/iu.test(message) ||
    /could not find (?:google )?chrome(?: executable)?/iu.test(message) ||
    /browser was not found at the configured executablePath/iu.test(message) ||
    /failed to launch the browser process/iu.test(message)
  )
}
