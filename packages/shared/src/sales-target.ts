// The sales-target report's wire contract for WHY a reader sees their figures (#3783). One list,
// in the order the page names them — leadership first — so server and page cannot drift apart.
export const SCOPE_BASES = ['store_manager', 'department_manager', 'team_leader', 'section_staff', 'assignment'] as const
export type ScopeBasis = (typeof SCOPE_BASES)[number]
