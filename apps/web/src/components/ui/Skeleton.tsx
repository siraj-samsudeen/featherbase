import { cx } from './cx'

const WIDTHS = ['w-full', 'w-5/6', 'w-2/3', 'w-3/4']

/** A first-load placeholder that tells assistive tech what is loading. */
export function Skeleton({ label, lines = 3, className }: { label: string; lines?: number; className?: string }) {
  return (
    <div role="status" className={cx('flex flex-col gap-2.5', className)}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex flex-col gap-2.5">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className={cx('h-4 rounded-control bg-border animate-pulse motion-reduce:animate-none', WIDTHS[i % WIDTHS.length])} />
        ))}
      </div>
    </div>
  )
}
