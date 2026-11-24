# AGENTS.md

Featherbase is being rebuilt from scratch on this branch, one small step at a time. The code and its history
show how things are done here. These six rules are the ones they cannot show.

1. **The acceptance criterion comes first, and only the owner approves it.** Write it into the folder's `.md`
   file, show the owner, and wait. Never add or change a criterion yourself.
2. **Options before a choice.** For anything the owner would care about, give the options, how each bites
   later, and one recommendation. The owner decides.
3. **One step per commit, starting with the failing test.** `red:` holds the test and only what it needs to
   run. `green:` is the least code that passes. `refactor:` leaves the tests untouched.
4. **Nothing comes in before something needs it.** No package, tool, helper, folder or setting.
5. **A test or check is not trusted until it has been seen failing.** Break the code, watch it fail, restore
   it.
6. **Tests drive Featherbase from outside,** as a person would. Do not test an inner function directly.
