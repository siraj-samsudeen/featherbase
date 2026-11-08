## 1. Tests first

- [x] 1.1 Server tests: attach to a row the user may change and open it; someone who can't open the row is refused the file; read-only attach refused with nothing stored; without a row, access to files is still needed
- [x] 1.2 Tasker server tests: evidence and issue photos open for whoever can open the task or issue, and stay closed to everyone else
- [x] 1.3 Tasker component tests: photos hang on their task or issue; an issue whose photo can't be stored is still raised
- [ ] 1.4 Acceptance step definitions for the two scenarios

## 2. Build

- [x] 2.1 The upload service lets whoever may change the row attach to it, and checks access before storing anything
- [x] 2.2 Tasker 3.3.1 uploads the evidence photo onto its task and the issue photo onto its issue
