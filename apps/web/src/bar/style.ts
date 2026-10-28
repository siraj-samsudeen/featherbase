// #650: the platform's stylesheet, made to work inside the bar's shadow root
// over an app's page, where it must neither reach the app nor be reached by
// the app's own styles.
//
// - The Shop Floor tokens sit on `:root`, which a shadow tree never matches:
//   they move to `:host`.
// - Tailwind registers its `--tw-*` variables with `@property`, which a shadow
//   root ignores (a browser registers properties for the document only). The
//   variables' starting values are declared on every element of the bar
//   instead, in the lowest layer, exactly as Tailwind's own fallback does for
//   browsers without `@property`. Nothing is added to the app's document.
// - The host sits at the top of the page, above the app's content, and starts
//   from the browser's defaults rather than inheriting the app's text styles.

const LAYERS = '@layer properties, featherbase-host;'
const HOST = '@layer featherbase-host{:host{all:initial;display:block;position:sticky;top:0;z-index:2147483647}}'

export function shadowCss(css: string): string {
  const starts = [...css.matchAll(/@property\s+(--[\w-]+)\s*\{([^}]*)\}/g)].map(([, name, body]) => {
    const initial = /initial-value\s*:\s*([^;]+)/.exec(body)?.[1].trim()
    return `${name}:${initial ?? 'initial'}`
  })
  const fallback = starts.length ? `@layer properties{*,::before,::after,::backdrop{${starts.join(';')}}}` : ''
  return `${LAYERS}${HOST}${css.replace(/:root\b/g, ':host')}${fallback}`
}
