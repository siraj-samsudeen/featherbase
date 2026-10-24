// Files still waiting for the design-system sweep (#380), each pinned to its exact
// number of rule violations. A pin may only drop; a file at zero leaves the list.
// Regenerate with DG_WRITE_PENDING=1 (see design-guards.test.ts). Stage 3 deletes this file.
export const PENDING_SWEEP: Record<string, number> = {
  'src/components/ActivityFeed.tsx': 20,
  'src/components/ActivityTimeline.tsx': 6,
  'src/components/Assignments.tsx': 6,
  'src/components/Comments.tsx': 13,
  'src/components/FormView.tsx': 83,
  'src/components/PermissionManager.tsx': 9,
  'src/index.css': 161,
  'src/pages/AccessTokens.tsx': 40,
  'src/pages/AdminLayout.tsx': 73,
  'src/pages/Login.tsx': 22,
  'src/pages/Portal.tsx': 11,
  'src/pages/ResetPassword.tsx': 11,
  'src/pages/SalesTarget.tsx': 8,
  'src/router.tsx': 2,
}
