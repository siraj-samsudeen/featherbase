-- #855: row counters are kept per Table and prefix, under
-- 'table:<Table name>:<prefix>', instead of per prefix alone. Each Table already numbered by a series takes over the
-- count its prefix has reached, so no Table reissues a number it has issued.
-- Two Tables that shared a prefix both carry on from the shared count: their
-- next numbers are unused in either, and they part ways from here.
-- Inserts only; the old per-prefix rows stay, unread.
INSERT INTO featherbase.series (name, current)
SELECT 'table:' || td.name || ':' || s.name, s.current
FROM featherbase.table_def td
JOIN featherbase.series s ON s.name = split_part(td.id_pattern, '.', 1)
WHERE position('.#' IN td.id_pattern) > 0
ON CONFLICT (name) DO NOTHING;
