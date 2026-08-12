import { beforeEach, describe, expect, it } from 'vitest'
import { initSfx, isMuted, playSfx, setMuted, toggleMuted } from './sfx.js'

beforeEach(() => {
  localStorage.clear()
  setMuted(false) // 重置为默认
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
    const names = ['click', 'page', 'heartbeat', 'drone', 'achievement', 'ending_good', 'ending_bad', 'ending_true', 'shock'] as const
    for (const n of names) {
      expect(() => playSfx(n)).not.toThrow()
    }
  })
})
