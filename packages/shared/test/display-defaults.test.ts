// One home for the display defaults a clean install shows (#380): the web's
// loading fallback and /api/settings must never disagree.
import { expect, test } from 'vitest'
import { DISPLAY_DEFAULTS } from '../src'

test('a clean install shows rupees and DD-Mon-YYYY', () => {
  expect(DISPLAY_DEFAULTS).toEqual({ app_name: 'Featherbase', date_format: 'dd-mon-yyyy', currency: 'INR', currency_precision: 2, float_precision: 2 })
})
