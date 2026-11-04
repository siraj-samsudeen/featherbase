-- #855: row counters are kept per Table and prefix, under
-- 'table:<Table name>:<prefix>', instead of per prefix alone.
--
-- Which prefixes a Table used in the past is not recorded (a Table may have
-- switched rules, and its rows may be deleted), so every Table that exists at
-- upgrade takes over the count of EVERY old prefix. No Table can then reissue
-- a number it issued under any prefix, which is the series' promise. The cost
-- is that an existing Table switching to a prefix some other Table used
-- carries on from that count instead of starting at 1, as it did before the
-- upgrade. Tables created after the upgrade start at 1.
-- Inserts only; the old per-prefix rows stay, unread. Repeatable.
INSERT INTO featherbase.series (name, current)
SELECT 'table:' || td.name || ':' || s.name, s.current
FROM featherbase.table_def td
CROSS JOIN featherbase.series s
WHERE td.kind = 'table'
  AND td.data_source IS NULL
  AND NOT starts_with(s.name, 'table:')
ON CONFLICT (name) DO NOTHING;
