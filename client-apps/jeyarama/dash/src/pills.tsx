// #1225: pills Dash draws itself.
import { pillClasses } from '@featherbase/shop-floor'

/**
 * "Same for everyone" is neutral grey. Shop Floor's `neutral` tone is the action tint (blue), which
 * reads as a link here; flagged to the UI standard's owner.
 */
export function SameForEveryone() {
  return <span className={pillClasses('bg-subtle text-ink-muted')}>Same for everyone</span>
}
