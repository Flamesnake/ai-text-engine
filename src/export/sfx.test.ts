import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { disposeSfx, initSfx, isMuted, playSfx, setMuted, toggleMuted } from './sfx.js'

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
})

class FakeAudioContext {
  state: AudioContextState = 'running'
  currentTime = 0
  destination = {} as AudioDestinationNode
  readonly gains: FakeGainNode[] = []
  readonly close = vi.fn(async () => { this.state = 'closed' })
  readonly resume = vi.fn(async () => { this.state = 'running' })

  get masterGain() {
    return this.gains[0]
  }

  createGain(): FakeGainNode {
    const node = {
      gain: {
        setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    }
    this.gains.push(node)
    return node
  }

  createOscillator() {
    return {
      type: 'sine' as OscillatorType,
      frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(), start: vi.fn(), stop: vi.fn(),
    }
  }
}

interface FakeGainNode {
  gain: {
    setValueAtTime: ReturnType<typeof vi.fn>
    linearRampToValueAtTime: ReturnType<typeof vi.fn>
    exponentialRampToValueAtTime: ReturnType<typeof vi.fn>
  }
  connect: ReturnType<typeof vi.fn>
}
