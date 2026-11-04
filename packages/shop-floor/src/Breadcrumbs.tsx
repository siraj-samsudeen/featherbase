import { ChevronRight } from './icons'
import { touchLinkClasses } from './Button'

/** Pass context-preserving URLs; the final item without href is the current location. */
export function Breadcrumbs({ items, label = 'Breadcrumb' }: {
  items: { label: string; href?: string }[]
  label?: string
}) {
  return (
    <nav aria-label={label}>
      <ol className="flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
        {items.map((item, index) => (
          <li key={`${index}-${item.label}`} className="flex min-w-0 items-center gap-2">
            {index > 0 && <ChevronRight aria-hidden size={14} className="shrink-0" />}
            {item.href ? <a href={item.href} className={touchLinkClasses('text-action hover:underline wrap-anywhere')}>{item.label}</a>
              : <span aria-current="page" className="font-medium text-ink wrap-anywhere">{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  )
}
