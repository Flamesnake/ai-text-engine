/**
 * Web Audio 合成音效：零外部文件、保持单文件自包含。
 * 全部音效由 OscillatorNode + GainNode 程序化合成。
 * 浏览器端专用：AudioContext 在首次播放时惰性创建（符合浏览器自动播放策略）。
 */

import type { SfxName } from '../core/types.js'
export type { SfxName } from '../core/types.js'

const MUTE_KEY = 'ate:sfx:muted'

let audioCtx: AudioContext | null = null
let masterGain: GainNode | null = null
let muted = false

/** 是否静音 */
export function isMuted(): boolean {
  return muted
}

/** 设置静音（持久化到 localStorage） */
export function setMuted(value: boolean): void {
  muted = value
  if (audioCtx && masterGain && audioCtx.state !== 'closed') {
    masterGain.gain.setValueAtTime(value ? 0 : 1, audioCtx.currentTime)
  }
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0')
  } catch {
    /* noop */
  }
}

/** 切换静音，返回新状态 */
export function toggleMuted(): boolean {
  setMuted(!muted)
  return muted
}

/** 启动时读取静音偏好 */
export function initSfx(): void {
  try {
    muted = localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    /* noop */
  }
}

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null
  if (audioCtx?.state === 'closed') {
    audioCtx = null
    masterGain = null
  }
  if (!audioCtx) {
    audioCtx = new AudioContext()
    masterGain = audioCtx.createGain()
    masterGain.connect(audioCtx.destination)
    masterGain.gain.setValueAtTime(muted ? 0 : 1, audioCtx.currentTime)
  }
  if (audioCtx.state === 'suspended') void audioCtx.resume()
  return audioCtx
}

interface ToneOptions {
  type?: OscillatorType
  freq: number
  /** 终点频率（可选，用于下滑音） */
  endFreq?: number
  duration: number
  gain?: number
  delay?: number
}

function tone(ctx: AudioContext, opts: ToneOptions): void {
  const { type = 'sine', freq, endFreq, duration, gain = 0.08, delay = 0 } = opts
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  const t0 = ctx.currentTime + delay
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (endFreq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + duration)
  }
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(g)
  g.connect(masterGain ?? ctx.destination)
  osc.start(t0)
  osc.stop(t0 + duration + 0.05)
}

const SFX: Record<SfxName, (ctx: AudioContext) => void> = {
  click: (ctx) => tone(ctx, { type: 'square', freq: 520, endFreq: 380, duration: 0.06, gain: 0.04 }),
  page: (ctx) => tone(ctx, { type: 'triangle', freq: 300, endFreq: 240, duration: 0.12, gain: 0.05 }),
  heartbeat: (ctx) => {
    tone(ctx, { type: 'sine', freq: 55, endFreq: 40, duration: 0.14, gain: 0.3 })
    tone(ctx, { type: 'sine', freq: 50, endFreq: 38, duration: 0.12, gain: 0.22, delay: 0.22 })
  },
  drone: (ctx) => {
    tone(ctx, { type: 'sawtooth', freq: 48, duration: 1.4, gain: 0.028 })
    tone(ctx, { type: 'sine', freq: 96, duration: 1.4, gain: 0.014 })
  },
  achievement: (ctx) => {
    tone(ctx, { type: 'triangle', freq: 660, duration: 0.12, gain: 0.07 })
    tone(ctx, { type: 'triangle', freq: 880, duration: 0.18, gain: 0.07, delay: 0.1 })
  },
  ending_good: (ctx) => {
    tone(ctx, { type: 'triangle', freq: 523, duration: 0.15, gain: 0.06 })
    tone(ctx, { type: 'triangle', freq: 659, duration: 0.15, gain: 0.06, delay: 0.12 })
    tone(ctx, { type: 'triangle', freq: 784, duration: 0.32, gain: 0.06, delay: 0.24 })
  },
  ending_bad: (ctx) => {
    tone(ctx, { type: 'sawtooth', freq: 220, endFreq: 88, duration: 1.1, gain: 0.05 })
  },
  ending_true: (ctx) => {
    tone(ctx, { type: 'sine', freq: 392, duration: 0.4, gain: 0.05 })
    tone(ctx, { type: 'sine', freq: 294, duration: 0.5, gain: 0.04, delay: 0.3 })
  },
  ending_hidden: (ctx) => {
    tone(ctx, { type: 'sine', freq: 330, duration: 0.32, gain: 0.045 })
    tone(ctx, { type: 'triangle', freq: 494, duration: 0.5, gain: 0.04, delay: 0.22 })
    tone(ctx, { type: 'sine', freq: 659, duration: 0.7, gain: 0.035, delay: 0.46 })
  },
  shock: (ctx) => {
    tone(ctx, { type: 'square', freq: 980, endFreq: 520, duration: 0.1, gain: 0.05 })
    tone(ctx, { type: 'sine', freq: 60, endFreq: 30, duration: 0.35, gain: 0.22, delay: 0.02 })
  },
}

/** 播放音效（静音或环境不支持时静默） */
export function playSfx(name: SfxName): void {
  if (muted) return
  const ctx = ensureCtx()
  if (!ctx) return
  try {
    SFX[name](ctx)
  } catch {
    /* 音频失败静默，不打断游戏 */
  }
}

/** 宿主卸载游戏或测试结束时释放共享 AudioContext。 */
export async function disposeSfx(): Promise<void> {
  const ctx = audioCtx
  audioCtx = null
  masterGain = null
  if (!ctx || ctx.state === 'closed') return
  try {
    await ctx.close()
  } catch {
    /* 音频环境销毁失败不阻断宿主卸载 */
  }
}
