## 1. Whole numbers (#541)

- [x] 1.1 Pin it first: a saved whole number reads back as a number from the row, the list and a connected Postgres table.
- [x] 1.2 Read whole numbers as numbers at the database client, keeping any value past the safe range as text.

## 2. JSON typed into a form (#545)

- [x] 2.1 Flip the pinned form test to a plain test; add a refusal test and an untouched-value test.
- [x] 2.2 On save, parse text typed into a JSON box; refuse text that isn't JSON at the field.

## 3. Close

- [x] 3.1 Verify against the code and tests, then archive this change in the same PR.
