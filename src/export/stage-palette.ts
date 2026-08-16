/**
 * 舞台调色板（P2-1）：3D 合成舞台（stage3d）与 CSS 回退舞台（template.css
 * 经 CSS 变量注入）共享的单一色源。改一个色值两处视觉同步，避免重复维护。
 */

/** 3D 舞台背景色（数字形式，供 three.Color 直接使用） */
export const STAGE_BACKDROP_COLORS: Record<string, number> = {
  neutral: 0x17171f,
  interior: 0x241a14,
  exterior: 0x0c1420,
  shore: 0x0b1a1e,
  industrial: 0x1b1f22,
  archive: 0x1c160d,
  void: 0x050308,
}

/** 3D 舞台地面色（数字形式） */
export const STAGE_FLOOR_COLORS: Record<string, number> = {
  neutral: 0x23232d,
  interior: 0x33261c,
  exterior: 0x121c2a,
  shore: 0x13292b,
  industrial: 0x2a2e31,
  archive: 0x2b2114,
  void: 0x0b060e,
}

/** CSS 变量注入文本：--stage-bg-<backdrop>: #rrggbb（供 template 写入 :root）。 */
export function stageBackdropCssVars(): string {
  return Object.entries(STAGE_BACKDROP_COLORS)
    .map(([name, value]) =>
      `--stage-bg-${name}: #${value.toString(16).padStart(6, '0')};`)
    .join('\n  ')
}