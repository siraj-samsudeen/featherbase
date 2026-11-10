import { cardClasses } from '@featherbase/shop-floor'

export function Empty({ text }: { text: string }) {
  return <div className={cardClasses("border-dashed px-4 py-10 text-center text-sm text-[var(--color-ink-muted)]")}>{text}</div>
}
