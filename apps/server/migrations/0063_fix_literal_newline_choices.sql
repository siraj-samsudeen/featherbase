-- Repair `choices` values that hold a LITERAL backslash-n instead of a real
-- newline.
--
-- Cause: Postgres runs with standard_conforming_strings = on, so a plain
-- '...\n...' literal is a backslash followed by 'n' — NOT a newline. Only an
-- E'...\n...' literal escapes. Five sites in 0004_bootstrap.sql and
-- 0055_terminology_rename.sql omitted the E prefix (their neighbours had it,
-- which is why this went unnoticed). The equivalent .ts seeds were always
-- correct, because '\n' in TypeScript *is* a newline.
--
-- Impact: `tableSchemaToZod` splits choices on a real newline, so a corrupt
-- value produced a single-member enum. Saving Permission.tier = 'basic' failed
-- with "Expected 'basic\nrestricted', received 'basic'". Table.kind and
-- Column.tier were wrong on every fresh database; Permission.tier was wrong
-- only on databases that pre-dated the 0055 rename (0055 clobbered the correct
-- value seeded by 0005_core_seeds.ts).
--
-- Those five sites now carry the E prefix, so this cannot recur. This migration
-- repairs databases already built from the broken chain. It is written with
-- chr(92) || 'n' and chr(10) rather than escaped literals so the repair itself
-- cannot fall into the same quoting trap. Idempotent: a database with correct
-- values matches nothing.

update column_def
  set choices = replace(choices, chr(92) || 'n', chr(10))
  where choices is not null
    and position(chr(92) || 'n' in choices) > 0;

update custom_field
  set choices = replace(choices, chr(92) || 'n', chr(10))
  where choices is not null
    and position(chr(92) || 'n' in choices) > 0;

-- Second, related defect in the same rename. The old `permlevel` column was
-- numeric (0 = base level) and carried default_value = '0'. 0055 renamed it to
-- `tier` and swapped in the 'basic'/'restricted' Choice list but left the stale
-- numeric default behind, so on any pre-rename database every save that omits
-- `tier` defaulted to '0' — a value outside the Choice list — and failed with
-- "Invalid values for Permission". Fresh databases were unaffected (0005 seeds
-- `tier` with default 'basic' directly, so 0055's rename no-ops), which is why
-- CI never caught it. 0055 now migrates the default; this repairs databases that
-- already ran it.
update column_def
  set default_value = case when default_value = '0' then 'basic' else 'restricted' end
  where column_name = 'tier'
    and column_type = 'Choice'
    and default_value ~ '^[0-9]+$';
