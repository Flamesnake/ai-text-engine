/**
 * lite 运行时桩（P1-7）：无舞台 cue 的作品导出时，用本桩替换 stage3d.js，
 * 让 esbuild 完全不引入 three.js（~600KB）。
 *
 * createStage3d 恒返回 null → 运行时自然走 CSS 回退舞台。
 */
export interface Stage3dHandle {
  canvas: HTMLCanvasElement
  dispose(): void
}

export function createStage3d(): Stage3dHandle | null {
  return null
}