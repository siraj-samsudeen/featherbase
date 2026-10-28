## Implementation

- [x] 1. Reproduce and fix stored-path forgery through public file saves; retain upload and metadata editing behavior.
- [x] 2. Reproduce and fix IPv6 /64 limiter bypass while retaining full audit addresses.
- [x] 3. Reproduce and fix concurrent workflow action duplication with real independent connections.
- [x] 4. Prove activity insertion serializes with rename/delete on independent connections; change locking only if the report reproduces.
- [x] 5. Run targeted regressions, server typecheck and strict OpenSpec validation; report migration and policy caveats.
- [x] 6. Parent independently verifies the returned commands and archives the change in the delivery PR.
