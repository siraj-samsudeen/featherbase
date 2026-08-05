# zones-v2.csv — claims

Spec 0004's prior-state pair-half (trial #1 finding: residue-shaped
features reuse the upstream fixture). Byte-identical to `zones.csv` except
**one changed cell**: Alpha's Population, 12000 → 13500.

The pair (an existing Table imported from `zones.csv`, then this file
re-imported on the *Zone Name* key) exercises clean 1:1 matching: all
eight rows match, exactly one carries a new value, zero insert.

**Limits, stated on purpose (spec 0004 §Prior state):** hostile matching —
duplicate keys, multi-matches, empty keys — lives in UPS-R2's example
table and property tests, not in this file.
