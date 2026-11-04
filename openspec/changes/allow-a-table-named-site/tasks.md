## 1. Build

- [ ] 1.1 A failing test: a Table "Site" is created and holds a row, and `public.site` is unchanged
- [ ] 1.2 Remove the `site` special case from `createTable`'s clash check, keeping the platform-schema check
- [ ] 1.3 `pnpm --filter server typecheck` and the server suite pass

## 2. Close

- [ ] 2.1 `pnpm exec openspec validate allow-a-table-named-site --type change --strict`
- [ ] 2.2 Sync the spec and archive the change
