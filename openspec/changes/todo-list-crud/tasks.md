## 1. A new to-do is listed, not done (@spec created-to-dos-are-listed)

- [ ] 1.1 outer: creating "Buy milk" on an empty list lists "Buy milk", not done
- [ ] 1.2 inner: todos.create stores a title and returns { id, title, done: false }
- [ ] 1.3 inner: todos.list returns the stored to-dos, with done as a boolean
- [ ] 1.4 inner: POST /todos returns 201 with the new to-do
- [ ] 1.5 inner: GET /todos returns 200 with the list
- [ ] 1.6 inner: src/index.ts serves the API over real HTTP on DB_PATH and PORT

## 2. To-dos are listed in the order they were created (@spec created-to-dos-are-listed)

- [ ] 2.1 outer: "Buy milk" then "Pay rent" are listed in that order

## 3. Marking a to-do done (@spec a-to-do-can-be-marked-done-or-not-done)

- [ ] 3.1 outer: marking "Buy milk" done lists it as done
- [ ] 3.2 inner: todos.update sets done
- [ ] 3.3 inner: PATCH /todos/:id with { done } returns 200 with the updated to-do

## 4. Marking a done to-do not done again (@spec a-to-do-can-be-marked-done-or-not-done)

- [ ] 4.1 outer: marking a done "Buy milk" not done lists it as not done

## 5. Renaming a to-do (@spec a-to-do-can-be-renamed)

- [ ] 5.1 outer: renaming "Buy milk" to "Buy oat milk" keeps it first, before "Pay rent"
- [ ] 5.2 inner: todos.update sets title
- [ ] 5.3 inner: PATCH /todos/:id with { title } returns 200 with the updated to-do

## 6. Deleting a to-do (@spec a-to-do-can-be-deleted)

- [ ] 6.1 outer: deleting "Buy milk" leaves only "Pay rent"
- [ ] 6.2 inner: todos.remove deletes the to-do
- [ ] 6.3 inner: DELETE /todos/:id returns 204 with no body

## 7. Changes made before a restart are listed after it (@spec the-list-survives-a-restart)

- [ ] 7.1 outer: after create, mark, rename and delete, a new app on the same file lists "Buy milk" done, then "Pay rent and gas" not done
- [ ] 7.2 inner: createApp on an existing file keeps its table and rows

## 8. Reconcile

- [ ] 8.1 Coverage 100% of lines and functions, nothing excluded, every src/ file reported; every uncovered line ratified, deleted or asked
- [ ] 8.2 No unused files, exports or dependencies (knip)
- [ ] 8.3 Types check clean
- [ ] 8.4 Mutation testing: every surviving mutant ratified, deleted or asked
- [ ] 8.5 If specs changed during apply: openspec validate todo-list-crud --type change --strict
