import { describe, expect, it } from 'vitest'
import { toolResultNote } from '../src/tool-status.ts'

describe('toolResultNote', () => {
  it('summarizes a failed call from its text content', () => {
    expect(
      toolResultNote('mcp__chrome__navigate_page', {
        isError: true,
        content: [{ type: 'text', text: 'Target closed' }],
      }),
    ).toBe('navigate_page failed: Target closed')
  })

  it('falls back to the error message, then a literal note', () => {
    expect(toolResultNote('mcp__chrome__screenshot', { isError: true, content: [{ type: 'image' }], error: { message: 'boom' } })).toBe(
      'screenshot failed: boom',
    )
    expect(toolResultNote('mcp__chrome__screenshot', { isError: true })).toBe('screenshot failed: unknown error')
    expect(toolResultNote('mcp__chrome__screenshot', { isError: true, error: 'weird' })).toBe('screenshot failed: weird')
  })

  it('returns null for successes and absent results', () => {
    expect(toolResultNote('mcp__chrome__navigate_page', { isError: false, content: [{ type: 'text', text: 'ok' }] })).toBeNull()
    expect(toolResultNote('mcp__chrome__navigate_page', void 0)).toBeNull()
  })

  it('caps the note length', () => {
    const note = toolResultNote('mcp__chrome__evaluate_script', { isError: true, content: [{ type: 'text', text: 'x'.repeat(500) }] })
    expect(note ?? '').toHaveLength(240)
  })
})
