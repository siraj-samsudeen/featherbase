import {
  cloneElement,
  isValidElement,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { cx } from './cx'
import { Eye, EyeOff, Search } from './icons'

/** The look of anything the user types into or picks from. */
export function inputClasses(className?: string): string {
  return cx(
    'block w-full min-h-control rounded-control border border-border-control bg-surface px-3 text-control text-ink',
    'placeholder:text-ink-subtle focus:outline-hidden focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/30',
    'disabled:cursor-not-allowed disabled:bg-subtle disabled:text-ink-muted aria-invalid:border-negative',
    className,
  )
}

export const labelClasses = 'mb-1.5 block text-sm font-semibold text-ink'

interface Described {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
}

/**
 * A labelled control with an optional hint and error. The label names the
 * control; the hint and the error describe it, so a screen reader reads them
 * with it.
 */
export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  className?: string
  children: ReactElement<Described>
}) {
  const auto = useId()
  const id = (isValidElement(children) && children.props.id) || auto
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [children.props['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={className}>
      <label htmlFor={id} className={labelClasses}>
        {label}
      </label>
      {cloneElement(children, {
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : children.props['aria-invalid'],
      })}
      {hint && (
        <p id={hintId} className="mt-1.5 text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1.5 text-sm font-medium text-negative">
          {error}
        </p>
      )}
    </div>
  )
}

export function TextInput({ className, type = 'text', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type={type} className={inputClasses(className)} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={inputClasses(cx('pr-8', className))} {...rest}>
      {children}
    </select>
  )
}

export function SearchInput({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <div className="relative">
      <Search aria-hidden size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
      <input type="search" className={inputClasses(cx('pl-10', className))} {...rest} />
    </div>
  )
}

/** A password box with a show/hide control that says which state it is in. */
export function PasswordInput({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <input type={shown ? 'text' : 'password'} className={inputClasses(cx('pr-12', className))} {...rest} />
      <button
        type="button"
        aria-label="Show password"
        aria-pressed={shown}
        onClick={() => setShown((s) => !s)}
        className="absolute inset-y-0 right-0 inline-flex w-12 items-center justify-center rounded-r-control text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
      >
        {shown ? <EyeOff aria-hidden size={18} /> : <Eye aria-hidden size={18} />}
      </button>
    </div>
  )
}
