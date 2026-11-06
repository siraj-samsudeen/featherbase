// #742: one reading of a Yes/No value, shared by the server's filters and the
// web's quick filter box, so both read a hand-edited link the same way.
// 1 and 0 are yes and no too: a Check default is "1", and apps filter with 1.
const WORDS = new Map([
  ['true', true],
  ['yes', true],
  ['1', true],
  ['false', false],
  ['no', false],
  ['0', false],
])

/** The yes or no a value means. Empty stays empty; undefined means a value that
 *  is neither yes nor no, which finds no rows, as an unknown choice does. */
export function readYesNo(value: unknown): boolean | null | undefined {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return WORDS.get(String(value))
  return typeof value === 'string' ? WORDS.get(value.toLowerCase()) : undefined
}
