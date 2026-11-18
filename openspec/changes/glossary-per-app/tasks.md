## 1. The server reads a glossary per app

- [x] 1.1 An app's glossary: its terms, then the instance's; refused to those who cannot use the app. Verify `apps/server/test/scenarios/glossary-per-app.test.ts` ("An app's glossary holds its words and the company's", "A person who cannot use the app cannot read its glossary").
- [x] 1.2 A repeated word shows under each source. Verify `scenarios/glossary-per-app.test.ts` ("One word, two sources").

## 2. The way in

- [x] 2.1 The glossary page per app; the Help menu opens it; the Admin page and link are removed. Verify `apps/web/test/scenarios/glossary-per-app.test.tsx`.

## 3. Later, with the owner

- [x] 3.1 Dash, Tasker and Tickets ship their own terms in their manifests (the terms the sources state; wording to be refined later).
- [ ] 3.2 The (?) in place on Dash's pages (decision 3): a separate change.
- [ ] 3.3 The owner tries it on localhost and approves before it is pushed.
