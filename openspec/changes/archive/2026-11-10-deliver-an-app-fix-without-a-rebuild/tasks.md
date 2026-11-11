## 1. Tests

- [x] 1.1 The three scenarios, in `apps/server/test/scenarios/trusted-runtime-packages.test.ts`

## 2. Server

- [x] 2.1 `/deliver/app`: deploy key, path checks, the delivered copy kept on the volume, re-pinned and served at once
- [x] 2.2 A delivered copy wins over the image's copy of the same version, at boot too; an ordinary deploy clears delivered copies

## 3. Pipeline

- [x] 3.1 `tools/deliver-app.mjs` builds one app and delivers it
- [x] 3.2 `docs/DEPLOY.md`: turning delivery on
