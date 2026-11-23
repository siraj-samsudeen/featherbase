/** One answer to one question, as the server sends it and the page draws it.
 *  'cannot' is for the model (Phase 2) to say it can't answer; the placeholder always answers. */
export type Reply = { kind: 'answer' | 'cannot'; text: string }

export const MAX_QUESTION_LENGTH = 2000