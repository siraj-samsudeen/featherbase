import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { chipClasses } from './Chip'
import { cx } from './cx'

/**
 * A chip that is pressed (Forecasting #1419): a quick choice that fills something in ("= Last year", "+10%").
 * The grey Chip's look, as a button, with the hover tint. For a choice that stays picked, use ChoiceChip.
 */
export function ChipButton({ className, children, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button type={type} className={chipClasses({ hue: 'grey', className: cx('cursor-pointer hover:bg-fill-hover focus-visible:outline-2 focus-visible:outline-focus', className) })} {...rest}>
      {children}
    </button>
  )
}

/**
 * One choice of several that can be picked together (a reason, "What happened here?"). Not picked, it is a grey
 * ChipButton; picked, it reads as an active FilterChip (the action tint with a round ✕), and pressing it again
 * unpicks it. The state is aria-pressed, so the look is never the only signal.
 */
export function ChoiceChip({ picked, onToggle, className, children }: { picked: boolean; onToggle: () => void; className?: string; children: ReactNode }) {
  if (!picked) return <ChipButton aria-pressed={false} onClick={onToggle} className={className}>{children}</ChipButton>
  return (
    <button type="button" aria-pressed onClick={onToggle}
      className={cx('inline-flex min-h-[30px] cursor-pointer items-center gap-1.5 rounded-full bg-action-tint pr-1 pl-3 text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-focus', className)}>
      {children}
      <i aria-hidden className="grid size-[22px] place-items-center rounded-full text-xs not-italic text-action">✕</i>
    </button>
  )
}
