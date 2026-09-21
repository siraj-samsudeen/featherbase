## Decisions

The bootstrap is a data-free list of active runtime package identities, derived from installed state plus the process's active registry under normal shared lifecycle admission. It exposes no artifact paths, permission declarations or manager controls. Data authorization remains unchanged. Missing-version, pending, disabled and unavailable packages are omitted; requests accessing them still fail closed.

The generic browser caches one in-flight snapshot per bearer session in memory, before its first authenticated data/metadata request. It never refreshes on navigation, refetch or 409; reload or a new login obtains a new snapshot. JSON and multipart uploads share the client request path. This pins identity before metadata or values are loaded, preventing a stale form from adopting a newer version for a later save.

The existing X-Featherbase-App-Version header accepts either the existing single identity or a comma-separated list of distinct identities. Generic requests can traverse app references or a File/Comment list covering multiple apps, so selecting one identity from a URL is insufficient. Parsing rejects malformed and duplicate app entries; each app access still checks its own exact installed version and current availability. The list grants no permissions and arbitrary caller strings cannot override installed state. Existing independently built app clients keep their single identity unchanged.

No visual redesign. Private file navigation retains its existing cookie/signed-URL contract; File metadata creation/list/removal and multipart upload use pinned API admission. Trusted Node package powers, single-server activation and immutable operator artifacts remain the existing domain assumptions.

## Review and verification

Spec five-axis review: external immutable artifact/trust assumptions remain separate from machine promises; new behavior is governed and testable. Partition bootstrap before/after activation, no version, disabled, missing artifact, concurrent requests, two apps, malformed/duplicate header, session change and stale old form. Asymmetric tests must distinguish 0.0.1 from 2.0.0 and one app from another. Use worker-owned upgrade test/e2e databases only. Review code/test axes, preserve old single-header tests, run full affected suites/types/spec checks and literal frozen-core browser proof. Independent reviewer receives committed integration chain rather than a claim of acceptance.
