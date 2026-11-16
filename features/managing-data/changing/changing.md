# Changing

The scene: a person is looking at a Table and adds, changes or deletes a row.

## Sentences

One sentence per rule, in everyday words. Each sentence has exactly one test, named with the sentence word
for word. Where a sentence has a table, the test runs the table's rows as written here. See `TESTING.md`.

1. A person can change a row's values and save them.
2. A value that isn't in a Choice's list is refused.
3. The form stops a value that doesn't fit its Column's type before it is sent, and says which Column.
    An agent using the API has no form, so there the same value is refused, with the Column named.
4. The key can't be blank, or the same as another row's.
5. A person can add a row. It says it was added by hand.
6. A person can delete a row, after confirming.

## Decided

Delete really removes the row in this build. A raw row's "written to" link is left as it is when its row is
deleted.
