import type { Reply } from '../shared/reply'

/** The answer to one question. Phase 2 replaces this with the AI pipeline.
 * this is the placeholder answer for Phase 1, so the app can be built and run without the AI pipeline.
 */
export function reply(_question: string): Reply {
  return {
    kind: 'answer',
    text: "Ask can't look at your data yet. This is a placeholder answer from the Ask server; real answers come in a later step.",
  }
}