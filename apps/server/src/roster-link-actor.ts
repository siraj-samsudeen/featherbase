// The roster link's name (#1157): the `linked_by` on a link it made before
// anyone signed in, and the actor it writes as. A leaf with no imports, since
// modules read it while they load (document-activity's labels). Server-only:
// the shared package is bundled into apps' clients, which must not move for it.
export const ROSTER_LINK_ACTOR = 'roster-link'
