import * as THREE from 'three'
import type { StageBackdrop, StageCamera, StageCue, StageLighting, StagePose } from '../core/types.js'
import { STAGE_BACKDROP_COLORS, STAGE_FLOOR_COLORS } from './stage-palette.js'

export interface Stage3dActor {
  name: string
  initial: string
  position: 'left' | 'center' | 'right'
  pose: string
  focus: boolean
  entrance: string
}

export interface Stage3dHandle {
  canvas: HTMLCanvasElement
  dispose(): void
}

/** 单个角色的可演出骨架（buildStageScene 输出；测试可断言姿态/焦点/站位）。 */
export interface ActorRig {
  group: THREE.Group
  body: THREE.Mesh
  head: THREE.Mesh
  bodyMat: THREE.MeshToonMaterial
  headMat: THREE.MeshToonMaterial
  shadowMat: THREE.MeshBasicMaterial
  entrance: string
  baseX: number
  slideOffset: number
  stance: PoseStance
  focus: boolean
  breathPhase: number
}

/**
 * 纯场景图（P2-4）：与「创建 renderer」解耦，不依赖 WebGL 即可构建与断言。
 * 含灯光组、追光目标、光柱/光池、警报灯、角色骨架与空气粒子描述。 */
export interface StageSceneGraph {
  scene: THREE.Scene
  backdrop: string
  lighting: StageLighting
  mood: MoodPreset
  /** 追光目标（跟随焦点角色） */
  spotTarget: THREE.Object3D
  spot: THREE.SpotLight
  beam: THREE.Mesh
  beamMat: THREE.MeshBasicMaterial
  pool: THREE.Mesh
  poolMat: THREE.MeshBasicMaterial
  alertLight: THREE.PointLight
  actorRigs: ActorRig[]
  focusRig: ActorRig | null
  atmosphereKind: AtmosphereKind
  particles: THREE.Points | null
  particleSpeeds: Float32Array | null
  particleSway: Float32Array | null
}

/* ============================================================
 * 渲染管线（参考《幽灵诡计》/《卡门小剧场》合成器）：
 * WebGL 低分辨率渲染 → 2D 合成画布：
 * 15bit 色彩量化 + Bayer 4x4 有序抖动（消灭光锥色带）→
 * 暗角 → 镜头黑边 → 警报边缘光 → 开场淡入。
 * ============================================================ */

const VIEW_W = 512
const VIEW_H = 384

/** 8bit → 5bit 视觉近似查找表（NDS 质感） */
export function buildQuantLut(): Uint8Array {
  const lut = new Uint8Array(256)
  for (let i = 0; i < 256; i++) lut[i] = ((i >> 3) << 3) | (i >> 5)
  return lut
}

/** Bayer 4x4 有序抖动矩阵（预展开为逐像素偏移量） */
export function buildBayerMatrix(): Int8Array {
  const BM = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
  const out = new Int8Array(16)
  for (let i = 0; i < 16; i++) out[i] = Math.round((BM[i]! / 16 - 0.47) * 8)
  return out
}

const QUANT_LUT = buildQuantLut()
const BAYER = buildBayerMatrix()

/* ============================================================
 * 剧场灯光组（参考卡门 theater.js）：
 * 环境光 + 半球光 + 正面顶排洗光(key) + 侧逆光(rim) + 脚灯(foot)
 * + 追光（可见光柱 + 台面光池，跟随焦点角色）。
 * 平光为主，避免距离衰减色带。
 * ============================================================ */

interface MoodPreset {
  amb: number
  ambColor: number
  hemi: number
  hemiSky: number
  hemiGround: number
  key: number
  keyColor: number
  rim: number
  rimColor: number
  foot: number
  footColor: number
  spot: number
  spotColor: number
  /** 可见光柱峰值透明度 */
  beam: number
}

export const MOOD_PRESETS: Record<StageLighting, MoodPreset> = {
  natural: {
    amb: 0.55, ambColor: 0x8a8a96, hemi: 0.32, hemiSky: 0x9a90a8, hemiGround: 0x38302e,
    key: 0.85, keyColor: 0xfff2dd, rim: 0.28, rimColor: 0x8088c8,
    foot: 0.22, footColor: 0xffc890, spot: 0.9, spotColor: 0xffffff, beam: 0.05,
  },
  warm: {
    amb: 0.42, ambColor: 0x96826e, hemi: 0.26, hemiSky: 0xb09a7e, hemiGround: 0x2e241c,
    key: 0.8, keyColor: 0xffd9a0, rim: 0.2, rimColor: 0x8090c0,
    foot: 0.34, footColor: 0xffb070, spot: 1.7, spotColor: 0xffd9a0, beam: 0.1,
  },
  cool: {
    amb: 0.5, ambColor: 0x76828f, hemi: 0.3, hemiSky: 0x8a9ab8, hemiGround: 0x2a2e38,
    key: 0.8, keyColor: 0xa8c8ff, rim: 0.34, rimColor: 0x9ab8e8,
    foot: 0.14, footColor: 0x90a8d0, spot: 1.2, spotColor: 0xa8c8ff, beam: 0.07,
  },
  night: {
    amb: 0.3, ambColor: 0x4a5468, hemi: 0.2, hemiSky: 0x54628a, hemiGround: 0x1c1a24,
    key: 0.4, keyColor: 0x7a9fd8, rim: 0.42, rimColor: 0x8ab0e8,
    foot: 0.08, footColor: 0x7080a0, spot: 0.8, spotColor: 0x7a9fd8, beam: 0.05,
  },
  alert: {
    amb: 0.34, ambColor: 0x6a5050, hemi: 0.2, hemiSky: 0x8a6060, hemiGround: 0x241c1c,
    key: 0.5, keyColor: 0xff8a70, rim: 0.3, rimColor: 0xc86a5a,
    foot: 0.1, footColor: 0xd08060, spot: 1.1, spotColor: 0xff6a5a, beam: 0.08,
  },
  blackout: {
    amb: 0.1, ambColor: 0x30323c, hemi: 0.06, hemiSky: 0x38404e, hemiGround: 0x141218,
    key: 0.05, keyColor: 0x334455, rim: 0.12, rimColor: 0x445066,
    foot: 0.0, footColor: 0x000000, spot: 0.12, spotColor: 0x223344, beam: 0.0,
  },
  spotlight: {
    amb: 0.24, ambColor: 0x5a5462, hemi: 0.14, hemiSky: 0x6a6076, hemiGround: 0x201c26,
    key: 0.3, keyColor: 0xd8c8b0, rim: 0.26, rimColor: 0x7078a8,
    foot: 0.16, footColor: 0xffc890, spot: 2.6, spotColor: 0xffeecc, beam: 0.14,
  },
}

/* ============================================================
 * 镜头 DSL（参考卡门 shot）：pos/look/fov + 手持呼吸 drift。
 * push = 从 wide 缓慢推轨到 close。
 * ============================================================ */

interface CameraShot {
  pos: readonly [number, number, number]
  look: readonly [number, number, number]
  fov: number
  /** 电影黑边强度 0..1 */
  letterbox: number
}

export const CAMERA_SHOTS: Record<Exclude<StageCamera, 'push'>, CameraShot> = {
  wide: { pos: [0, 2.7, 9.8], look: [0, 1.05, 0], fov: 46, letterbox: 0 },
  medium: { pos: [0, 2.05, 6.5], look: [0, 1.15, 0], fov: 40, letterbox: 0.35 },
  close: { pos: [0, 1.72, 4.3], look: [0, 1.32, 0], fov: 34, letterbox: 0.65 },
}

/** push 推轨时长（秒）与终点（close 机位）。 */
export const PUSH_DURATION = 6.5
const PUSH_SHOT = CAMERA_SHOTS.close

/* ============================================================
 * 姿态演出：站位倾斜/蹲伏/头部动作 + 呼吸。
 * ============================================================ */

interface PoseStance {
  /** 身体前倾（弧度，正=前倾） */
  lean: number
  /** 身体转向（弧度，背向观众/侧台） */
  turn: number
  /** 蹲伏量（身高缩放） */
  crouch: number
  /** 头部下垂 */
  headDown: number
  /** 微颤幅度（tense 用） */
  tremble: number
}

export const POSE_STANCES: Record<StagePose, PoseStance> = {
  neutral: { lean: 0, turn: 0, crouch: 0, headDown: 0, tremble: 0 },
  open: { lean: -0.06, turn: 0, crouch: 0, headDown: -0.08, tremble: 0 },
  guarded: { lean: 0.04, turn: 0.5, crouch: 0.03, headDown: 0.06, tremble: 0 },
  tense: { lean: -0.05, turn: 0.12, crouch: 0.02, headDown: 0, tremble: 0.012 },
  afraid: { lean: 0.1, turn: 0.3, crouch: 0.12, headDown: 0.22, tremble: 0.02 },
  angry: { lean: 0.14, turn: 0, crouch: 0.02, headDown: 0.1, tremble: 0 },
  sad: { lean: 0.08, turn: 0.2, crouch: 0.06, headDown: 0.3, tremble: 0 },
  shadow: { lean: 0.05, turn: 0, crouch: 0, headDown: 0.14, tremble: 0 },
}

/* ============================================================
 * 空气粒子（程序化氛围）：按背景自动选择。
 * ============================================================ */

export type AtmosphereKind = 'dust' | 'snow' | 'embers' | 'mist' | 'sparks' | 'none'

export const ATMOSPHERE_BY_BACKDROP: Record<StageBackdrop, AtmosphereKind> = {
  neutral: 'dust',
  interior: 'dust',
  archive: 'dust',
  exterior: 'snow',
  shore: 'mist',
  industrial: 'embers',
  void: 'sparks',
}

interface AtmosphereSpec {
  color: number
  count: number
  size: number
  opacity: number
  /** 下落速度（负=上升） */
  fall: number
  /** 水平摇摆幅度 */
  sway: number
  area: { x: number; y: number; z: number }
}

const ATMOSPHERE_SPECS: Record<Exclude<AtmosphereKind, 'none'>, AtmosphereSpec> = {
  dust: { color: 0xcbb890, count: 70, size: 0.035, opacity: 0.4, fall: 0.05, sway: 0.16, area: { x: 9, y: 3.6, z: 4 } },
  snow: { color: 0xdfe8f0, count: 130, size: 0.05, opacity: 0.75, fall: 0.5, sway: 0.3, area: { x: 11, y: 4.4, z: 5 } },
  embers: { color: 0xff9a4a, count: 60, size: 0.045, opacity: 0.7, fall: -0.34, sway: 0.22, area: { x: 9, y: 3.8, z: 4 } },
  mist: { color: 0x9ab8c0, count: 46, size: 0.34, opacity: 0.1, fall: 0.02, sway: 0.5, area: { x: 11, y: 1.6, z: 4 } },
  sparks: { color: 0xa88ae8, count: 55, size: 0.04, opacity: 0.6, fall: -0.22, sway: 0.18, area: { x: 8, y: 4, z: 4 } },
}

/* ============================================================
 * 舞台调色（色值同源见 stage-palette.ts，P2-1）
 * ============================================================ */

const POSE_COLORS: Record<string, number> = {
  neutral: 0xd8c9b8,
  open: 0xf0e3d0,
  guarded: 0x9a8f80,
  tense: 0xcbbaa2,
  afraid: 0x8fa3b8,
  angry: 0xc96a5a,
  sad: 0x7f8a94,
  shadow: 0x15151a,
}

const POSITION_X: Record<string, number> = { left: -2.1, center: 0, right: 2.1 }
const SLIDE_OFFSET: Record<string, number> = { left: -1.4, center: 0, right: 1.4 }

/* ---------------- 小工具 ---------------- */

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3)
}

function easeInOut(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

let _gradTex: THREE.DataTexture | null = null
/** 三阶卡通渐变（卡门同款；RGBA 以兼容 three r152+） */
function gradTex(): THREE.DataTexture {
  if (_gradTex) return _gradTex
  const data = new Uint8Array([
    80, 80, 80, 255,
    168, 168, 168, 255,
    255, 255, 255, 255,
  ])
  _gradTex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat)
  _gradTex.minFilter = THREE.NearestFilter
  _gradTex.magFilter = THREE.NearestFilter
  _gradTex.needsUpdate = true
  return _gradTex
}

function toon(color: number, opts?: { transparent?: boolean; opacity?: number }): THREE.MeshToonMaterial {
  const material = new THREE.MeshToonMaterial({ color, gradientMap: gradTex() })
  if (opts?.transparent) {
    material.transparent = true
    material.opacity = opts.opacity ?? 1
  }
  return material
}

/**
 * 构建纯场景图（P2-4）：舞台盒 + 剧场灯光组 + 追光/光柱/光池 + 警报灯 +
 * 角色骨架 + 空气粒子。不创建 renderer、不触 WebGL，测试可无 GL 断言结构：
 * 灯位数、焦点追光目标、粒子规格、姿态 rotation/scale。 */
export function buildStageScene(cue: StageCue, actors: Stage3dActor[]): StageSceneGraph {
  const backdrop = cue.backdrop ?? 'neutral'
  const lighting = cue.lighting ?? 'natural'
  const mood = MOOD_PRESETS[lighting] ?? MOOD_PRESETS.natural
  const bgColor = STAGE_BACKDROP_COLORS[backdrop] ?? STAGE_BACKDROP_COLORS.neutral!

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(bgColor)
  scene.fog = new THREE.Fog(bgColor, 5, 14)

  /* 舞台盒（卡通材质） */
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 8),
    toon(STAGE_FLOOR_COLORS[backdrop] ?? 0x22222a),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.01
  scene.add(floor)

  const backWall = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 5),
    toon(bgColor),
  )
  backWall.position.set(0, 2.5, -3.2)
  scene.add(backWall)

  /* 台口踢脚线（舞台前缘，增强剧场感） */
  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(14, 0.08, 0.1),
    toon(0x0a0a10),
  )
  apron.position.set(0, 0.04, 3.6)
  scene.add(apron)

  /* ---------------- 灯光组 ---------------- */
  const ambient = new THREE.AmbientLight(mood.ambColor, mood.amb)
  scene.add(ambient)

  const hemi = new THREE.HemisphereLight(mood.hemiSky, mood.hemiGround, mood.hemi)
  scene.add(hemi)

  const key = new THREE.DirectionalLight(mood.keyColor, mood.key)
  key.position.set(2.2, 6, 5.5)
  scene.add(key)

  const rim = new THREE.DirectionalLight(mood.rimColor, mood.rim)
  rim.position.set(-4.5, 3.4, -3.5)
  scene.add(rim)

  const foot = new THREE.PointLight(mood.footColor, mood.foot, 8, 1.6)
  foot.position.set(0, 0.3, 3.4)
  scene.add(foot)

  /* 追光 + 可见光柱 + 台面光池 */
  const spotTarget = new THREE.Object3D()
  spotTarget.position.set(0, 1, 0)
  scene.add(spotTarget)
  const spot = new THREE.SpotLight(mood.spotColor, mood.spot, 14, 0.5, 0.6, 1.4)
  spot.position.set(0, 6.2, 2.2)
  spot.target = spotTarget
  scene.add(spot)

  const BEAM_LEN = 6.4
  const beamGeo = new THREE.CylinderGeometry(0.28, 1.7, BEAM_LEN, 16, 1, true)
  beamGeo.translate(0, -BEAM_LEN / 2, 0)
  const beamMat = new THREE.MeshBasicMaterial({
    color: mood.spotColor, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  })
  const beam = new THREE.Mesh(beamGeo, beamMat)
  scene.add(beam)

  const poolMat = new THREE.MeshBasicMaterial({
    color: mood.spotColor, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1.7, 28), poolMat)
  pool.rotation.x = -Math.PI / 2
  pool.position.y = 0.015
  scene.add(pool)

  /* 警报灯（红色脉冲点光） */
  const alertLight = new THREE.PointLight(0xff2a2a, 0, 7, 1.7)
  alertLight.position.set(0, 2.6, 0.8)
  scene.add(alertLight)

  /* ---------------- 角色 ---------------- */
  const actorRigs: ActorRig[] = []

  for (const actor of actors) {
    const pose = (actor.pose || 'neutral') as StagePose
    const stance = POSE_STANCES[pose] ?? POSE_STANCES.neutral!
    const bodyColor = POSE_COLORS[pose] ?? POSE_COLORS.neutral!
    const faded = actor.entrance === 'fade'

    const bodyMat = toon(actor.focus ? 0xf4e6cf : bodyColor, faded ? { transparent: true, opacity: 0 } : undefined)
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.05, 6, 12), bodyMat)
    body.position.y = 1.18

    const headMat = toon(actor.focus ? 0xf8e8d0 : 0xcbb9a4, faded ? { transparent: true, opacity: 0 } : undefined)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 14), headMat)
    head.position.y = 2.06

    const group = new THREE.Group()
    group.add(body)
    group.add(head)

    /* 接触阴影（伪投影，让人物落地） */
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: faded ? 0 : 0.34, depthWrite: false,
    })
    const contactShadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), shadowMat)
    contactShadow.rotation.x = -Math.PI / 2
    contactShadow.position.y = 0.012
    group.add(contactShadow)

    const baseX = POSITION_X[actor.position] ?? 0
    group.position.set(baseX, 0, 0)
    /* 姿态：转向中台（左位朝右、右位朝左），焦点角色更靠近观众 */
    const inward = actor.position === 'left' ? -0.14 : actor.position === 'right' ? 0.14 : 0
    group.rotation.y = inward + stance.turn * (actor.position === 'right' ? -1 : 1)
    group.rotation.x = stance.lean
    /* 初始 scale 直接体现焦点放大与姿态蹲伏（动画循环每帧保持同式） */
    const focusScale = actor.focus ? 1.07 : 1
    group.scale.set(focusScale, focusScale * (1 - stance.crouch), focusScale)
    scene.add(group)

    actorRigs.push({
      group, body, head, bodyMat, headMat, shadowMat,
      entrance: actor.entrance, baseX,
      slideOffset: SLIDE_OFFSET[actor.position] ?? 0,
      stance, focus: actor.focus,
      breathPhase: Math.random() * Math.PI * 2,
    })
  }

  /* 焦点角色 → 追光目标 */
  const focusRig = actorRigs.find((rig) => rig.focus) ?? actorRigs[0] ?? null
  if (focusRig) spotTarget.position.set(focusRig.baseX, 1.1, 0)

  /* ---------------- 空气粒子 ---------------- */
  const atmosphereKind = ATMOSPHERE_BY_BACKDROP[backdrop] ?? 'none'
  let particles: THREE.Points | null = null
  let particleSpeeds: Float32Array | null = null
  let particleSway: Float32Array | null = null
  if (atmosphereKind !== 'none') {
    const spec = ATMOSPHERE_SPECS[atmosphereKind]
    const positions = new Float32Array(spec.count * 3)
    particleSpeeds = new Float32Array(spec.count)
    particleSway = new Float32Array(spec.count)
    for (let i = 0; i < spec.count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * spec.area.x
      positions[i * 3 + 1] = Math.random() * spec.area.y + 0.15
      positions[i * 3 + 2] = (Math.random() - 0.5) * spec.area.z - 0.5
      particleSpeeds[i] = 0.6 + Math.random() * 0.8
      particleSway[i] = Math.random() * Math.PI * 2
    }
    const particleGeo = new THREE.BufferGeometry()
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const particleMat = new THREE.PointsMaterial({
      color: spec.color, size: spec.size, transparent: true, opacity: spec.opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    })
    particles = new THREE.Points(particleGeo, particleMat)
    scene.add(particles)
  }

  return {
    scene,
    backdrop,
    lighting,
    mood,
    spotTarget,
    spot,
    beam,
    beamMat,
    pool,
    poolMat,
    alertLight,
    actorRigs,
    focusRig,
    atmosphereKind,
    particles,
    particleSpeeds,
    particleSway,
  }
}

/** 创建卡门式低分辨率 3D 小舞台；WebGL 不可用时返回 null。 */
export function createStage3d(cue: StageCue, actors: Stage3dActor[]): Stage3dHandle | null {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'low-power' })
  } catch {
    return null
  }

  /* GL 画布不进入 DOM；返回给宿主的是 2D 合成画布 */
  const glCanvas = renderer.domElement
  renderer.setSize(VIEW_W, VIEW_H, false)

  const canvas = document.createElement('canvas')
  canvas.width = VIEW_W
  canvas.height = VIEW_H
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.imageRendering = 'pixelated'
  canvas.style.display = 'block'
  const outCtx = canvas.getContext('2d', { willReadFrequently: true })
  if (!outCtx) {
    renderer.dispose()
    return null
  }
  outCtx.imageSmoothingEnabled = false

  const buf = document.createElement('canvas')
  buf.width = VIEW_W
  buf.height = VIEW_H
  const bufCtx = buf.getContext('2d', { willReadFrequently: true })!
  bufCtx.imageSmoothingEnabled = false

  /* 暗角贴图（一次性预渲染） */
  const vign = document.createElement('canvas')
  vign.width = VIEW_W
  vign.height = VIEW_H
  const vCtx = vign.getContext('2d')!
  const vGrad = vCtx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.44, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.72)
  vGrad.addColorStop(0, 'rgba(0,0,0,0)')
  vGrad.addColorStop(1, 'rgba(3,5,16,0.34)')
  vCtx.fillStyle = vGrad
  vCtx.fillRect(0, 0, VIEW_W, VIEW_H)

  /* ---------------- 场景（纯场景图构建，可脱离 renderer 测试） ---------------- */
  const graph = buildStageScene(cue, actors)
  const scene = graph.scene
  const lighting = graph.lighting
  const mood = graph.mood
  const spotTarget = graph.spotTarget
  const spot = graph.spot
  const beam = graph.beam
  const beamMat = graph.beamMat
  const pool = graph.pool
  const poolMat = graph.poolMat
  const alertLight = graph.alertLight
  const actorRigs = graph.actorRigs
  const focusRig = graph.focusRig
  const particles = graph.particles
  const particleSpeeds = graph.particleSpeeds
  const particleSway = graph.particleSway
  const atmosphereKind = graph.atmosphereKind

  /* ---------------- 摄影机 ---------------- */
  const camera = new THREE.PerspectiveCamera(46, VIEW_W / VIEW_H, 0.1, 40)
  const cameraName: StageCamera = cue.camera ?? 'medium'
  const pushing = cameraName === 'push'
  const startShot = pushing ? CAMERA_SHOTS.wide : CAMERA_SHOTS[cameraName]
  const endShot = pushing ? PUSH_SHOT : startShot
  /* 近景时视线偏向焦点角色 */
  const lookBias = focusRig && cameraName !== 'wide' ? focusRig.baseX * 0.22 : 0
  const driftSeed = Math.random() * 100

  /* ---------------- 演出状态 ---------------- */
  const clock = new THREE.Clock()
  let disposed = false
  let raf = 0
  let fadeA = 1 /* 开场淡入 */
  let beamA = 0

  const animate = (): void => {
    if (disposed) return
    const dt = Math.min(clock.getDelta(), 0.05)
    const t = clock.getElapsedTime()

    /* 演员：入场（缓出）+ 呼吸 + 微颤 + 头部姿态 */
    for (const rig of actorRigs) {
      if (rig.entrance === 'fade') {
        const opacity = easeOutCubic(clamp01(t / 0.9))
        rig.bodyMat.opacity = opacity
        rig.headMat.opacity = opacity
        rig.shadowMat.opacity = opacity * 0.34
      } else if (rig.entrance === 'rise') {
        rig.group.position.y = -1.2 * (1 - easeOutCubic(clamp01(t / 1.0)))
      } else if (rig.entrance === 'slide') {
        const progress = easeOutCubic(clamp01(t / 1.1))
        rig.group.position.x = rig.baseX + rig.slideOffset * (1 - progress)
      }
      /* 呼吸：身体微幅起伏，错相 */
      const breath = Math.sin(t * 1.5 + rig.breathPhase)
      rig.body.scale.y = 1 + breath * 0.016
      rig.body.scale.x = 1 - breath * 0.008
      /* 蹲伏与头部 */
      const crouch = 1 - rig.stance.crouch
      rig.group.scale.y = (rig.focus ? 1.07 : 1) * crouch
      rig.head.position.y = 2.06 - rig.stance.headDown * 0.5
      rig.head.rotation.x = rig.stance.headDown
      /* 微颤 */
      if (rig.stance.tremble > 0) {
        rig.group.rotation.z = Math.sin(t * 21 + rig.breathPhase) * rig.stance.tremble
      }
    }

    /* 摄影机：推轨插值 + 手持呼吸 */
    const pushT = pushing ? easeInOut(clamp01(t / PUSH_DURATION)) : 1
    const px = startShot.pos[0] + (endShot.pos[0] - startShot.pos[0]) * pushT
    const py = startShot.pos[1] + (endShot.pos[1] - startShot.pos[1]) * pushT
    const pz = startShot.pos[2] + (endShot.pos[2] - startShot.pos[2]) * pushT
    const lx = startShot.look[0] + (endShot.look[0] - startShot.look[0]) * pushT + lookBias
    const ly = startShot.look[1] + (endShot.look[1] - startShot.look[1]) * pushT
    const lz = startShot.look[2] + (endShot.look[2] - startShot.look[2]) * pushT
    camera.fov = startShot.fov + (endShot.fov - startShot.fov) * pushT
    camera.updateProjectionMatrix()
    const driftX = Math.sin(t * 0.42 + driftSeed) * 0.045 + Math.sin(t * 0.9 + driftSeed * 2) * 0.018
    const driftY = Math.cos(t * 0.36 + driftSeed) * 0.028
    camera.position.set(px + driftX, py + driftY, pz)
    camera.lookAt(lx + driftX * 0.4, ly + driftY * 0.4, lz)

    /* 追光：跟随目标 + 可见光柱渐入 */
    beamA += (mood.beam - beamA) * Math.min(1, dt * 2.2)
    const beamVisible = beamA > 0.004
    beam.visible = beamVisible
    pool.visible = beamVisible
    if (beamVisible) {
      beamMat.opacity = beamA
      poolMat.opacity = beamA * 1.25
      const tp = spotTarget.position
      const ax = tp.x * 0.3
      const ay = 6.2
      const az = 2.2
      beam.position.set(ax, ay, az)
      const dir = new THREE.Vector3(tp.x - ax, 1.0 - ay, tp.z - az).normalize()
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir)
      pool.position.set(tp.x, 0.015, tp.z)
      spot.position.set(ax, ay, az)
    }

    /* 警报：红光脉冲 */
    if (lighting === 'alert') {
      alertLight.intensity = 0.7 + Math.sin(t * 9) * 0.5
      spotTarget.position.x += Math.sin(t * 2.2) * 0.002
    }

    /* 空气粒子：下落/上升 + 摇摆，越界回卷 */
    if (particles && particleSpeeds && particleSway) {
      const spec = ATMOSPHERE_SPECS[atmosphereKind as Exclude<AtmosphereKind, 'none'>]
      const attr = particles.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = attr.array as Float32Array
      for (let i = 0; i < spec.count; i++) {
        const speed = particleSpeeds[i]!
        arr[i * 3 + 1] = arr[i * 3 + 1]! - spec.fall * speed * dt * 3
        arr[i * 3] = arr[i * 3]! + Math.sin(t * 0.8 + particleSway[i]!) * spec.sway * dt
        if (spec.fall > 0 && arr[i * 3 + 1]! < 0.05) arr[i * 3 + 1] = spec.area.y
        else if (spec.fall < 0 && arr[i * 3 + 1]! > spec.area.y) arr[i * 3 + 1] = 0.1
      }
      attr.needsUpdate = true
    }

    renderer.render(scene, camera)

    /* ---------------- 2D 合成 ---------------- */
    bufCtx.clearRect(0, 0, VIEW_W, VIEW_H)
    bufCtx.drawImage(glCanvas, 0, 0, VIEW_W, VIEW_H)
    /* 15bit 量化 + Bayer 有序抖动 */
    const img = bufCtx.getImageData(0, 0, VIEW_W, VIEW_H)
    const d = img.data
    let p = 0
    for (let y = 0; y < VIEW_H; y++) {
      const dr = (y & 3) << 2
      for (let x = 0; x < VIEW_W; x++) {
        const o = BAYER[dr | (x & 3)]!
        const r = d[p]! + o
        const g = d[p + 1]! + o
        const b = d[p + 2]! + o
        d[p] = QUANT_LUT[r < 0 ? 0 : r > 255 ? 255 : r]!
        d[p + 1] = QUANT_LUT[g < 0 ? 0 : g > 255 ? 255 : g]!
        d[p + 2] = QUANT_LUT[b < 0 ? 0 : b > 255 ? 255 : b]!
        p += 4
      }
    }
    bufCtx.putImageData(img, 0, 0)

    outCtx.clearRect(0, 0, VIEW_W, VIEW_H)
    outCtx.drawImage(buf, 0, 0)
    outCtx.drawImage(vign, 0, 0)

    /* 镜头黑边（随推轨渐入） */
    const letterbox = startShot.letterbox + (endShot.letterbox - startShot.letterbox) * pushT
    if (letterbox > 0.01) {
      const lbH = VIEW_H * 0.11 * letterbox
      outCtx.fillStyle = '#000'
      outCtx.fillRect(0, 0, VIEW_W, lbH)
      outCtx.fillRect(0, VIEW_H - lbH, VIEW_W, lbH)
    }

    /* 警报：红色边缘呼吸光（幽灵诡计式画框） */
    if (lighting === 'alert') {
      outCtx.strokeStyle = 'rgba(255,60,50,' + (0.2 + Math.sin(t * 9) * 0.12).toFixed(3) + ')'
      outCtx.lineWidth = 3
      outCtx.strokeRect(1.5, 1.5, VIEW_W - 3, VIEW_H - 3)
    }

    /* 开场淡入 */
    if (fadeA > 0) {
      fadeA = Math.max(0, fadeA - dt * 1.5)
      outCtx.globalAlpha = fadeA
      outCtx.fillStyle = '#010105'
      outCtx.fillRect(0, 0, VIEW_W, VIEW_H)
      outCtx.globalAlpha = 1
    }

    raf = requestAnimationFrame(animate)
  }
  animate()

  return {
    canvas,
    dispose(): void {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(raf)
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          object.geometry?.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          for (const material of materials) material?.dispose()
        }
      })
      spot.dispose()
      renderer.dispose()
      // 主动释放 WebGL 上下文：长流程多次过场时避免 Chrome 活跃上下文上限（约 16 个）
      // 依赖 GC 回收不可靠；forceContextLoss 立即归还 GPU 资源。
      renderer.forceContextLoss()
    },
  }
}
