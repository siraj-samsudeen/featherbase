## 1. Recent chips skip deleted rows

- [x] 1.1 Component test: a deleted row leaves the strip, and the rows still there stay (`apps/web/test/recent-strip.test.tsx`)
- [x] 1.2 `RecentStrip` asks `/api/row_titles` about its recent rows and shows only those it answers for
- [x] 1.3 Headless browser check at 1280 and 375: delete a row from its form, return to the list
