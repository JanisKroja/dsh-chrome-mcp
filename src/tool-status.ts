/**
 * One chrome-tool call projected onto the plugin's status log — the capture
 * point for tool-level failures (browser unreachable, "Target closed", …),
 * which are returned to the calling agent and never route through the bridge
 * logger.
 * @module dsh-chrome-mcp/src/tool-status
 */
import { firstLine } from './chrome-check.ts'

/** The result fields the projection reads, structurally. */
export interface ToolResultLike {
  isError?: boolean
  content?: readonly { type?: string; text?: string }[]
  error?: unknown
}

/**
 * Summarize one chrome-tool call result. Failed calls return
 * "<tool> failed: <first text line>"; successes return null and the caller
 * treats that as "tools are responding".
 * @param toolName - fully qualified registered name (`mcp__<server>__<tool>`).
 * @param result - settled tools-service execution result.
 * @returns the note, or null when the call did not fail.
 */
export function toolResultNote(toolName: string, result: ToolResultLike | undefined): string | null {
  if (!result || result.isError !== true) return null
  const blocks = Array.isArray(result.content) ? result.content : []
  let text = blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join(' ')
  if (text === '' && result.error && typeof result.error === 'object' && typeof (result.error as { message?: unknown }).message === 'string') {
    text = String((result.error as { message: string }).message)
  }
  if (text === '') text = result.error === void 0 ? 'unknown error' : String(result.error)
  return firstLine(`${toolName.split('__').pop()} failed: ${text}`)
}
