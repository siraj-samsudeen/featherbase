## 1. First-time setup

Skipped: `acceptance-tests/` already exists.

## 2. Step definitions

- [ ] 2.1 external-data-sources: connect with the instance's token; refused token; no token
- [ ] 2.2 external-data-sources: choose databases
- [ ] 2.3 external-data-sources: a token with write rights cannot change the warehouse

## 3. Server

- [ ] 3.1 Sessions use `MOTHERDUCK_TOKEN`, resolve addresses by name, and attach read-only only
- [ ] 3.2 Actions list databases and connect with no token; `replace_token` removed
- [ ] 3.3 A DuckDB source refuses a MotherDuck address; the read-scaling check goes
- [ ] 3.4 App setup and release checks name `MOTHERDUCK_TOKEN` for a MotherDuck source
- [ ] 3.5 Migration, settings scope and the Feather Dash settings file; `secret-store.ts` and `SECRET_STORE_KEY` removed

## 4. Web

- [ ] 4.1 Connect page lists databases with no token field; source page has no token line

## 5. Docs

- [ ] 5.1 DEPLOY, instance.md, env examples, ADR 0020

## 6. Check and archive

- [ ] 6.1 Server, web and acceptance suites pass; review
- [ ] 6.2 Sync the specs and archive
