// Feather Forecast against the annual plan, as the managers' pages colour it: Featherbase's achievement bands
// (achievementTone: 100% and over on plan, 90–99% close, under 90% behind), words and sign first, the colour repeats them.
import { achievementTone } from '@featherbase/shop-floor'
import { gapToAop, pc } from './model'

const TEXT = { positive: 'text-positive', caution: 'text-caution', negative: 'text-negative', missing: 'text-ink-muted', neutral: 'text-ink' } as const
export type AopTone = keyof typeof TEXT
export const aopTone = (o: { fc: number; aop: number }): AopTone => (o.aop ? achievementTone(o.fc / o.aop * 100) : 'missing')
export const aopText = (o: { fc: number; aop: number }) => TEXT[aopTone(o)]

/** Feather Forecast against AOP in %, coloured by its band. */
export const VsAop = ({ o }: { o: { fc: number; aop: number } }) => <span className={aopText(o)}>{pc(o.fc, o.aop)}</span>
/** The rupee gap to AOP, coloured by its band. */
export const GapToAop = ({ o }: { o: { fc: number; aop: number } }) => <span className={aopText(o)}>{gapToAop(o)}</span>
