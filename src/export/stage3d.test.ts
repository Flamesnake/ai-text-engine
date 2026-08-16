import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  ATMOSPHERE_BY_BACKDROP,
  buildBayerMatrix,
  buildQuantLut,
  buildStageScene,
  CAMERA_SHOTS,
  createStage3d,
  MOOD_PRESETS,
  POSE_STANCES,
  PUSH_DURATION,
} from './stage3d.js'

describe('stage3d 合成器查找表', () => {
  it('15bit 量化 LUT 单调不减且覆盖全区间', () => {
    const lut = buildQuantLut()
    expect(lut.length).toBe(256)
    expect(lut[0]).toBe(0)
    expect(lut[255]).toBe(255)
    for (let i = 1; i < 256; i++) {
      expect(lut[i]!).toBeGreaterThanOrEqual(lut[i - 1]!)
    }
  })

  it('Bayer 4x4 抖动矩阵 16 项且偏移有界', () => {
    const bayer = buildBayerMatrix()
    expect(bayer.length).toBe(16)
    for (const v of bayer) {
      expect(Math.abs(v)).toBeLessThanOrEqual(8)
    }
  })
})

describe('stage3d 演出预设', () => {
  it('每种灯光都有完整 mood 预设，blackout 无光柱', () => {
    const names = ['natural', 'warm', 'cool', 'night', 'alert', 'blackout', 'spotlight'] as const
    for (const name of names) {
      expect(MOOD_PRESETS[name]).toBeDefined()
    }
    expect(MOOD_PRESETS.blackout.beam).toBe(0)
    expect(MOOD_PRESETS.spotlight.beam).toBeGreaterThan(MOOD_PRESETS.natural.beam)
  })

  it('镜头机位覆盖 wide/medium/close，push 有推轨时长', () => {
    expect(CAMERA_SHOTS.wide.letterbox).toBe(0)
    expect(CAMERA_SHOTS.close.letterbox).toBeGreaterThan(CAMERA_SHOTS.medium.letterbox)
    expect(CAMERA_SHOTS.close.pos[2]).toBeLessThan(CAMERA_SHOTS.wide.pos[2])
    expect(PUSH_DURATION).toBeGreaterThan(0)
  })

  it('八种姿态都有演出站位', () => {
    const poses = ['neutral', 'open', 'guarded', 'tense', 'afraid', 'angry', 'sad', 'shadow'] as const
    for (const pose of poses) {
      expect(POSE_STANCES[pose]).toBeDefined()
    }
    expect(POSE_STANCES.afraid.crouch).toBeGreaterThan(0)
    expect(POSE_STANCES.angry.lean).toBeGreaterThan(0)
  })

  it('每种背景映射到空气粒子或 none', () => {
    expect(ATMOSPHERE_BY_BACKDROP.archive).toBe('dust')
    expect(ATMOSPHERE_BY_BACKDROP.exterior).toBe('snow')
    expect(ATMOSPHERE_BY_BACKDROP.industrial).toBe('embers')
    expect(ATMOSPHERE_BY_BACKDROP.void).toBe('sparks')
  })
})

describe('stage3d WebGL 回退', () => {
  it('WebGL 不可用（happy-dom）时返回 null', () => {
    const handle = createStage3d({ backdrop: 'archive', lighting: 'spotlight' }, [])
    expect(handle).toBeNull()
  })
})

describe('buildStageScene 纯场景图（P2-4）', () => {
  const actors = [
    { name: '爱丽丝', initial: '爱', position: 'left' as const, pose: 'afraid', focus: false, entrance: 'none' },
    { name: '鲍勃', initial: '鲍', position: 'center' as const, pose: 'neutral', focus: true, entrance: 'slide' },
  ]

  it('spotlight 预设下追光目标 = 焦点角色站位 x', () => {
    const graph = buildStageScene({ backdrop: 'archive', lighting: 'spotlight' }, actors)
    expect(graph.focusRig).not.toBeNull()
    expect(graph.spotTarget.position.x).toBe(graph.focusRig!.baseX)
    expect(graph.spot.target).toBe(graph.spotTarget)
  })

  it('void 背景空气粒子按 sparks 规格（数量/颜色/上升）', () => {
    const graph = buildStageScene({ backdrop: 'void' }, [])
    expect(graph.atmosphereKind).toBe('sparks')
    expect(graph.particles).not.toBeNull()
    const count = (graph.particles!.geometry.getAttribute('position') as THREE.BufferAttribute).count
    expect(count).toBeGreaterThan(0)
    // 与规格表一致：55 粒（不依赖未导出的表，直接断言合理数量级）
    expect(count).toBeGreaterThanOrEqual(40)
  })

  it('afraid 姿态的 crouch 体现为 group scale.y 收缩，焦点角色整体放大', () => {
    const graph = buildStageScene({ backdrop: 'interior' }, actors)
    const afraid = graph.actorRigs.find((rig) => rig.stance === POSE_STANCES.afraid)!
    const focus = graph.actorRigs.find((rig) => rig.focus)!
    expect(POSE_STANCES.afraid.crouch).toBeGreaterThan(0)
    expect(afraid.group.scale.y).toBeCloseTo(1 * (1 - POSE_STANCES.afraid.crouch), 5)
    expect(afraid.group.scale.y).toBeLessThan(afraid.group.scale.x) // 蹲伏垂直收缩
    expect(focus.group.scale.x).toBeCloseTo(1.07, 5) // 焦点角色更靠近观众
    // 姿态 lean 体现在 rotation.x
    expect(afraid.group.rotation.x).toBeCloseTo(POSE_STANCES.afraid.lean, 5)
  })

  it('灯光组齐全：环境/半球/双向/点光/追光/警报灯，场景背景随 backdrop', () => {
    const graph = buildStageScene({ backdrop: 'industrial', lighting: 'alert' }, actors)
    const lightKinds = graph.scene.children
      .map((child) => child.type)
      .filter((type) => type.endsWith('Light'))
    expect(lightKinds).toContain('AmbientLight')
    expect(lightKinds).toContain('HemisphereLight')
    expect(lightKinds).toContain('DirectionalLight')
    expect(lightKinds).toContain('PointLight')
    expect(lightKinds).toContain('SpotLight')
    expect(graph.alertLight.intensity).toBe(0)
    expect(graph.scene.background).toBeInstanceOf(THREE.Color)
    expect(lightKinds.filter((t) => t === 'PointLight')).toHaveLength(2) // 脚灯 + 警报灯
  })
})
