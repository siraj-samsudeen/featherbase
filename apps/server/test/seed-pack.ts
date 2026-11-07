import { join } from 'node:path'

/** A made-up seed pack shaped like a client HR roster pack (#731): the
 *  platform's tests use it, never a client's own. */
export const TEST_SEED_PACK = join(import.meta.dirname, 'seed-packs', 'test-hr.json')
