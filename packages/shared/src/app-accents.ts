// #941 (ADR 0019): the accents an app may name in its manifest. Each one is a
// light and a dark block of Shop Floor's action tokens, checked by the
// contrast guard. `blue` is the default, Shop Floor's own action colours.
export const APP_ACCENTS = ['blue', 'green'] as const
export type AppAccent = (typeof APP_ACCENTS)[number]
export const DEFAULT_APP_ACCENT: AppAccent = 'blue'
