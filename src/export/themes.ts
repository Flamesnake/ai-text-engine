import type { ThemeConfig } from '../core/types.js'

export const THEMES: Record<string, ThemeConfig> = {
  dark: {
    background:
      'radial-gradient(1100px 560px at 50% -12%, #151b28 0%, transparent 62%), linear-gradient(180deg, #0a0d12 0%, #06080c 100%)',
    card: 'rgba(16, 20, 28, 0.9)',
    border: '#232a37', borderGlow: '#4a5a7a', text: '#d8dce4', textDim: '#8a93a6',
    accent: '#8fb8ff', danger: '#c94f4f', gold: '#d8b26a', green: '#7fb58a', purple: '#a88fd8',
  },
  cyber: {
    background:
      'radial-gradient(900px 520px at 82% -12%, #1b1030 0%, transparent 62%), linear-gradient(180deg, #0d0a1a 0%, #060410 100%)',
    card: 'rgba(22, 15, 44, 0.92)',
    border: '#3b2d63', borderGlow: '#7b5cff', text: '#e6e0fa', textDim: '#9a8fc0',
    accent: '#00e5ff', danger: '#ff3d81', gold: '#ffd166', green: '#00ffa3', purple: '#a78bfa',
  },
  cozy: {
    background:
      'radial-gradient(900px 520px at 50% -12%, #f7e8d0 0%, transparent 65%), linear-gradient(180deg, #fdf6ec 0%, #f3e7d2 100%)',
    card: 'rgba(255, 252, 246, 0.94)',
    border: '#e2d3ba', borderGlow: '#c9a86a', text: '#3d3428', textDim: '#8a7a63',
    accent: '#d97e4a', danger: '#c0392b', gold: '#b8860b', green: '#5f8f4e', purple: '#8e6f9e',
  },
  paper: {
    background: 'linear-gradient(180deg, #f4ecd8 0%, #e7dcc0 100%)',
    card: 'rgba(250, 244, 226, 0.95)',
    border: '#cbb894', borderGlow: '#a08050', text: '#2f2a20', textDim: '#7a6f58',
    accent: '#8a5a2b', danger: '#a03020', gold: '#9c7a1e', green: '#55763c', purple: '#6f5a7a',
  },
}

const LIGHT_THEMES = new Set(['cozy', 'paper'])

export function resolveTheme(theme: string | ThemeConfig | undefined): {
  colors: ThemeConfig
  scheme: 'dark' | 'light'
  name: string
} {
  if (typeof theme === 'string') {
    const colors = THEMES[theme]
    if (colors) return { colors, scheme: LIGHT_THEMES.has(theme) ? 'light' : 'dark', name: theme }
    console.warn(`[TaleSpindle] 未知主题 "${theme}"，回退 dark`)
    return { colors: THEMES.dark, scheme: 'dark', name: 'dark' }
  }
  if (theme && typeof theme === 'object') {
    return { colors: { ...THEMES.dark, ...theme }, scheme: 'dark', name: 'custom' }
  }
  return { colors: THEMES.dark, scheme: 'dark', name: 'dark' }
}
