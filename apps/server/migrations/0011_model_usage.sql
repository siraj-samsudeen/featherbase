-- ask-questions-of-app-data (guardrails): what each call to the language
-- model used, as the provider reported it, so a month's use can be held to
-- an allowance (ANALYST_MONTHLY_TOKENS). No person, question or answer is
-- kept here: the time, the model and two counts.
create table if not exists featherbase.model_usage (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  model text not null,
  input_tokens integer not null,
  output_tokens integer not null
);
create index if not exists model_usage_at on featherbase.model_usage (at);
