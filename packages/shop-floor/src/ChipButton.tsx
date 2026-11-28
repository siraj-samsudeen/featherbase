import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { chipClasses } from './Chip'
import { X } from './icons'
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
 * ChipButton; picked, it is the blue chip with an × (the look kit's chosen chip), and pressing it again
 * unpicks it. The state is aria-pressed, so the look is never the only signal.
 */
export function ChoiceChip({ picked, onToggle, className, children }: { picked: boolean; onToggle: () => void; className?: string; children: ReactNode }) {
  if (!picked) return <ChipButton aria-pressed={false} onClick={onToggle} className={className}>{children}</ChipButton>
  return (
    <button type="button" aria-pressed onClick={onToggle} className={chipClasses({ hue: 'blue', className: cx('cursor-pointer focus-visible:outline-2 focus-visible:outline-focus', className) })}>
      {children}
      <X aria-hidden size={14} />
    </button>
  )
}
