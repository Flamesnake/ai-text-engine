import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { disposeSfx, initSfx, isMuted, playSfx, setMuted, setSoundscape, toggleMuted } from './sfx.js'

const originalAudioContext = globalThis.AudioContext

beforeEach(() => {
  localStorage.clear()
  setMuted(false) // 重置为默认
})

afterEach(async () => {
  await disposeSfx()
  globalThis.AudioContext = originalAudioContext
})

describe('sfx 音效模块', () => {
  it('默认未静音，setMuted 持久化到 localStorage', () => {
    initSfx()
    expect(isMuted()).toBe(false)
    setMuted(true)
    expect(isMuted()).toBe(true)
    expect(localStorage.getItem('ate:sfx:muted')).toBe('1')
    // 模拟下次会话：从存储恢复
    initSfx()
    expect(isMuted()).toBe(true)
  })

  it('toggleMuted 切换并返回新状态', () => {
    initSfx()
    expect(toggleMuted()).toBe(true)
    expect(toggleMuted()).toBe(false)
  })

  it('playSfx 在无 AudioContext 环境（测试环境）静默不抛错', () => {
    expect(() => playSfx('click')).not.toThrow()
    expect(() => playSfx('heartbeat')).not.toThrow()
    expect(() => playSfx('ending_good')).not.toThrow()
    expect(() => playSfx('shock')).not.toThrow()
    // 静音状态下同样不抛错
    setMuted(true)
    expect(() => playSfx('drone')).not.toThrow()
  })

  it('所有内置音效名均可安全播放', () => {
    const names = ['click', 'page', 'heartbeat', 'drone', 'achievement', 'ending_good', 'ending_bad', 'ending_true', 'ending_hidden', 'shock'] as const
    for (const n of names) {
      expect(() => playSfx(n)).not.toThrow()
    }
  })

  it('静音立即控制主增益，dispose 关闭上下文且下次播放可重建', async () => {
    const contexts: FakeAudioContext[] = []
    globalThis.AudioContext = class extends FakeAudioContext {
      constructor() {
        super()
        contexts.push(this)
      }
    } as unknown as typeof AudioContext

    playSfx('click')
    expect(contexts).toHaveLength(1)
    expect(contexts[0].masterGain.gain.setValueAtTime).toHaveBeenLastCalledWith(1, 0)

    setMuted(true)
    expect(contexts[0].masterGain.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 0)
    await disposeSfx()
    expect(contexts[0].close).toHaveBeenCalledOnce()

    setMuted(false)
    playSfx('page')
    expect(contexts).toHaveLength(2)
  })

  it('浏览器挂起 AudioContext 时在首次用户触发播放后恢复', () => {
    let context: FakeAudioContext | undefined
    globalThis.AudioContext = class extends FakeAudioContext {
      constructor() {
        super()
        this.state = 'suspended'
        context = this
      }
    } as unknown as typeof AudioContext

    playSfx('click')
    expect(context?.resume).toHaveBeenCalledOnce()
  })

  it('持续声景只在规格变化时交叉淡化，并可显式回到寂静', () => {
    let context: FakeAudioContext | undefined
    globalThis.AudioContext = class extends FakeAudioContext {
      constructor() {
        super()
        context = this
      }
    } as unknown as typeof AudioContext

    setSoundscape({ name: 'rain', intensity: 'subtle' })
    expect(context?.bufferSources).toHaveLength(2)
    const originalSources = [...(context?.bufferSources ?? [])]
    const originalGainCount = context?.gains.length

    // 同一规格沿用声音节点，不重新起音。
    setSoundscape({ name: 'rain', intensity: 'subtle' })
    expect(context?.bufferSources).toHaveLength(2)
    expect(context?.gains.length).toBe(originalGainCount)

    setSoundscape({ name: 'storm', intensity: 'strong' })
    for (const source of originalSources) expect(source.stop).toHaveBeenCalledWith(1.25)
    expect(context?.oscillators).toHaveLength(1)

    const stormSources = [...(context?.bufferSources.slice(2) ?? []), ...(context?.oscillators ?? [])]
    setSoundscape(null)
    for (const source of stormSources) expect(source.stop).toHaveBeenCalledWith(1.25)
  })

  it('无 AudioContext 时设置声景静默降级', () => {
    expect(() => setSoundscape({ name: 'void', intensity: 'medium' })).not.toThrow()
    expect(() => setSoundscape(null)).not.toThrow()
  })
})

class FakeAudioContext {
  state: AudioContextState = 'running'
  currentTime = 0
  sampleRate = 8
  destination = {} as AudioDestinationNode
  readonly gains: FakeGainNode[] = []
  readonly oscillators: FakeSourceNode[] = []
  readonly bufferSources: FakeSourceNode[] = []
  readonly close = vi.fn(async () => { this.state = 'closed' })
  readonly resume = vi.fn(async () => { this.state = 'running' })

  get masterGain() {
    return this.gains[0]
  }

  createGain(): FakeGainNode {
    const node = {
      gain: {
        value: 0,
        setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
      },
      connect: vi.fn(),
    }
    this.gains.push(node)
    return node
  }

  createOscillator() {
    const source = {
      type: 'sine' as OscillatorType,
      frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(), start: vi.fn(), stop: vi.fn(),
    }
    this.oscillators.push(source)
    return source
  }

  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length)
    return { getChannelData: vi.fn(() => data) }
  }

  createBufferSource() {
    const source = {
      buffer: null,
      loop: false,
      connect: vi.fn(), start: vi.fn(), stop: vi.fn(),
    }
    this.bufferSources.push(source)
    return source
  }

  createBiquadFilter() {
    return {
      type: 'lowpass' as BiquadFilterType,
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
    }
  }
}

interface FakeGainNode {
  gain: {
    value: number
    setValueAtTime: ReturnType<typeof vi.fn>
    linearRampToValueAtTime: ReturnType<typeof vi.fn>
    exponentialRampToValueAtTime: ReturnType<typeof vi.fn>
    cancelScheduledValues: ReturnType<typeof vi.fn>
  }
  connect: ReturnType<typeof vi.fn>
}

interface FakeSourceNode {
  connect: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}
