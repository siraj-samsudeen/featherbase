# Collaboration Protocol

This repository uses a coordinator-and-workers workflow whenever the owner is
working with an agent.

## Main thread

- Keep the owner's main thread active, unarchived, and focused on management,
  discussion, design input, decisions, and integration.
- Do not use the main thread as the implementation workspace. Create one or
  more implementation threads, choosing the number of threads and their agent
  modes to match the work's complexity and independent workstreams.
- Give each implementation thread a directly owned task and ask it to report
  its result back to the main thread. The main thread remains responsible for
  decisions, integration, verification, and communication with the owner.
- “Active” does not require polling. Continue useful management or discussion
  work while workers run, and have workers report back when finished.

## Review gates

- Invoke an independent code review for every completed code change before it
  is accepted or merged. Use the repository's configured code-review skill
  when available. A worker's self-review is not the independent review.
- Re-run the relevant verification in the main thread after delegated work;
  worker reports are claims, not acceptance evidence.
- For complex work—architectural, cross-cutting, high-risk, or materially
  ambiguous—consult Oracle before implementation for design review and again
  after implementation for final review. Resolve substantive findings before
  merge.

Implementation threads must do their assigned work themselves and must not
create further threads unless the owner explicitly requests nested delegation.
