/**
 * dsh-chrome-mcp — the Chrome DevTools MCP bridge for dsh 0.2.
 *
 * Mounts the nested `@deepseek-ai/dsh-mcp-client` bridge for
 * `npx -y chrome-devtools-mcp@latest [extraFlags]` and keeps it in step with
 * the plugin Config, which the Settings → Plugins page edits directly:
 * `extraFlags` and `chromePath` are volatile fields, so a Settings commit
 * re-points the running fiber's references and the `loader/volatile-update`
 * event relaunches the bridge and re-runs the Chrome executable check.
 *
 * Status reporting is log-based (0.2 gives module plugins no host→client
 * channel): the executable check runs once per apply, chrome-tool failures
 * are summarized as warnings, and a later successful call logs the recovery.
 *
 * One plugin instance per host: the row is inserted by the shipped
 * `cordis.patch.yml`, and the entry id (`chrome-mcp`) is the Settings page
 * key.
 *
 * Config: see {@link Config}; flags precedence is explicit row config >
 * `DSH_CHROME_MCP_FLAGS` (while the config still holds the default) > schema
 * default.
 *
 * @module dsh-chrome-mcp
 */
import type { Context, Fiber } from '@deepseek-ai/cordis'
// Type-only: the `loader/volatile-update` event declaration the Loader emits.
import type {} from '@deepseek-ai/cordis-plugin-loader'
// Type-only: the `tools/post-execute` event declaration.
import type {} from '@deepseek-ai/dsh-tools'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { checkChrome, firstLine, isChromeMissing } from './chrome-check.ts'
import { bridgeConfig, FLAGS_ENV_VAR, resolveLaunchFlags, sameFlags } from './bridge.ts'
import { CONFIGURATION_DOCS_URL, Config, liveChromePath, liveExtraFlags, type ConfigValue } from './config.ts'
import { toolResultNote } from './tool-status.ts'

export const name = 'dsh-chrome-mcp'

/** No host services of our own: the nested bridge declares `tools`. */
export const inject = []

export { Config }
export type { ConfigValue }
// Public tooling surface: scripts/verify-check.mjs and downstream diagnostics.
export { checkChrome, isChromeMissing } from './chrome-check.ts'
export { defaultChromePaths } from './config.ts'

export function apply(ctx: Context, config: ConfigValue): void {
  const tag = `chrome-mcp(${config.serverName})`
  const envValue = launchEnvironmentOf(ctx).get(FLAGS_ENV_VAR)?.value
  const resolved = resolveLaunchFlags(liveExtraFlags(config), envValue)
  if (resolved.note === 'invalid') {
    ctx.logger.warn(`${tag}: ignoring ${FLAGS_ENV_VAR} — invalid flags list; using config`)
  }
  let runningFlags = resolved.flags

  /** Serialize check runs so rapid relaunches never interleave. */
  let checks = Promise.resolve()
  const runCheck = (flags: readonly string[]): Promise<void> => {
    checks = checks.then(async () => {
      try {
        const version = await checkChrome({
          chromePath: liveChromePath(config),
          chromePaths: config.chromePaths,
          extraFlags: flags,
        })
        if (version !== '') ctx.logger.info(`${tag}: Chrome check passed: ${version}`)
      } catch (error) {
        const line = firstLine(error instanceof Error ? error.message : String(error))
        const hint = isChromeMissing(line) ? ` — configuration guide: ${CONFIGURATION_DOCS_URL}` : ''
        ctx.logger.warn(`${tag}: Chrome check failed: ${line}${hint}`)
      }
    })
    return checks
  }
  void runCheck(runningFlags)

  // Tool-level status: chrome MCP tool failures (browser unreachable,
  // "Target closed", …) are returned to the calling agent and never reach
  // the bridge logger, so without this listener the log would stay quiet
  // while tools fail. Registered plainly on this ctx: untagged listeners
  // pass the tools-scoped waterfall filter globally, for every agent.
  const toolPrefix = `mcp__${config.serverName}__`
  let failureReported = false
  ctx.on('tools/post-execute', async (exec, result, next) => {
    try {
      if (typeof exec.name === 'string' && exec.name.startsWith(toolPrefix)) {
        const note = toolResultNote(exec.name, result)
        if (note !== null) {
          ctx.logger.warn(`${tag}: ${note}`)
          failureReported = true
        } else if (failureReported) {
          ctx.logger.info(`${tag}: chrome tools responding again`)
          failureReported = false
        }
      }
    } catch (error) {
      ctx.logger.warn(`${tag}: tool status capture failed: ${String(error)}`)
    }
    return next()
  })

  // The bridge. Its own log lines (reconnect backoff, spawn failures,
  // give-ups) already reach the host log on their own; nothing to capture.
  let bridgeFiber: Fiber | undefined
  const bridge = ctx.plugin(McpClient, bridgeConfig(config, runningFlags))
  void bridge.then(
    (fiber) => {
      bridgeFiber = fiber
    },
    (error: unknown) => ctx.logger.error(`${tag}: bridge failed to start: ${String(error)}`),
  )

  /** Re-apply the nested bridge with one flags list; failures logged, never thrown. */
  const applyFlags = (flags: readonly string[]): void => {
    runningFlags = [...flags]
    ctx.logger.info(`${tag}: relaunching bridge with flags [${runningFlags.join(' ')}]`)
    if (bridgeFiber === undefined) return
    void Promise.resolve(bridgeFiber.update(bridgeConfig(config, runningFlags) as never)).catch(
      (error: unknown) => ctx.logger.error(`${tag}: flags update failed: ${String(error)}`),
    )
  }

  // Settings commits to volatile fields land here without a remount.
  ctx.on('loader/volatile-update', (paths) => {
    const flags = liveExtraFlags(config)
    if (!sameFlags(flags, runningFlags)) applyFlags(flags)
    if (paths.some((path) => path.length === 0 || path[0] === 'chromePath' || path[0] === 'extraFlags')) {
      void runCheck(flags)
    }
  })
}
