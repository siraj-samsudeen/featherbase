# Apache Hudi & the lakehouse ingestion stack — the ETL egress study

> Study, 2026-07-26. Family: **lakehouse storage/ingestion** (a new
> category in this series — the *downstream* of everything else). Written
> to answer: how does master data flow from Featherbase into the
> bronze/silver (medallion) layers, and can the ingestion config — today
> hand-written CSVs — be auto-generated from DocType metadata? Covers
> Hudi as the named system, with Debezium, dbt, and Databricks' DLT-META
> as the surrounding stack.

## What Hudi is

An open-source **lakehouse table format + ingestion platform** (peer of
Delta Lake and Iceberg, originally from Uber): it brings record-level
**upserts and deletes** to files on object storage, so a data lake can be
kept in sync with operational databases instead of being append-only
dumps. Widely adopted (notably across Indian data teams) for CDC-heavy
pipelines.

## Key dimensions

1. **Primary keys in the lake.** Every Hudi record has a **record key**
   (+ optional partition path); writes are upserts against that key, via
   an index that locates the file group holding each key. The lake stops
   being "append and dedupe later" and becomes a keyed store.
2. **The precombine field.** When two versions of a record collide, the
   one with the larger precombine value (typically the update timestamp)
   wins — ordering semantics declared as metadata, not coded per
   pipeline.
3. **The timeline.** Every commit is a timestamped action on a table
   timeline; this powers time travel, rollback, and — the crown jewel —
   **incremental queries**: "give me exactly the records that changed
   since instant T". Downstream jobs consume changes in chunks without
   rescanning the table, decoupling writers from readers.
4. **CDC on both ends.** Ingest side: HoodieStreamer (formerly
   DeltaStreamer) tails Kafka/Debezium/JDBC sources into Hudi tables
   continuously, with schema evolution handled. Serve side: Hudi can
   materialize change streams (or infer them on read) for the next hop.
5. **Copy-on-write vs merge-on-read** table types — the write-latency vs
   read-cost dial, chosen per table.

## The surrounding stack (how the medallion actually runs)

- **Debezium / Postgres logical replication** — row-level change capture
  from an operational database with zero application code; the standard
  bronze feed.
- **Bronze** — raw, append-only landed changes (full payloads +
  ingestion metadata). **Silver** — cleaned, deduplicated, *keyed*
  (Hudi's upserts naturally live here), conformed types, SCD handling.
  **Gold** — business marts.
- **dbt** — SQL transformations as versioned, tested models;
  `sources.yml` + staging models are the silver layer's code form.
- **DLT-META (Databricks Labs)** — the direct precedent for the
  auto-generation ask: a *metadata-driven* framework where an
  "onboarding JSON" (the **Dataflowspec**: source, target, quality
  rules, CDC settings per table) drives one generic pipeline that builds
  all bronze/silver flows. The hand-written per-table pipeline is
  replaced by config — and config can be *generated*.
  *Status caveat (2026-07):* activity is thin (last release 2025-09,
  sparse commits since) and, like all Databricks Labs projects, it is
  explicitly unsupported — no SLA, "exploration purposes only". The
  verdict for Featherbase: **adopt the Dataflowspec idea, never the
  dependency** — D20 generates *our own* spec format plus whatever the
  client's runner needs (DLT-META's JSON being just one emit target).

## What this enables

- Operational data lands in the lake continuously, keyed and deduped,
  with downstream consumers pulling *only deltas* — the warehouse stays
  minutes behind the app instead of a nightly batch behind.
- One declarative spec per table instead of one pipeline per table
  (DLT-META's lesson), which is exactly what the current
  CSV-in-git config is groping toward.

## Downsides

- Hudi is operationally heavy: Spark/Flink runtimes, compaction and
  clustering to babysit, config sprawl (dozens of `hoodie.*` knobs); for
  small/medium estates, Postgres + dbt + DuckDB/Iceberg-lite may serve
  better. Choose it for scale/CDC needs, not by default.
- Table-format wars (Hudi/Delta/Iceberg) mean the *format* choice is
  volatile — the stable investment is the metadata that generates
  configs, which can retarget formats.
- CDC pipelines silently rot when source schemas drift and nobody owns
  the mapping — the precise failure the auto-generation below removes.

## What Featherbase should adopt (the ETL answer, D20)

The realization: **a DocType already contains everything the medallion
config needs** — physical table, fields and types, PK, the `modified`
column (incremental/precombine key), soft-delete semantics, and (with
D16) effectivity columns. So the warehouse side stops being a modeling
exercise:

1. **Analytics egress as a declared sync-binding kind (Axis B / D6):**
   a DocType (or a whole module/app) declares `egress: analytics`, with a
   target (lake path / schema) and transport chosen by capability:
   Postgres **logical replication/Debezium** for local tables (zero app
   work), the **outbox** for external/adopted sources where replication
   isn't available, snapshot for small dimensions.
2. **Generate the configs as one-way D19 artifacts:** from DocType
   metadata, emit (a) the **existing bronze/silver CSV config** the
   agents maintain today — same format, now derived; (b) **dbt
   `sources.yml` + staging models** with column types, tests
   (not-null/unique from field metadata), and doc strings from labels;
   (c) **HoodieStreamer / DLT-META Dataflowspec** configs where that
   stack is in play — record key = DocType PK, precombine = `modified`.
   Regenerated whenever the DocType changes, so warehouse schema drift
   follows metadata promotion (Axis F) instead of being discovered at 2am.
3. **Axis E makes SCD free:** version history + effectivity dating map
   directly to SCD Type 2 — `valid_from`/`valid_to` flow into silver
   without any warehouse-side modeling. Hudi's timeline/incremental
   queries are the same idea downstream; Featherbase's replay ("changes
   since T", §7.1) is the handshake between them.
4. **MDM as the source of conformed dimensions:** the strategic loop
   closes — the master data app governs customer/vendor/item *upstream*,
   and the warehouse's dimension tables are *generated* from those same
   DocTypes. Golden records in, conformed dims out, one metadata source.

**Do not adopt:** running lake infrastructure inside Featherbase (emit
configs and streams; let the lake stack be whatever the client runs);
hand-maintained per-table pipeline code (the DLT-META lesson); coupling
to one table format (generate for Hudi today, Iceberg tomorrow — the
metadata is the constant).
