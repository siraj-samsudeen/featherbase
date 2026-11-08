## 1. Tests

- [x] 1.1 Server tests, on real commits where it matters, and acceptance steps for the scenarios, red first

## 2. Platform

- [x] 2.1 `ctx.mail.mayRead` and `ctx.mail.toPerson` on runtime actions; queued after the commit; the link's origin is the address that serves the app

## 3. Tickets

- [x] 3.1 The `edit` action emails a new assignee; `create` never does
- [x] 3.2 `?ticket=<id>` opens that ticket
- [x] 3.3 Version 0.2.4 with an empty upgrade step from 0.2.3; the dash instance's previous versions list 0.2.3
