import { describe, expect, it } from 'vitest'
import { checkChrome, createProbe, discoverChrome, firstLine, isChromeMissing, type ProbeChild, type SpawnLike } from '../src/chrome-check.ts'

/** A scripted `--version` probe standing in for real subprocesses. */
function fakeProbe(plan: Record<string, { version?: string; enoent?: boolean; fail?: string }>) {
  const calls: string[] = []
  const probe = async (target: string): Promise<string> => {
    calls.push(target)
    const outcome = plan[target]
    if (outcome === void 0 || outcome.enoent === true) {
      const error = new Error(`Chrome executable not found: ${target}`)
      ;(error as NodeJS.ErrnoException).code = 'ENOENT'
      throw error
    }
    if (outcome.fail !== void 0) throw new Error(outcome.fail)
    return outcome.version ?? ''
  }
  return { probe, calls }
}

/** A minimal event-emitting child for createProbe tests. */
class FakeChild {
  stdout = listeners('data')
  stderr = listeners('data')
  private own = new Map<string, ((...args: unknown[]) => void)[]>()
  on(event: string, listener: (...args: unknown[]) => void): void {
    const list = this.own.get(event) ?? []
    list.push(listener)
    this.own.set(event, list)
  }
  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.own.get(event) ?? []) listener(...args)
  }
}

function listeners(_event: string) {
  const store: ((chunk: unknown) => void)[] = []
  return {
    on(_e: 'data', listener: (chunk: unknown) => void) {
      store.push(listener)
    },
    push(chunk: unknown) {
      for (const listener of store) listener(chunk)
    },
  }
}

function spawnWith(run: (child: FakeChild) => void) {
  const spawnImpl: SpawnLike = (_command, _args, _options) => {
    const child = new FakeChild()
    setTimeout(() => run(child), 0)
    return child as unknown as ProbeChild
  }
  return spawnImpl
}

describe('discoverChrome', () => {
  it('probes candidates in order and returns the first runnable version', async () => {
    const { probe, calls } = fakeProbe({
      '/a': { enoent: true },
      '/b': { fail: 'permission denied' },
      '/c': { version: 'Google Chrome 140.0.0.0' },
    })
    expect(await discoverChrome(['/a', '/b', '/c'], probe)).toBe('Google Chrome 140.0.0.0')
    expect(calls).toEqual(['/a', '/b', '/c'])
  })

  it('reports the present-but-broken candidate over the not-found summary', async () => {
    const { probe } = fakeProbe({ '/a': { enoent: true }, '/b': { fail: 'permission denied' } })
    await expect(discoverChrome(['/a', '/b'], probe)).rejects.toThrow('permission denied')
  })

  it('names every checked path when all candidates are missing', async () => {
    const { probe } = fakeProbe({})
    await expect(discoverChrome(['/a', '/b'], probe)).rejects.toThrow('no executable detected (checked: /a, /b)')
  })

  it('resolves empty when there is nothing to probe', async () => {
    const { probe, calls } = fakeProbe({})
    expect(await discoverChrome(['  ', ''], probe)).toBe('')
    expect(calls).toEqual([])
  })
})

describe('checkChrome', () => {
  it('probes an explicit executable even when flags pin another', async () => {
    const { probe, calls } = fakeProbe({ '/x/chrome': { version: 'Google Chrome 140' } })
    expect(await checkChrome({ chromePath: '/x/chrome', chromePaths: [], extraFlags: ['--executablePath=/y'] }, probe)).toBe('Google Chrome 140')
    expect(calls).toEqual(['/x/chrome'])
  })

  it('skips the probe when the flags pin the executable or a connect mode', async () => {
    const { probe, calls } = fakeProbe({})
    const skipped = ['', '--browserUrl=http://127.0.0.1:9222', '--wsEndpoint=ws://x', '--executablePath=/z']
    for (const flag of skipped.filter((candidate) => candidate !== '')) {
      expect(await checkChrome({ chromePath: '', chromePaths: ['/never'], extraFlags: [flag] }, probe)).toBe('')
    }
    expect(calls).toEqual([])
  })

  it('resolves empty with no flags and no candidates to probe', async () => {
    const { probe } = fakeProbe({})
    expect(await checkChrome({ chromePath: '', chromePaths: [], extraFlags: [] }, probe)).toBe('')
  })

  it('discovers over the candidates otherwise', async () => {
    const { probe, calls } = fakeProbe({ '/a': { version: 'Google Chrome 140' } })
    expect(await checkChrome({ chromePath: '', chromePaths: ['/a'], extraFlags: ['--headless'] }, probe)).toBe('Google Chrome 140')
    expect(calls).toEqual(['/a'])
  })
})

describe('createProbe', () => {
  it('resolves the version line on success', async () => {
    const probe = createProbe(spawnWith((child) => {
      child.stdout.push('Google Chrome 140.0.7339.184\n')
      child.emit('close', 0)
    }))
    expect(await probe('/x/chrome')).toBe('Google Chrome 140.0.7339.184')
  })

  it('rejects with ENOENT code when the binary is missing', async () => {
    const probe = createProbe(spawnWith((child) => {
      const error = new Error('spawn ENOENT') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      child.emit('error', error)
    }))
    await expect(probe('/x/chrome')).rejects.toThrow('Chrome executable not found: /x/chrome')
  })

  it('reports the first stderr line on a non-zero exit', async () => {
    const probe = createProbe(spawnWith((child) => {
      child.stderr.push('libgtk is missing\nsecond line')
      child.emit('close', 1)
    }))
    await expect(probe('/x/chrome')).rejects.toThrow('"/x/chrome --version" failed: libgtk is missing')
  })

  it('reports the timeout when killed without an exit code', async () => {
    const probe = createProbe(spawnWith((child) => child.emit('close', null)), 1234)
    await expect(probe('/x/chrome')).rejects.toThrow('timed out after 1234ms')
  })

  it('rejects when spawn itself throws', async () => {
    const probe = createProbe(() => {
      throw new Error('EACCES')
    })
    await expect(probe('/x/chrome')).rejects.toThrow('could not run "/x/chrome --version"')
  })
})

describe('firstLine / isChromeMissing', () => {
  it('takes the first non-empty line, capped', () => {
    expect(firstLine('\n  \nreal error\nmore')).toBe('real error')
    expect(firstLine('x'.repeat(400)).length).toBe(240)
    expect(firstLine(void 0)).toBe('')
  })

  it('recognizes the known executable-missing failures', () => {
    for (const message of [
      'Chrome executable not found: /x/chrome',
      "Could not find Google Chrome executable for channel 'stable' at: /mnt/c/chrome.exe",
      'Failed to launch the browser process: EXIT 1',
      'Browser was not found at the configured executablePath',
    ]) {
      expect(isChromeMissing(message)).toBe(true)
    }
    expect(isChromeMissing('Target closed')).toBe(false)
    expect(isChromeMissing('')).toBe(false)
  })
})
