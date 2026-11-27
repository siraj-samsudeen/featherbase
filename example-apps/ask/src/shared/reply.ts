/** One answer to one question, as the server sends it and the page draws it.
 *  'cannot' is for the model to say it can't answer. */
export type Reply = { kind: 'answer' | 'cannot'; text: string }

/** One step behind an answer, saved with it: the tool, what it was asked, and its result in
 *  short ("2 rows", "refused: …"). No rows are kept. */
export type Step = { tool: string; args: Record<string, unknown>; summary: string; refused?: true }

/** What think gives: the answer and the steps behind it. */
export type Thought = { answer: Reply; steps: Step[] }

export const MAX_QUESTION_LENGTH = 2000

/** The longest answer Ask saves. */
export const MAX_ANSWER_LENGTH = 20000

/** The steps behind one answer, as JSON, are at most this long. */
export const MAX_STEPS_LENGTH = 20000