## Decisions
Inspect bounding boxes and scroll containers before changing CSS. The current heading/actions are an unwrapped flex row; actions can force a wider scroll area even with a min-width-zero page canvas. Allow that row to wrap and give heading/field content explicit shrink/wrap boundaries. Preserve desktop two-column sections and supplemental sidebar. Keep attachment removal visible rather than making hover a prerequisite; wrap long filenames so identity stays available.

No global overflow hiding, forced document width, Tasker selectors, route changes, or identity refresh. Existing 403/409 messages stay truthful and the signed-in snapshot stays pinned.

## Review and proof
Five-axis review: this changes a characterized limitation to governed containment. Browser viewport and CSS rendering are test inputs, not inferred from jsdom. Bound assertions check each relevant element's left and right edges plus the page canvas, because document scrollWidth alone misses an internally scrolled form. Partition blank/populated/validation error and pending/obsolete refusal; attachment empty/populated/failed operation, long filename, keyboard removal. Desktop is the counterexample against an unconditional single-column fix. Existing real server identity tests retain the semantic 403/409 proof; browser rendering may inject error responses only to exercise presentation, explicitly separated from server proof.

Prove on worker-owned `featherbase_296_responsive_e2e`, API 8826 and web 5226, after checking the local PostgreSQL listener and resolved DB name. Parent integrates unchanged acceptance at 347f7f0; this worker must not edit its package-proof file. Existing public-auth fix remains intact.
