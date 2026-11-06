## 1. Server

- [x] 1.1 Every local link is held with a key-share lock while the save runs
- [x] 1.2 A save or status change of an existing row locks it for no key update; delete and rename keep their exclusive lock
- [x] 1.3 A two-connection proof: a racing delete waits and refuses, and an edit of the linked row does not wait
