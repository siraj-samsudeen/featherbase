import { cx } from './cx'

/**
 * A small set of mutually exclusive choices (Table / Compact, Auto / Right /
 * Bottom). Each choice is a button whose chosen state is aria-pressed, so the
 * look is never the only signal.
 */
export function Segmented<T extends string>({ label, options, value, onChange, className }: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={cx('inline-flex w-fit shrink-0 gap-0.5 rounded-control bg-fill p-[3px]', className)}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className="min-h-8 rounded-[7px] px-3 text-[13px] text-ink-subtle transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-focus aria-pressed:bg-surface aria-pressed:font-medium aria-pressed:text-ink aria-pressed:shadow-pressed pointer-coarse:min-h-control motion-reduce:transition-none"
        >{option.label}</button>
      ))}
    </div>
  )
}
