/** One answer to one question, as the server sends it and the page draws it.
 *  'cannot' is for the model to say it can't answer. */
export type Reply = { kind: 'answer' | 'cannot'; text: string }

export const MAX_QUESTION_LENGTH = 2000

/** The longest answer Ask saves. */
export const MAX_ANSWER_LENGTH = 20000