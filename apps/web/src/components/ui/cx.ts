/** Join class names, skipping falsy parts. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

// The few utility groups a call site legitimately overrides on a recipe.
// Two classes from one group (px-2 and px-4) would otherwise both apply and
// the winner would be whichever Tailwind happens to emit later.
const GROUPS: [RegExp, string][] = [
  [/^px-/, 'px'],
  [/^py-/, 'py'],
  [/^p-/, 'p'],
  [/^text-(xs|sm|base|lg|xl|[2-9]xl|control)$/, 'text-size'],
  [/^rounded(-(none|sm|md|lg|xl|2xl|3xl|full|card|control))?$/, 'rounded'],
  [/^font-(thin|light|normal|medium|semibold|bold|extrabold|black)$/, 'font-weight'],
  [/^w-/, 'w'],
  [/^min-h-/, 'min-h'],
  [/^gap-/, 'gap'],
  [/^justify-/, 'justify'],
  [/^(block|inline|inline-block|inline-flex|flex|grid|hidden)$/, 'display'],
]

function group(cls: string): string | null {
  if (cls.includes(':')) return null // variants (hover:, sm:) never merge
  const bare = cls.startsWith('!') ? cls.slice(1) : cls
  for (const [re, name] of GROUPS) if (re.test(bare)) return name
  return null
}

/**
 * A recipe's default classes, minus any whose group the call site sets, then
 * the call site's classes. `p-*` from the call site also replaces `px-*` and
 * `py-*`. Side-specific radii (rounded-r-none) keep the recipe's radius.
 */
export function recipe(defaults: string, className?: string): string {
  const extra = (className ?? '').split(/\s+/).filter(Boolean)
  const taken = new Set(extra.map(group).filter((g): g is string => g != null))
  if (taken.has('p')) taken.add('px').add('py')
  const kept = defaults.split(/\s+/).filter((c) => c && !taken.has(group(c) ?? ''))
  return [...kept, ...extra].join(' ')
}
