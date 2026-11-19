-- ask-questions-of-app-data (knowledge): the passages of the help folder and
-- the sources it lists (help/sources.json), each with its embedding, so a
-- question about how things work is answered from the passages nearest to it
-- in meaning. A passage is keyed by the hash of its source, heading and text
-- and by the embedding model: one that changed is embedded again, and one no
-- longer in the sources is removed.
create table if not exists featherbase.help_passage (
  id bigint generated always as identity primary key,
  source text not null,
  heading text not null,
  body text not null,
  content_hash text not null,
  model text not null,
  embedding real[] not null,
  indexed_at timestamptz not null default now(),
  unique (content_hash, model)
);
