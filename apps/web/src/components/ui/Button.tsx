import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx, recipe } from './cx'
import { LoaderCircle } from './icons'

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-action text-action-ink hover:bg-action-hover',
  secondary: 'border-border-control bg-surface text-ink hover:bg-subtle',
  quiet: 'border-transparent bg-transparent text-action hover:bg-action-tint',
  danger: 'border-negative bg-surface text-negative hover:bg-negative-tint',
}

/**
 * The button look as a class string, for anything that must stay its own
 * element — a router Link, an anchor to an OAuth route — but read as a button.
 */
export function buttonClasses({
  variant = 'secondary',
  block = false,
  className,
}: { variant?: ButtonVariant; block?: boolean; className?: string } = {}): string {
  return recipe(
    cx(
      'inline-flex min-h-control select-none items-center justify-center gap-2 rounded-control border px-control-x',
      'text-control font-semibold transition-colors',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
      'disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none',
      VARIANT[variant],
      block && 'w-full',
    ),
    className,
  )
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  block?: boolean
  /** Shows a spinner, keeps the label, and refuses clicks until it settles. */
  loading?: boolean
  icon?: ReactNode
}

export function Button({ variant, block, loading = false, icon, className, disabled, type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, block, className })}
      {...rest}
    >
      {loading ? <LoaderCircle aria-hidden size={18} className="animate-spin motion-reduce:animate-none" /> : icon}
      {children}
    </button>
  )
}

/**
 * A button that is only an icon or a glyph (×, ←, ↗): a square of the control
 * size, so it is as easy to hit as any other control. Give it an aria-label.
 */
export function iconButtonClasses(className?: string): string {
  return recipe(
    'inline-flex size-control shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-focus motion-reduce:transition-none',
    className,
  )
}

/**
 * For a small glyph that must stay inside a chip (a tag's ×): an invisible
 * hit area around it, so a thumb can hit it without the chip growing.
 */
export function touchTargetClasses(className?: string): string {
  return recipe("relative before:absolute before:-inset-3 before:content-['']", className)
}
