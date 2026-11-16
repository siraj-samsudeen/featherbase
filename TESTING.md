# How Featherbase is tested

Read this before writing any test.

## Three things every test honours

1. **Behaviour is agreed in plain words, with concrete examples, before any code is written.**
2. **Those examples are what the tests run.**
3. **A test checks behaviour from outside.** It never checks how the code is arranged inside.

## Two kinds of test, and no others

**Journeys.** What the owner would show in a demo, as numbered steps in his words. A journey runs in a real
browser, with a real file, on a fresh install: an empty database, migrated, then started. Every run records a
video. There are few journeys, and only the owner adds one.

**Behaviours.** One rule each, written as one sentence in everyday words in its folder's `.md` file. Where a rule
has cases, that file holds them in a table.

## Rules

- **One test per sentence.** The test's name is the sentence, word for word. No sentence goes without a test,
  and no test exists without a sentence.
- **The tables are the test data.** A test reads its cases from the table in its folder's `.md` file. It does
  not keep its own copy.
- **Tests stay outside.** A test reaches the app only as a person or an agent would: through a page, the API
  or MCP. It does not import the product's code, and it does not read or write the database directly. To set
  something up, it does what a person would do, such as uploading a file.
- **An expectation changes only when the owner changes the sentence or the table.** A failing test is never
  made to pass by changing what it expects.
- **Coverage is 100% of lines and functions,** measured by Bun's own coverage. When it is not met the run
  fails and names the file and the lines. The answer is one of two: the owner approves a new sentence for
  what that code does, or the code is deleted.
- **Done means the journeys pass on a fresh install, with their recordings.** It does not mean an agent says
  so. The owner reviews the sentences and the tests.

## What is deliberately not here

Given/When/Then wording, step definitions, OpenSpec, mutation testing, time budgets and coverage exemptions.
The owner tried the first three and found them slow or verbose; the others add rules that do not hold over
time.
