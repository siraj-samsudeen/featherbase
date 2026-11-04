/** Join class names, skipping falsy parts. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

const COLOUR = String.raw`(?:canvas|surface|subtle|border|border-control|ink|ink-muted|ink-subtle|action|action-hover|action-ink|action-tint|focus|negative|negative-tint|caution|caution-tint|positive|positive-tint|opportunity|opportunity-tint|missing|missing-tint|scrim|on-scrim|series-[1-5]|transparent|current|inherit)(?:\/\d+)?`

// The utility groups a call site legitimately overrides on a recipe. Two
// classes from one group (px-2 and px-4, text-ink and text-ink-muted) would
// otherwise both apply and the winner would be whichever Tailwind emits later.
// gap-x/gap-y are deliberately NOT in the gap group: Tailwind emits `gap`
// before its axis forms, so a call site's gap-x-4 refines a recipe's gap-2.
const GROUPS: [RegExp, string][] = [
  [/^px-/, 'px'],
  [/^pl-/, 'pl'],
  [/^pr-/, 'pr'],
  [/^py-/, 'py'],
  [/^p-/, 'p'],
  [/^text-(xs|sm|base|lg|xl|[2-9]xl|control)$/, 'text-size'],
  [new RegExp(`^text-${COLOUR}$`), 'text-colour'],
  [new RegExp(`^bg-${COLOUR}$`), 'bg-colour'],
  [new RegExp(`^border-${COLOUR}$`), 'border-colour'],
  [/^rounded(-(none|sm|md|lg|xl|2xl|3xl|full|card|control))?$/, 'rounded'],
  [/^font-(thin|light|normal|medium|semibold|bold|extrabold|black)$/, 'font-weight'],
  [/^w-/, 'w'],
  [/^min-h-/, 'min-h'],
  [/^size-/, 'size'],
  [/^gap-(?![xy]-)/, 'gap'],
  [/^justify-/, 'justify'],
  [/^(block|inline|inline-block|inline-flex|flex|grid|hidden)$/, 'display'],
]

// Density defaults that must hold on touch screens: 16px text (below it iPhones
// zoom on tap) and the 48px control height. A call site's override of one of
// these applies under a mouse only.
const TOUCH_KEPT = new Set(['text-control', 'min-h-control', 'size-control'])

function group(cls: string): string | null {
  if (cls.includes(':')) return null // variants (hover:, sm:) never merge
  const bare = cls.startsWith('!') ? cls.slice(1) : cls
  for (const [re, name] of GROUPS) if (re.test(bare)) return name
  return null
}

/**
 * A recipe's default classes merged with the call site's:
 * - a call site class replaces the default from the same group (`p-*` also
 *   replaces `px-*`/`py-*`; side radii such as rounded-r-none keep the radius);
 * - except for the touch density defaults, which stay, with the call site's
 *   class applied as `pointer-fine:` so it only takes effect under a mouse.
 * Call-site classes come after the defaults; variants never merge.
 */
export function recipe(defaults: string, className?: string): string {
  const base = defaults.split(/\s+/).filter(Boolean)
  const extra = (className ?? '').split(/\s+/).filter(Boolean)
  const kept = new Set(base.filter((c) => TOUCH_KEPT.has(c)).map(group))
  const taken = new Set(extra.map(group).filter((g): g is string => g != null))
  if (taken.has('p')) taken.add('px').add('py')
  const merged = base.filter((c) => TOUCH_KEPT.has(c) || !taken.has(group(c) ?? ''))
  const call = extra.map((c) => (kept.has(group(c)) && !c.startsWith('!') ? `pointer-fine:${c}` : c))
  return [...merged, ...call].join(' ')
}
