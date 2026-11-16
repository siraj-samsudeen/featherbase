# API

The door for programs. The owner works with Featherbase through Claude Code, so the API is built from the
start, alongside the pages.

## Sentences

Not yet written. The names of the calls are to be agreed with the owner on one page before the first is
built.

## Decided

**The API for the journey.** Plain resource addresses with a checked input and output on every route; the typed client and the API document are generated from them. Calls: send a file; get an upload's proposal; import an upload with the confirmed proposal; get a Table's definition; list a Table's rows (a page in key order, plus the total); get one row with the upload and sheet row it came from; update one row; download an upload's file. The proposal is not stored: it is worked out from the raw rows when asked. The import is one transaction and runs while the person waits. Every value travels as text: dates `2015-01-01`, numbers `"37.5"`, yes/no `"true"` / `"false"`; blank is empty. In the database they are typed (date, exact decimal, boolean). The typed client's automatic date conversion is switched off. A Table is named in a call by its `_id`. Every failure has one shape, a status and a readable message; no database text leaks. Not in this build: sign-in checks, filters and sort choices, a guard against two people editing one row

A page and an API call are two doors onto the same code: each step has one place where the work is done, and
its page and its API route both use it.
