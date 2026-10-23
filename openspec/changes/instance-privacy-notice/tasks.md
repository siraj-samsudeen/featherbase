# Tasks

- [x] 1.1 Write failing server tests (a plain HTML 404 page when unset or blank; 200 HTML with the rendered Markdown, cacheable for five minutes; no script even when the Markdown carries HTML or `javascript:` links; images never load; `/privacy/` redirects; public; only a System Manager may change it), then add the System Settings field (migration 0105) and the `/privacy` route ahead of the legacy-path redirect; verify `apps/server/test/privacy-notice.test.ts`.
- [x] 1.2 Write failing CLI tests, then add `cli settings:set <field> --stdin`, limited to System Settings data fields and recorded in the Activity Log; verify `apps/server/test/cli.test.ts`.
- [x] 1.3 `docs/DEPLOY.md`: where an instance's text lives and how to apply it.
