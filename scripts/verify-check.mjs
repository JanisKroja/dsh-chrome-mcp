#!/usr/bin/env node
// One real Chrome executable check against the built plugin, no dsh required.
// Exercises the discovery paths and prints the verdict; exits non-zero when
// no executable is usable, so CI smoke jobs can gate on it.
import { checkChrome, defaultChromePaths } from '../lib/index.js'

const chromePath = process.env['CHROME_PATH'] ?? ''
try {
  const version = await checkChrome({ chromePath, chromePaths: defaultChromePaths(), extraFlags: [] })
  console.log(version === '' ? 'nothing probed (nothing to check)' : `found: ${version}`)
} catch (error) {
  console.error(String(error instanceof Error ? error.message : error))
  process.exitCode = 1
}
