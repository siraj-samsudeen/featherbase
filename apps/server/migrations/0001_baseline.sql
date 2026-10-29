-- The platform's schema and seed rows, as every install starts from them.
-- Generated, never edited:
-- `pnpm --filter server baseline:generate` (scripts/generate-baseline.ts).

SET LOCAL standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', true);
SET LOCAL check_function_bodies = false;
SET LOCAL xmloption = content;
SET LOCAL client_min_messages = warning;
SET LOCAL row_security = off;


--
-- Name: featherbase; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS featherbase;


--
-- Name: btree_gist; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA featherbase;


--
-- Name: fc_cancel_email_invites(); Type: FUNCTION; Schema: featherbase; Owner: -
--

CREATE FUNCTION featherbase.fc_cancel_email_invites() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
    begin
      if lower(trim(coalesce(old.email, ''))) is distinct from lower(trim(coalesce(new.email, ''))) then
        delete from featherbase.sign_in_identity
        where person_id = new.row_id and subject is null;
      end if;
      return new;
    end $$;


--
-- Name: fc_clear_expected_sign_in(); Type: FUNCTION; Schema: featherbase; Owner: -
--

CREATE FUNCTION featherbase.fc_clear_expected_sign_in() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
    begin
      if lower(trim(coalesce(old.email, ''))) is distinct from lower(trim(coalesce(new.email, '')))
         and not (new.expects_google_sign_in and not old.expects_google_sign_in) then
        new.expects_google_sign_in := false;
      end if;
      return new;
    end $$;


--
-- Name: fc_has_read(text); Type: FUNCTION; Schema: featherbase; Owner: -
--

CREATE FUNCTION featherbase.fc_has_read(tbl text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
      select featherbase.fc_session_user() = 'Administrator'
        or exists (
          select 1
          from featherbase.permission p
          join featherbase.has_role hr
            on hr.role = p.role
           and hr.parenttype in ('Person', 'Service Account')
           and hr.parent = featherbase.fc_session_user()
          where p.ref_table = tbl
            and coalesce(p.tier, 'basic') = 'basic'
            and p.can_read
        )
    $$;


--
-- Name: fc_person_id_is_permanent(); Type: FUNCTION; Schema: featherbase; Owner: -
--

CREATE FUNCTION featherbase.fc_person_id_is_permanent() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
    begin
      if new.row_id is distinct from old.row_id
         and coalesce(current_setting('featherbase.allow_person_id_change', true), '') <> 'on' then
        raise exception 'A person''s id is permanent: person % cannot be renamed', old.row_id;
      end if;
      return new;
    end $$;


--
-- Name: fc_session_user(); Type: FUNCTION; Schema: featherbase; Owner: -
--

CREATE FUNCTION featherbase.fc_session_user() RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog'
    AS $$
  select coalesce(nullif(current_setting('app.user', true), ''), 'Guest')
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;


--
-- Name: access_log; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.access_log (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "user" character varying(140),
    operation character varying(140),
    ref_table character varying(140),
    reference_name character varying(140),
    method character varying(140),
    scope text
);


--
-- Name: access_token; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.access_token (
    id character varying(140) NOT NULL,
    label character varying(140) NOT NULL,
    token_hash character(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    person character varying(140),
    service_account character varying(140),
    CONSTRAINT access_token_one_principal CHECK (((person IS NULL) <> (service_account IS NULL)))
);


--
-- Name: activity_log; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.activity_log (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "user" character varying(140),
    operation character varying(140),
    full_name character varying(140),
    ip_address character varying(140),
    sign_in_method character varying(140),
    test_mode boolean
);


--
-- Name: app_dataset_row; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.app_dataset_row (
    snapshot_id text NOT NULL,
    "row" jsonb NOT NULL
);


--
-- Name: app_role_binding; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.app_role_binding (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    app character varying(140),
    app_role character varying(140),
    bound_role character varying(140)
);


--
-- Name: app_setting; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.app_setting (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    app character varying(140),
    setting character varying(140),
    value text
);


--
-- Name: assignment_rule; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.assignment_rule (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    ref_table character varying(140),
    description character varying(140),
    assign_condition text,
    assign_to_field character varying(140),
    disabled boolean,
    last_user character varying(140)
);


--
-- Name: assignment_rule_user; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.assignment_rule_user (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    parent character varying(140),
    parenttype character varying(140),
    parentfield character varying(140),
    "user" character varying(140)
);


--
-- Name: auto_email_report; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.auto_email_report (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    report character varying(140),
    recipients text,
    file_format text,
    frequency text,
    enabled boolean,
    last_sent timestamp with time zone
);


--
-- Name: background_job; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.background_job (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    method character varying(140),
    payload jsonb,
    job_status text,
    attempts bigint,
    max_attempts bigint,
    run_at timestamp with time zone,
    error text,
    repeat_every bigint,
    trigger text
);


--
-- Name: client_script; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.client_script (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    ref_table character varying(140),
    script text,
    enabled boolean
);


--
-- Name: column_def; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.column_def (
    row_id text DEFAULT (gen_random_uuid())::text NOT NULL,
    parent text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    column_name text NOT NULL,
    label text,
    column_type text NOT NULL,
    reference_table text,
    choices text,
    row_table text,
    reqd boolean DEFAULT false NOT NULL,
    "unique" boolean DEFAULT false NOT NULL,
    default_value text,
    read_only boolean DEFAULT false NOT NULL,
    hidden boolean DEFAULT false NOT NULL,
    in_list_view boolean DEFAULT false NOT NULL,
    tier text DEFAULT 'basic'::text NOT NULL,
    created_by text DEFAULT 'Administrator'::text NOT NULL,
    updated_by text DEFAULT 'Administrator'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    parenttype text DEFAULT 'Table'::text NOT NULL,
    parentfield text DEFAULT 'columns'::text NOT NULL,
    custom boolean DEFAULT false NOT NULL,
    source_column text,
    source_fk_schema text,
    source_fk_table text,
    source_fk_column text,
    description text
);


--
-- Name: comment; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.comment (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    ref_table character varying(140),
    ref_name character varying(140),
    content text
);


--
-- Name: custom_field; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.custom_field (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    dt character varying(140),
    column_name character varying(140),
    label character varying(140),
    column_type character varying(140),
    reference_table character varying(140),
    choices text,
    row_table character varying(140),
    reqd boolean,
    in_list_view boolean
);


--
-- Name: dashboard; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.dashboard (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    label character varying(140),
    config jsonb
);


--
-- Name: data_scope; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.data_scope (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    allow_table character varying(140),
    for_value character varying(140),
    person character varying(140),
    service_account character varying(140),
    CONSTRAINT data_scope_one_principal CHECK (((person IS NULL) <> (service_account IS NULL)))
);


--
-- Name: data_source; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.data_source (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    engine text,
    url_env character varying(140),
    root_path character varying(140),
    default_schema character varying(140),
    access text,
    pool_max bigint,
    statement_timeout_ms bigint,
    table_allowlist text,
    conn_status text,
    last_checked_at timestamp with time zone,
    last_error text,
    read_scaling_token boolean DEFAULT false NOT NULL
);


--
-- Name: dataset_miss; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.dataset_miss (
    row_id character varying(140) CONSTRAINT dataset_miss_row_id_not_null1 NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    dataset character varying(140),
    first_seen timestamp with time zone,
    last_seen timestamp with time zone,
    hits bigint
);


--
-- Name: dataset_place_drop; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.dataset_place_drop (
    app text NOT NULL,
    dataset text NOT NULL,
    provider text NOT NULL,
    filter_keys text[] NOT NULL,
    app_version text NOT NULL,
    provider_version text NOT NULL,
    first_seen timestamp with time zone DEFAULT now() NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dataset_snapshot; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.dataset_snapshot (
    row_id character varying(140) CONSTRAINT dataset_snapshot_row_id_not_null1 NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text CONSTRAINT dataset_snapshot_status_not_null1 NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    dataset character varying(140),
    state text,
    definition_version character varying(140),
    source_as_of date,
    built_at timestamp with time zone,
    activated_at timestamp with time zone,
    row_count bigint,
    bytes bigint,
    fetch_ms bigint,
    load_ms bigint,
    triggered_by character varying(140),
    error text
);


--
-- Name: email_account; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.email_account (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    email_id character varying(140),
    smtp_host character varying(140),
    smtp_port bigint,
    is_default boolean
);


--
-- Name: email_queue; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.email_queue (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    sender character varying(140),
    recipient character varying(140),
    subject character varying(140),
    body text,
    send_status text,
    error text,
    ref_table character varying(140),
    reference_name character varying(140),
    attachments jsonb
);


--
-- Name: email_rule; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.email_rule (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    ref_table character varying(140),
    event text,
    condition_field character varying(140),
    condition_value character varying(140),
    recipient character varying(140),
    subject character varying(140),
    message text,
    enabled boolean
);


--
-- Name: email_sink; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.email_sink (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    mail_from character varying(140),
    mail_to character varying(140),
    subject character varying(140),
    body text,
    attachment_names character varying(140),
    attachment_b64 text
);


--
-- Name: file; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.file (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    file_name character varying(140),
    file_url character varying(140),
    mime_type character varying(140),
    file_size bigint,
    is_private boolean,
    ref_table character varying(140),
    ref_name character varying(140),
    thumbnail_url text
);


--
-- Name: glossary_avoid_word; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.glossary_avoid_word (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    parent character varying(140),
    parenttype character varying(140),
    parentfield character varying(140),
    word character varying(140),
    reason character varying(140)
);


--
-- Name: glossary_link; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.glossary_link (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    parent character varying(140),
    parenttype character varying(140),
    parentfield character varying(140),
    link_table character varying(140),
    link_column character varying(140)
);


--
-- Name: glossary_term; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.glossary_term (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    term character varying(140),
    app character varying(140),
    definition text,
    examples text,
    app_key character varying(140),
    app_wording jsonb,
    app_wording_changed boolean
);


--
-- Name: has_role; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.has_role (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    parent character varying(140),
    parenttype character varying(140),
    parentfield character varying(140),
    role character varying(140),
    person character varying(140) GENERATED ALWAYS AS (
CASE
    WHEN ((parenttype)::text = 'Person'::text) THEN parent
    ELSE NULL::character varying
END) STORED,
    service_account character varying(140) GENERATED ALWAYS AS (
CASE
    WHEN ((parenttype)::text = 'Service Account'::text) THEN parent
    ELSE NULL::character varying
END) STORED
);


--
-- Name: health_check_event; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.health_check_event (
    id bigint NOT NULL,
    check_key text NOT NULL,
    ok boolean NOT NULL,
    severity text NOT NULL,
    message text NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT health_check_event_severity_check CHECK ((severity = ANY (ARRAY['error'::text, 'warning'::text])))
);


--
-- Name: health_check_event_id_seq; Type: SEQUENCE; Schema: featherbase; Owner: -
--

CREATE SEQUENCE featherbase.health_check_event_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: health_check_event_id_seq; Type: SEQUENCE OWNED BY; Schema: featherbase; Owner: -
--

ALTER SEQUENCE featherbase.health_check_event_id_seq OWNED BY featherbase.health_check_event.id;


--
-- Name: home_page; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.home_page (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    label character varying(140),
    icon character varying(140),
    module character varying(140),
    sequence bigint,
    shortcuts jsonb
);


--
-- Name: home_page_link; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.home_page_link (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    parent character varying(140),
    parenttype character varying(140),
    parentfield character varying(140),
    label character varying(140),
    type text,
    link_to character varying(140)
);


--
-- Name: home_page_role; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.home_page_role (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    parent character varying(140),
    parenttype character varying(140),
    parentfield character varying(140),
    role character varying(140)
);


--
-- Name: identifier_system; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.identifier_system (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    label character varying(140),
    kind text,
    source character varying(140),
    match text,
    sensitivity text,
    normalise text,
    one_holder_at_a_time boolean,
    one_per_person boolean,
    assigner_scoped boolean,
    edited_by text,
    retain_after_leaving_days bigint,
    enabled boolean,
    storage character varying(140),
    display character varying(140),
    tier character varying(140)
);


--
-- Name: import_conflict; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.import_conflict (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    ref_table character varying(140),
    ref_name character varying(140),
    field character varying(140),
    kept jsonb,
    incoming jsonb,
    editor character varying(140),
    edited_at timestamp with time zone,
    run_id character varying(140),
    closed boolean
);


--
-- Name: import_log; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.import_log (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    ref_table character varying(140),
    file_name character varying(140),
    sheet_name character varying(140),
    table_created boolean,
    inserted bigint,
    updated bigint,
    failed bigint,
    error_summary text,
    key_column character varying(140),
    empty_cells text,
    part bigint,
    parts bigint,
    run_id character varying(140),
    batch_id character varying(140),
    touched jsonb,
    reverted_at timestamp with time zone
);


--
-- Name: import_source; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.import_source (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    ref_table character varying(140),
    ref_name character varying(140),
    "values" jsonb,
    run_id character varying(140)
);


--
-- Name: installed_app; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.installed_app (
    name text NOT NULL,
    tables jsonb DEFAULT '[]'::jsonb NOT NULL,
    installed_at timestamp with time zone DEFAULT now() NOT NULL,
    roles jsonb DEFAULT '[]'::jsonb NOT NULL,
    perms jsonb DEFAULT '[]'::jsonb NOT NULL,
    manifest jsonb,
    fixtures jsonb DEFAULT '[]'::jsonb NOT NULL,
    sources jsonb,
    enabled boolean DEFAULT true NOT NULL,
    runtime_package boolean DEFAULT false NOT NULL,
    package_version text,
    artifact_digest text,
    migration_ledger jsonb DEFAULT '[]'::jsonb NOT NULL,
    activation_pending boolean DEFAULT false NOT NULL,
    previous_artifact jsonb,
    upgrade_plan text
);


--
-- Name: instance_settings_apply; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.instance_settings_apply (
    id boolean DEFAULT true NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_by text NOT NULL,
    environment text,
    revision text,
    run text,
    managed_paths jsonb DEFAULT '[]'::jsonb NOT NULL,
    managed_values jsonb,
    CONSTRAINT instance_settings_apply_id_check CHECK (id)
);


--
-- Name: internal_metadata; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.internal_metadata (
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: job_execution; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.job_execution (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    job character varying(140),
    method character varying(140),
    attempt bigint,
    outcome text,
    error text,
    started_at timestamp with time zone,
    duration_ms bigint,
    result text
);


--
-- Name: letter_head; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.letter_head (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    is_default boolean,
    header_html text,
    footer_html text
);


--
-- Name: metadata_override; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.metadata_override (
    row_id character varying(140) CONSTRAINT property_setter_row_id_not_null NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying CONSTRAINT property_setter_created_by_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT property_setter_created_at_not_null NOT NULL,
    updated_at timestamp with time zone DEFAULT now() CONSTRAINT property_setter_updated_at_not_null NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying CONSTRAINT property_setter_updated_by_not_null NOT NULL,
    status text DEFAULT 'draft'::text CONSTRAINT property_setter_status_not_null NOT NULL,
    "position" integer DEFAULT 0 CONSTRAINT property_setter_position_not_null NOT NULL,
    table_name character varying(140),
    column_name character varying(140),
    property character varying(140),
    value character varying(140)
);


--
-- Name: notification_log; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.notification_log (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    for_user character varying(140),
    subject character varying(140),
    ref_table character varying(140),
    ref_name character varying(140),
    read boolean
);


--
-- Name: password_reset; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.password_reset (
    token text NOT NULL,
    "user" character varying(140) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: permission; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.permission (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    ref_table character varying(140),
    role character varying(140),
    tier text,
    own_rows_only boolean,
    can_read boolean,
    can_write boolean,
    can_create boolean,
    can_delete boolean,
    can_submit boolean,
    can_cancel boolean,
    can_amend boolean,
    owner_app text
);


--
-- Name: person; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.person (
    row_id character varying(140) CONSTRAINT user_row_id_not_null NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying CONSTRAINT user_created_by_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT user_created_at_not_null NOT NULL,
    updated_at timestamp with time zone DEFAULT now() CONSTRAINT user_updated_at_not_null NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying CONSTRAINT user_updated_by_not_null NOT NULL,
    status text DEFAULT 'draft'::text CONSTRAINT user_status_not_null NOT NULL,
    "position" integer DEFAULT 0 CONSTRAINT user_position_not_null NOT NULL,
    email character varying(140),
    full_name character varying(140),
    enabled boolean,
    password_hash character varying(140),
    language character varying(140),
    user_image text,
    api_rate_limit bigint,
    theme text,
    username character varying(140),
    built_in boolean DEFAULT false NOT NULL,
    replaced_by character varying(140),
    sessions_ended_at timestamp with time zone,
    expects_google_sign_in boolean DEFAULT false NOT NULL,
    CONSTRAINT person_id_namespace CHECK ((built_in OR ((row_id)::text ~~ 'psn\_%'::text))),
    CONSTRAINT person_replaced_is_disabled CHECK (((replaced_by IS NULL) OR (NOT enabled)))
);


--
-- Name: person_id_map; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.person_id_map (
    old_id character varying(140) NOT NULL,
    new_id character varying(140) NOT NULL,
    kind text NOT NULL,
    mapped_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT person_id_map_kind_check CHECK ((kind = ANY (ARRAY['person'::text, 'service_account'::text])))
);


--
-- Name: person_identifier; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.person_identifier (
    id character varying(40) NOT NULL,
    person_id character varying(140) NOT NULL,
    system character varying(140) NOT NULL,
    assigner character varying(140) DEFAULT ''::character varying NOT NULL,
    value character varying(255),
    value_hint character varying(16),
    valid daterange DEFAULT daterange('-infinity'::date, NULL::date, '[)'::text) NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    record_identifier_id character varying(40),
    worker_type character varying(40),
    one_holder boolean DEFAULT false NOT NULL,
    one_per_person boolean DEFAULT false NOT NULL,
    source character varying(140) NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    recorded_by character varying(140) NOT NULL,
    edited_at timestamp with time zone,
    edited_by character varying(140),
    note text,
    CONSTRAINT person_identifier_valid_not_empty CHECK ((NOT isempty(valid))),
    CONSTRAINT person_identifier_value_or_hint CHECK (((value IS NOT NULL) OR (value_hint IS NOT NULL)))
);


--
-- Name: person_identifier_fingerprint; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.person_identifier_fingerprint (
    identifier_id character varying(40) NOT NULL,
    fingerprint bytea,
    key_id text,
    erased_at timestamp with time zone
);


--
-- Name: person_match; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.person_match (
    id character varying(40) NOT NULL,
    system character varying(140) NOT NULL,
    assigner character varying(140) DEFAULT ''::character varying NOT NULL,
    anchor_identifier_id character varying(40) NOT NULL,
    strength text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    snoozed_until timestamp with time zone,
    decided_by character varying(140),
    decided_at timestamp with time zone,
    decision_note text,
    reopened_at timestamp with time zone,
    reopen_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT person_match_status_check CHECK ((status = ANY (ARRAY['open'::text, 'deferred'::text, 'later'::text, 'merged'::text, 'not-the-same-person'::text, 'withdrawn'::text]))),
    CONSTRAINT person_match_strength_check CHECK ((strength = ANY (ARRAY['strong'::text, 'weak'::text])))
);


--
-- Name: person_match_member; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.person_match_member (
    match_id character varying(40) NOT NULL,
    person_id character varying(140) NOT NULL,
    identifier_id character varying(40) NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: person_merge; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.person_merge (
    id character varying(40) NOT NULL,
    survivor_id character varying(140) NOT NULL,
    loser_id character varying(140) NOT NULL,
    match_id character varying(40),
    merged_by character varying(140) NOT NULL,
    merged_at timestamp with time zone DEFAULT now() NOT NULL,
    moved jsonb DEFAULT '[]'::jsonb NOT NULL,
    deleted jsonb DEFAULT '[]'::jsonb NOT NULL,
    survivorship jsonb DEFAULT '{}'::jsonb NOT NULL,
    scope_choices jsonb DEFAULT '{}'::jsonb NOT NULL,
    loser_enabled_before boolean,
    undone_at timestamp with time zone,
    undone_by character varying(140),
    leftovers jsonb DEFAULT '[]'::jsonb NOT NULL,
    note text
);


--
-- Name: pre_auth_bucket; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.pre_auth_bucket (
    key text NOT NULL,
    hits integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revision uuid NOT NULL,
    CONSTRAINT pre_auth_bucket_hits_check CHECK ((hits > 0))
);


--
-- Name: print_format; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.print_format (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    ref_table character varying(140),
    is_default boolean,
    template text,
    letter_head character varying(140)
);


--
-- Name: report; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.report (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    ref_table character varying(140),
    config jsonb,
    report_type text,
    report_script character varying(140)
);


--
-- Name: revoked_session; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.revoked_session (
    jti text NOT NULL,
    person_id text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: role; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.role (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    disabled boolean
);


--
-- Name: runtime_action_result; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.runtime_action_result (
    caller text NOT NULL,
    app text NOT NULL,
    action text NOT NULL,
    idempotency_key text NOT NULL,
    payload text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "authorization" jsonb
);


--
-- Name: sales_target_snapshot_name; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.sales_target_snapshot_name (
    snapshot_id text NOT NULL,
    hierarchy_code text NOT NULL,
    subcategory text
);


--
-- Name: sales_target_snapshot_row; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.sales_target_snapshot_row (
    snapshot_id text NOT NULL,
    plant_code text NOT NULL,
    store_name text,
    short_code text,
    hierarchy_code text NOT NULL,
    subcategory text,
    business_date date NOT NULL,
    target_before_tax numeric,
    actual_before_tax numeric
);


--
-- Name: saved_view; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.saved_view (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    ref_table character varying(140),
    label character varying(140),
    filters jsonb,
    shared boolean
);


--
-- Name: scheduled_job; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.scheduled_job (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    method character varying(140),
    cadence text,
    enabled boolean,
    description text,
    last_run_at timestamp with time zone,
    last_outcome text,
    last_duration_ms bigint,
    last_result text,
    problem_alert_queued boolean DEFAULT false
);


--
-- Name: series; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.series (
    name text NOT NULL,
    current bigint DEFAULT 0 NOT NULL
);


--
-- Name: server_script; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.server_script (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    script_type text,
    ref_table character varying(140),
    event text,
    api_method character varying(140),
    script text,
    enabled boolean
);


--
-- Name: service_account; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.service_account (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    label character varying(140),
    enabled boolean,
    api_rate_limit bigint,
    CONSTRAINT service_account_id_namespace CHECK (((row_id)::text ~~ 'svc\_%'::text))
);


--
-- Name: service_level_agreement; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.service_level_agreement (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    ref_table character varying(140),
    enabled boolean,
    priority_field character varying(140),
    fulfilled_states text,
    escalation_role character varying(140)
);


--
-- Name: share; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.share (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    share_table character varying(140),
    share_name character varying(140),
    read boolean,
    write boolean,
    share boolean,
    person character varying(140),
    service_account character varying(140),
    CONSTRAINT share_one_principal CHECK (((person IS NULL) <> (service_account IS NULL)))
);


--
-- Name: sign_in_identity; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.sign_in_identity (
    id character varying(40) CONSTRAINT user_identity_id_not_null NOT NULL,
    person_id character varying(140) CONSTRAINT user_identity_user_id_not_null NOT NULL,
    method character varying(140) CONSTRAINT user_identity_method_not_null NOT NULL,
    subject character varying(255),
    sign_in_name character varying(255),
    email character varying(255),
    display_name character varying(255),
    pending_email character varying(255),
    linked_at timestamp with time zone DEFAULT now() CONSTRAINT user_identity_linked_at_not_null NOT NULL,
    linked_by character varying(140) CONSTRAINT user_identity_linked_by_not_null NOT NULL,
    last_used_at timestamp with time zone,
    ended_at timestamp with time zone,
    ended_reason text,
    invitation_sent_at timestamp with time zone,
    hosted_domain character varying(255),
    CONSTRAINT sign_in_identity_ended_reason CHECK ((((ended_at IS NULL) = (ended_reason IS NULL)) AND ((ended_reason IS NULL) OR (ended_reason = ANY (ARRAY['left'::text, 'moved'::text, 'unlinked'::text]))))),
    CONSTRAINT sign_in_identity_subject_or_pending CHECK (((subject IS NULL) = (pending_email IS NOT NULL)))
);


--
-- Name: sign_in_method; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.sign_in_method (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    kind text,
    label character varying(140),
    enabled boolean,
    new_person text,
    allowed_email_domains character varying(140),
    self_link boolean,
    client_id character varying(140),
    service_url text,
    settings jsonb,
    identifier_system character varying(140)
);


--
-- Name: single_value; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.single_value (
    table_name character varying(140) NOT NULL,
    field character varying(140) NOT NULL,
    value text
);


--
-- Name: sla_priority; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.sla_priority (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    parent character varying(140),
    parenttype character varying(140),
    parentfield character varying(140),
    priority character varying(140),
    response_hours double precision,
    resolution_hours double precision
);


--
-- Name: table_def; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.table_def (
    name text NOT NULL,
    module text DEFAULT 'Core'::text NOT NULL,
    kind text DEFAULT 'table'::text NOT NULL,
    is_submittable boolean DEFAULT false NOT NULL,
    id_pattern text DEFAULT 'hash'::text NOT NULL,
    title_column text,
    sort_column text DEFAULT 'updated_at'::text NOT NULL,
    sort_order text DEFAULT 'desc'::text NOT NULL,
    track_changes boolean DEFAULT true NOT NULL,
    description text,
    custom boolean DEFAULT false NOT NULL,
    system boolean DEFAULT false NOT NULL,
    created_by text DEFAULT 'Administrator'::text NOT NULL,
    updated_by text DEFAULT 'Administrator'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    data_source character varying(140),
    external_schema text,
    external_table text,
    external_pk text,
    external_modified text,
    label text,
    owner_app text,
    physical_schema text,
    physical_relation text,
    system_written boolean DEFAULT false NOT NULL,
    decides_scope boolean DEFAULT false NOT NULL,
    CONSTRAINT app_storage_complete CHECK ((((owner_app IS NULL) AND (physical_schema IS NULL) AND (physical_relation IS NULL)) OR ((owner_app IS NOT NULL) AND (physical_schema IS NOT NULL) AND (physical_relation IS NOT NULL))))
);


--
-- Name: tag_link; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.tag_link (
    ref_table character varying(140) CONSTRAINT tag_link_ref_doctype_not_null NOT NULL,
    ref_name character varying(140) NOT NULL,
    tag character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying CONSTRAINT tag_link_owner_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT tag_link_creation_not_null NOT NULL
);


--
-- Name: todo; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.todo (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    allocated_to character varying(140),
    ref_table character varying(140),
    reference_name character varying(140),
    description text,
    todo_status text,
    priority text
);


--
-- Name: translation; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.translation (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    language character varying(140),
    source_text character varying(140),
    translated_text text
);


--
-- Name: user_event; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.user_event (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    kind text,
    ref_key text,
    label text,
    sub_label text,
    path text,
    occurred_at timestamp with time zone
);


--
-- Name: user_settings; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.user_settings (
    "user" character varying(140) NOT NULL,
    table_name character varying(140) CONSTRAINT user_settings_doctype_not_null NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() CONSTRAINT user_settings_modified_not_null NOT NULL
);


--
-- Name: version; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.version (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    ref_table character varying(140),
    ref_name character varying(140),
    data jsonb
);


--
-- Name: web_form; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.web_form (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    title character varying(140),
    route character varying(140),
    ref_table character varying(140),
    web_fields jsonb,
    published boolean,
    success_message character varying(140)
);


--
-- Name: web_page; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.web_page (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    title character varying(140),
    route character varying(140),
    content text,
    published boolean
);


--
-- Name: webhook; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.webhook (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    webhook_table character varying(140),
    webhook_event text,
    request_url character varying(140),
    webhook_secret character varying(140),
    enabled boolean
);


--
-- Name: workflow; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.workflow (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    ref_table character varying(140),
    is_active boolean,
    state_field character varying(140)
);


--
-- Name: workflow_action; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.workflow_action (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    ref_table character varying(140),
    ref_name character varying(140),
    action character varying(140),
    from_state character varying(140),
    to_state character varying(140),
    actor character varying(140)
);


--
-- Name: workflow_document_state; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.workflow_document_state (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    parent character varying(140),
    parenttype character varying(140),
    parentfield character varying(140),
    state character varying(140),
    target_status text,
    waits_for_approval boolean DEFAULT false NOT NULL
);


--
-- Name: workflow_transition; Type: TABLE; Schema: featherbase; Owner: -
--

CREATE TABLE featherbase.workflow_transition (
    row_id character varying(140) NOT NULL,
    created_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(140) DEFAULT 'Administrator'::character varying NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    parent character varying(140),
    parenttype character varying(140),
    parentfield character varying(140),
    state character varying(140),
    action character varying(140),
    next_state character varying(140),
    allowed character varying(140),
    condition text
);


--
-- Name: site; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site (
    name text NOT NULL,
    host text NOT NULL,
    schema text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: health_check_event id; Type: DEFAULT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.health_check_event ALTER COLUMN id SET DEFAULT nextval('featherbase.health_check_event_id_seq'::regclass);


--
-- Name: SCHEMA featherbase; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA featherbase TO PUBLIC;


--
-- Data for Name: column_def; Type: TABLE DATA; Schema: featherbase
--

INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('02a21391-a240-48e4-884f-a5a43c580368', 'Column', '11', 'hidden', 'Hidden', 'Check', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('02b6f112-5155-489b-ad9d-ae02f2a65871', 'Email Sink', '1', 'mail_from', 'mail_from', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('03878846-5e7d-45cc-9ff0-79bc30e22ae9', 'Table', '1', 'module', 'Module', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('045810d7-bde1-44a4-8792-c72ef1d94d63', 'Home Page Link', '1', 'label', 'label', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('060275cf-dee7-4914-8f06-6f4fcf24efd1', 'Background Job', '7', 'error', 'error', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('06610855-410e-464d-86ad-c995b8258ec8', 'Job Execution', '4', 'outcome', 'outcome', 'Choice', NULL, 'success
error
refused', NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('0682f26d-ca7e-405f-8b4c-21918bf6ec5a', 'Permission', '7', 'can_create', 'can_create', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('09541e71-9efe-410d-b46a-3037dabec98b', 'Glossary Term', '4', 'examples', 'Examples', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, 'One example per line');
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('0b54248e-279d-46c0-9d57-4c531661b85d', 'Email Sink', '6', 'attachment_b64', 'attachment_b64', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('0b99fe1a-1393-439f-b61b-59bf0dffedf2', 'Assignment Rule', '4', 'assign_to_field', 'Assign To Field', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('0ba6ec40-a0e5-4594-8259-d569e43bc12c', 'Glossary Link', '1', 'link_table', 'Table', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('0ca08087-9592-4acd-a4ef-91714404ab16', 'Client Script', '1', 'ref_table', 'ref_table', 'Reference', 'Table', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('10631bed-d1c8-4848-aa83-7c6ebea30406', 'Saved View', '4', 'shared', 'shared', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('108fef6f-852b-4a5f-a24e-7d3daf7ce013', 'Workflow Action', '2', 'ref_name', 'ref_name', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('10ce8d9a-fad0-4a0d-a30f-cdf131d430eb', 'Service Level Agreement', '1', 'ref_table', 'ref_table', 'Reference', 'Table', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('10e326b2-e3fc-4bd2-8225-165b25f76ec0', 'Custom Field', '8', 'reqd', 'reqd', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('114ca790-b93e-4c69-87bd-3aec28ac34b2', 'Identifier System', '4', 'match', 'match', 'Choice', NULL, 'Off
Suggest', NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('11d28bed-a881-48e1-a52f-36c53df8ea77', 'User Event', '6', 'occurred_at', 'occurred_at', 'Datetime', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('11d5b701-a65e-4292-b347-37e631390788', 'Home Page', '1', 'label', 'label', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('132a02d5-e035-4bb1-aec8-060e820d9020', 'ToDo', '2', 'ref_table', 'ref_table', 'Reference', 'Table', NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('1475f8a7-0142-4822-b54e-91802fda4018', 'Translation', '1', 'language', 'language', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('1b381c22-fa50-4829-a3b1-b977dcf78fd0', 'Email Account', '2', 'smtp_host', 'smtp_host', 'Data', NULL, NULL, NULL, 'false', 'false', 'localhost', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('1bcec272-8523-43b7-b7fe-2b9ef0c40eba', 'Person', '15', 'replaced_by', 'Replaced by', 'Reference', 'Person', NULL, NULL, 'false', 'false', NULL, 'true', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('1c1958a0-ee8d-4212-a88d-73b1330482f6', 'Comment', '2', 'ref_name', 'ref_name', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('1e075ecd-dd81-4a08-b6eb-e12b828f3cfc', 'Share', '1', 'share_table', 'share_table', 'Reference', 'Table', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('1e17a542-f42a-4e37-9fac-4cb31f503986', 'User Event', '4', 'sub_label', 'sub_label', 'Long Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('1e61bbf6-2849-415a-a8c9-6855cd9e7330', 'File', '6', 'ref_table', 'ref_table', 'Reference', 'Table', NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('1f76fd80-3909-4824-a92d-edac14651cc6', 'Sign In Method', '10', 'identifier_system', 'Identifier system', 'Reference', 'Identifier System', NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('1fed9855-53f5-40fa-a20b-09cd30194706', 'Glossary Term', '3', 'definition', 'Definition', 'Text', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('1ffee0a2-cc38-4fc8-9395-a4904e1c9c0c', 'Email Queue', '5', 'send_status', 'send_status', 'Choice', NULL, 'queued
sent
error', NULL, 'false', 'false', 'queued', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('201f8901-0363-44cb-bfa5-c442c1d440ce', 'Sign In Method', '2', 'label', 'label', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('202937c5-0e2a-4ed6-8228-12a98c3d0b05', 'Version', '2', 'ref_name', 'ref_name', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('20fc4036-0d3b-43ce-b404-1b41217e2ec3', 'Table', '8', 'system', 'System', 'Check', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('214553bf-942f-4e61-9522-bb581fb2cd25', 'Identifier System', '9', 'one_per_person', 'One per person', 'Check', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('235eb70e-0cb2-453e-9464-a41c389f4acd', 'Custom Field', '5', 'reference_table', 'reference_table', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('23c242db-3b29-430d-8beb-a103bf27faae', 'Glossary Link', '2', 'link_column', 'Column', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('24e4b1c1-f7e8-47f9-99dd-4412f75fd293', 'Email Sink', '3', 'subject', 'subject', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('251a1ffb-865b-4a92-b0e7-f46e9c7b2f41', 'Column', '12', 'in_list_view', 'In List View', 'Check', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('253b5d66-32b1-4da1-9e38-bf76d972ea53', 'File', '1', 'file_name', 'file_name', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('2586796c-bce9-41d3-ab32-d91ad3103dd7', 'Permission', '5', 'can_read', 'can_read', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('25f94ffe-17b1-4fe3-af60-435f8bf7c96a', 'Access Log', '4', 'reference_name', 'reference_name', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('2670ec03-a45a-4ff2-91fb-88e13e6a5b5f', 'Share', '2', 'share_name', 'share_name', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('26d9ab46-c3ce-479b-ab68-717141fffc66', 'Email Queue', '8', 'reference_name', 'reference_name', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('271115a6-96f1-42d9-a2ab-abf2378cce42', 'Import Conflict', '9', 'closed', 'closed', 'Check', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('279e567e-979b-4bf9-87df-c6d3986d71f7', 'File', '7', 'ref_name', 'ref_name', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('28aa3fad-6eb7-4836-a2c5-7e9dc38350db', 'Share', '4', 'read', 'read', 'Check', NULL, NULL, NULL, 'false', 'false', '1', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('28fdc846-fc7c-4c36-9d76-be0b11f84028', 'Print Format', '3', 'template', 'template', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('29085548-66c4-44a5-a068-727418caef55', 'Email Queue', '2', 'recipient', 'recipient', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('29f02d34-e3cc-49b5-8fd0-073bee50bd48', 'Server Script', '4', 'api_method', 'api_method', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('2a2ec8fa-d741-411d-be1d-67c983a04525', 'Job Execution', '1', 'job', 'job', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('2a53fde5-9daa-4991-bb15-d0386ef95288', 'Data Source', '2', 'url_env', 'Connection Env Var', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('2a6010bd-505b-46b5-bd0a-4799ab17e255', 'Glossary Term', '2', 'app', 'App', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'true', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('2a90eb56-0f67-4d6c-a4bf-a27568222f41', 'Activity Log', '1', 'user', 'user', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('2d3f902b-ede3-4471-9d67-7d89e31c20b6', 'Job Execution', '5', 'error', 'error', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('2d5618be-2150-45e0-97f1-ce352e7a7894', 'Report', '1', 'ref_table', 'ref_table', 'Reference', 'Table', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('2d62fc3d-1c3b-4cf2-bfd8-409d2e8f846c', 'Import Conflict', '4', 'kept', 'kept', 'JSON', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('2f3a13b2-d2c9-484b-869e-679a3d1ddad7', 'System Settings', '8', 'float_precision', 'Float Precision', 'Int', NULL, NULL, NULL, 'false', 'false', '2', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('2fdcf8f6-ca95-4678-a10a-f6c59d382640', 'Dataset Snapshot', '2', 'state', 'state', 'Choice', NULL, 'building
active
superseded
failed', NULL, 'true', 'false', 'building', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('300c5e12-970f-4169-b2b8-55346a42ebed', 'Web Form', '2', 'route', 'route', 'Data', NULL, NULL, NULL, 'true', 'true', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('300fe495-bbf1-45ce-8c3f-4ebb74a339e2', 'Activity Log', '6', 'test_mode', 'Test Mode', 'Check', NULL, NULL, NULL, 'false', 'false', NULL, 'true', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('302cbcc4-eaba-4324-9110-b40f23a67d37', 'Data Source', '9', 'conn_status', 'Connection Status', 'Choice', NULL, 'untested
ok
error', NULL, 'false', 'false', 'untested', 'true', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('30faf63c-2f1b-4a04-856a-39e7e8194905', 'Web Form', '5', 'published', 'published', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('310aa419-501d-472a-81be-ccd848a5e1a9', 'File', '4', 'file_size', 'file_size', 'Int', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('31a4689f-465f-4590-9e55-40af7ddb2f6a', 'Activity Log', '3', 'full_name', 'full_name', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('31d365d1-0c7d-44c5-969c-8baa63e97651', 'Column', '5', 'choices', 'Choices', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('329e6eb7-b29b-4857-b36a-c6423281d954', 'SLA Priority', '1', 'priority', 'priority', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('32f58c9c-913d-4fc0-9ef4-78741c6a9319', 'User Event', '2', 'ref_key', 'ref_key', 'Long Text', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('3345ad9d-c2a2-483a-b770-0c4c89c9ddf3', 'Person', '1', 'email', 'email', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('33585144-7cc8-4d93-9526-018b5b007f11', 'Report', '5', 'report_script', 'Report Script', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('3369a4b5-9ddf-4198-9044-e639f582c35b', 'Background Job', '9', 'trigger', 'Trigger', 'Choice', NULL, 'schedule
demand
manual
retry', NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('3389cc2d-40f3-4741-a6d1-8df1f8a822cf', 'Has Role', '1', 'role', 'role', 'Reference', 'Role', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('3602586f-83c0-4a1d-a550-6423fc0ec9f4', 'Auto Email Report', '6', 'last_sent', 'last_sent', 'Datetime', NULL, NULL, NULL, 'false', 'false', NULL, 'true', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('383b4ffe-f2ec-4537-82cc-dad3541c0ffd', 'Import Log', '13', 'run_id', 'run_id', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('389cce75-450f-4866-9d7e-ba4e641e1378', 'Report', '3', 'report_type', 'Report Type', 'Choice', NULL, 'Report Builder
Script Report', NULL, 'false', 'false', 'Report Builder', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('3a694c73-c23d-436f-afae-7d0c0c4ada92', 'Access Log', '1', 'user', 'user', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('3a878af0-5184-4e8c-8315-bbe4563410ec', 'Assignment Rule User', '1', 'user', 'user', 'Reference', 'Person', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('3a9f96a7-a8de-421c-a00c-962e93666b7f', 'Notification Log', '5', 'read', 'read', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('3abee727-a208-40f2-bd1b-e1a51365b7cd', 'System Settings', '7', 'currency_precision', 'Currency Precision', 'Int', NULL, NULL, NULL, 'false', 'false', '2', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('3b81288b-1f39-443f-a3e9-f5fc06ea5972', 'Workflow', '4', 'transitions', 'transitions', 'Sub-table', NULL, NULL, 'Workflow Transition', 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('3cd7d222-0b87-4621-9e12-1aebc068ff1a', 'Email Queue', '7', 'ref_table', 'ref_table', 'Reference', 'Table', NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('3d1f55f5-dd9b-4628-8408-90c126d08d82', 'Import Log', '8', 'error_summary', 'error_summary', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('3df315ea-6c52-415f-89a9-28316a961af8', 'Access Log', '6', 'scope', 'Scope', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('3e8601cb-382e-4259-ad82-e35752d195d6', 'Web Page', '3', 'content', 'content', 'Long Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('3eef90f3-9b32-48a2-b282-dabd4ec14e7d', 'Import Log', '6', 'updated', 'updated', 'Int', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('3f2055d4-d31a-4731-9de6-2bfb3295dc7c', 'App Setting', '1', 'app', 'App', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'true', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('40149281-e271-4a22-948c-013f16cc035e', 'Identifier System', '13', 'enabled', 'enabled', 'Check', NULL, NULL, NULL, 'false', 'false', '1', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('41247bbf-e0af-4a7f-934b-e12cb24edad7', 'Access Log', '3', 'ref_table', 'ref_table', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('4136916e-b706-4d74-b810-b63f9073938d', 'Dataset Snapshot', '6', 'activated_at', 'activated_at', 'Datetime', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('41f3f0d5-e679-41bd-bed1-f3116ab787e5', 'Workflow Document State', '3', 'waits_for_approval', 'Waits for approval', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('4207422d-5a07-4f17-b939-d12dee7fe03a', 'Import Log', '5', 'inserted', 'inserted', 'Int', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('425e28ff-3186-4545-9eb5-81772532dcc3', 'Background Job', '2', 'payload', 'payload', 'JSON', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('42e192d7-2edd-4048-80f5-7dec2a7f390e', 'Workflow Action', '5', 'to_state', 'to_state', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('43aedb6a-2b41-4e98-bf0e-33ab85fa45b9', 'Assignment Rule', '5', 'disabled', 'disabled', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('43f9db19-36d8-466d-aa9b-6ce5f830fa3a', 'Background Job', '1', 'method', 'method', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('43fadcb3-c13e-4062-b9af-bdab7e040d54', 'Scheduled Job', '2', 'cadence', 'cadence', 'Choice', NULL, 'every minute
every 15 minutes
hourly
every 4 hours
daily', NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('44df74f3-182b-425c-9486-22f38d1432b6', 'ToDo', '1', 'allocated_to', 'allocated_to', 'Reference', 'Person', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('45562e73-d439-4f40-9ef5-92fe87cf1bcd', 'Print Format', '4', 'letter_head', 'letter_head', 'Reference', 'Letter Head', NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('45acf375-e87e-4151-a24c-1c995880826c', 'Data Source', '5', 'access', 'Access', 'Choice', NULL, 'read_only
read_write', NULL, 'true', 'false', 'read_only', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('46270844-aac4-4b66-b840-222964e3ef24', 'ToDo', '5', 'todo_status', 'todo_status', 'Choice', NULL, 'Open
Closed', NULL, 'false', 'false', 'Open', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('469304d4-56ba-4549-a0cb-a61812d69538', 'Dataset Snapshot', '7', 'row_count', 'row_count', 'Int', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('471dacc8-b799-485d-b334-2f93d26bd813', 'Data Source', '6', 'pool_max', 'Pool Max', 'Int', NULL, NULL, NULL, 'false', 'false', '5', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('48875725-e1e7-4397-bc18-46e5c30daeca', 'Dataset Snapshot', '11', 'triggered_by', 'triggered_by', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('48d17c6c-2122-4276-b5eb-915b23a11b75', 'Background Job', '8', 'repeat_every', 'repeat_every', 'Int', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('4a4f8fc2-2849-46eb-accf-d3c7ed36aea9', 'Client Script', '2', 'script', 'script', 'Long Text', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('4a52ce61-a5e7-4822-b3ac-82568b7b7fea', 'Import Log', '7', 'failed', 'failed', 'Int', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('4b23e1e5-45ce-4ff1-a92a-8e6047c36136', 'Access Log', '5', 'method', 'method', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('4c153ecd-c96d-498e-8330-7a89f0b4e383', 'Data Scope', '2', 'allow_table', 'allow', 'Reference', 'Table', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('4cc071c2-3ff5-447b-b5de-c71b8f8fffc2', 'Import Source', '4', 'run_id', 'run_id', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('4d67acae-0186-469d-898e-1b356358d6e1', 'Data Source', '11', 'last_error', 'Last Error', 'Long Text', NULL, NULL, NULL, 'false', 'false', NULL, 'true', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('4daa1f72-aaa6-497e-af24-4fab345179e4', 'Service Level Agreement', '2', 'enabled', 'enabled', 'Check', NULL, NULL, NULL, 'false', 'false', '1', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('4ea5a271-d993-4a83-9962-ca10bb966dc0', 'User Event', '3', 'label', 'label', 'Long Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('4ebd8f0d-b073-441f-b29d-582092eda2a4', 'Metadata Override', '4', 'value', 'value', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('4f49a053-600f-4de9-a28a-881fe3421880', 'System Settings', '5', 'allow_signup', 'allow_signup', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('4f61cd15-d2ce-47a7-83ea-3eae38f478e0', 'Data Source', '10', 'last_checked_at', 'Last Checked At', 'Datetime', NULL, NULL, NULL, 'false', 'false', NULL, 'true', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('5088db90-9ce4-456d-b0ed-0e6f447905fb', 'System Settings', '4', 'session_hours', 'session_hours', 'Int', NULL, NULL, NULL, 'false', 'false', '8', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('50bd75a8-b82d-4311-9070-c24526c6ef9d', 'Import Conflict', '6', 'editor', 'editor', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('51443b27-00a1-44a2-8976-9dd404db21b5', 'Glossary Term', '7', 'app_key', 'App term', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'true', 'true', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('5189d06d-9593-4065-9169-603ddedf8968', 'Person', '4', 'enabled', 'enabled', 'Check', NULL, NULL, NULL, 'false', 'false', '1', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('53efb903-6326-41c7-ac2c-b7b3a00b7e18', 'Access Log', '2', 'operation', 'operation', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('54fc9746-27a3-4f63-8ce0-310666246659', 'Email Account', '4', 'is_default', 'is_default', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('55e58afb-2a8a-4a31-b068-c7169795d8f9', 'Home Page', '2', 'icon', 'icon', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('5654915b-da22-42e9-b181-4fa4bc1ebac3', 'System Settings', '6', 'currency', 'Default Currency', 'Choice', NULL, 'USD
EUR
GBP
INR
JPY', NULL, 'false', 'false', 'INR', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('5684fc7c-4ab6-4454-b45c-212ec15135a7', 'Person', '3', 'full_name', 'full_name', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('59c93ffb-eced-43f5-a069-e3a641156651', 'Report', '2', 'config', 'config', 'JSON', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('5a20abbd-7f1d-4003-8f2a-af7a9ecccbd7', 'Sign In Method', '5', 'allowed_email_domains', 'allowed_email_domains', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('5ab436a8-e695-4887-93fa-239c6a6b6702', 'Glossary Term', '9', 'app_wording_changed', 'App wording changed', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'true', 'true', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('5c9bb55c-ac9e-4bb2-b999-633ddb1513f7', 'Import Conflict', '2', 'ref_name', 'ref_name', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('5ccb23c2-36a8-422d-ae1c-8600cab60fb9', 'Sign In Method', '4', 'new_person', 'new_person', 'Choice', NULL, 'refuse
create_if_email_domain_allowed
create', NULL, 'false', 'false', 'refuse', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('5dab43bf-9034-4ed9-8153-f43686198931', 'Email Queue', '3', 'subject', 'subject', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('5eb48f2b-73c2-4232-b9fe-e4434a77c90a', 'App Setting', '2', 'setting', 'Setting', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'true', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('5f063ebc-abc0-401b-ae7b-92726c2b9e88', 'Identifier System', '16', 'tier', 'tier', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'true', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('5f32848d-4df4-4e71-a539-3e228de8a7a6', 'Permission', '6', 'can_write', 'can_write', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('5f9cfb62-effa-4ce7-bc19-eaa7a3481927', 'Identifier System', '6', 'advanced', 'Advanced', 'Section Break', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('608b9fb7-d18c-4af7-94d4-01dd4fce00b8', 'ToDo', '6', 'priority', 'priority', 'Choice', NULL, 'Low
Medium
High', NULL, 'false', 'false', 'Medium', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('6208463f-3665-44ad-a0f2-057c674f3086', 'Data Scope', '4', 'person', 'Person', 'Reference', 'Person', NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('6317a003-9210-42b1-9e30-cff9efcf9b79', 'Workflow Action', '6', 'actor', 'actor', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('64236b44-58d5-48d6-a959-08850d9718b6', 'Webhook', '5', 'enabled', 'enabled', 'Check', NULL, NULL, NULL, 'false', 'false', '1', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('649665fd-272e-4bd2-96bb-2694f59647d3', 'Import Log', '1', 'ref_table', 'ref_table', 'Reference', 'Table', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('651b4f9a-28f3-4330-bf16-05efda1d0aa5', 'Webhook', '2', 'webhook_event', 'webhook_event', 'Choice', NULL, 'after_insert
on_update
on_submit
on_cancel', NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('65402422-da30-4c13-aded-640c7d90e952', 'Import Log', '9', 'key_column', 'key_column', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('654fb745-8fde-4942-afe5-638da9cecf2a', 'Server Script', '1', 'script_type', 'script_type', 'Choice', NULL, 'Document Event
API', NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('65b55447-56a1-4a78-ba7e-e6a19ebed7df', 'Share', '5', 'write', 'write', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('6690cc8a-c5c8-44ff-8aa5-3c1b520885fe', 'Table', '5', 'title_column', 'Title Column', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('66d7c95d-4102-4442-92ef-93305f320c69', 'ToDo', '3', 'reference_name', 'reference_name', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('670fde66-4c00-4107-bb2b-86806eda3f4a', 'Translation', '2', 'source_text', 'source_text', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('67c162ff-26b0-461e-9452-8391a4af9293', 'Column', '8', 'unique', 'Unique', 'Check', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('67c6d602-3ddd-4422-81ff-5c46b3e5f0d9', 'Service Level Agreement', '6', 'priorities', 'priorities', 'Sub-table', NULL, NULL, 'SLA Priority', 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('6a7803f7-4552-4f13-ad1b-05f54c3fca93', 'Metadata Override', '2', 'column_name', 'field_name', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('6ad75a2e-e3f3-4205-819c-a65104449afc', 'Table', '10', 'decides_scope', 'Decides people''s scope', 'Check', NULL, NULL, NULL, 'false', 'false', NULL, 'true', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('6ae60690-a24f-4312-b3b1-5b0e02e128ec', 'Glossary Term', '1', 'term', 'Term', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('6afa1aa8-b91c-4347-b14d-20423b915bb8', 'Glossary Term', '6', 'describes', 'Describes', 'Sub-table', NULL, NULL, 'Glossary Link', 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('6d109a4d-30b5-4a41-b44e-5a26fb52210d', 'Job Execution', '8', 'result', 'Result', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'true', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('6d9f414e-188f-4d5c-b4a3-15b004356200', 'Letter Head', '2', 'header_html', 'header_html', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('6dc2f7b1-dc3c-43ff-a572-fcc4ad2a9b03', 'User Event', '1', 'kind', 'kind', 'Choice', NULL, 'row
list
page
search', NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('6df545e5-f474-41c7-87fb-695f0dd1aa96', 'Web Page', '2', 'route', 'route', 'Data', NULL, NULL, NULL, 'true', 'true', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('6e51abb7-374c-4ba0-bec4-93ca4c29d31d', 'Scheduled Job', '1', 'method', 'method', 'Data', NULL, NULL, NULL, 'true', 'true', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('703ff270-a04f-4261-a692-7d47375528e2', 'Service Level Agreement', '5', 'escalation_role', 'escalation_role', 'Reference', 'Role', NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('70981ec5-29e1-48da-ad0f-584be3fca4c4', 'Letter Head', '1', 'is_default', 'is_default', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('70c35eeb-b0fc-48cc-a414-34b4f95bb419', 'Workflow Transition', '5', 'condition', 'Condition', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('716ea0e5-e969-497a-8219-6cf282cfac27', 'Server Script', '5', 'script', 'script', 'Long Text', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('7171b045-831e-4dce-87a4-b1779f4a6717', 'Glossary Avoid Word', '1', 'word', 'Word', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('72050389-7591-49ba-999d-9a5afc194ed3', 'Import Log', '15', 'touched', 'touched', 'JSON', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'true', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('7239dde4-de40-43a8-b77a-4bc7a4ec7dec', 'Webhook', '4', 'webhook_secret', 'webhook_secret', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('728ade75-5dc6-496e-8618-a68b6cf0590a', 'Web Form', '3', 'ref_table', 'ref_table', 'Reference', 'Table', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('7299bdeb-ebfd-41a5-aae4-d79e074ce55e', 'Import Conflict', '1', 'ref_table', 'ref_table', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('7321b44b-434d-4bee-995b-bddf72a42fe0', 'Web Page', '4', 'published', 'published', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('7494b96f-e147-445e-b38e-b6e7fe32f941', 'Version', '1', 'ref_table', 'ref_table', 'Reference', 'Table', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('74f50bf9-d8dd-4ebb-ba09-d0192edacbd0', 'Dataset Snapshot', '8', 'bytes', 'Bytes on disk', 'Int', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('7516ef06-8d6d-40e5-9788-9dafa1b0c3a5', 'Email Rule', '7', 'message', 'message', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('766d4923-502b-441d-96a0-72c01150a82d', 'Import Conflict', '8', 'run_id', 'run_id', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('76e12307-0f42-4579-9aa0-154482f32ca2', 'Dashboard', '2', 'config', 'config', 'JSON', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('76f9b6ee-e47a-4892-8dc8-85fa0019b9e7', 'Identifier System', '8', 'one_holder_at_a_time', 'One holder at a time', 'Check', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('778f3113-1eee-4c2e-99fb-0d72eb9e40c7', 'Server Script', '2', 'ref_table', 'ref_table', 'Reference', 'Table', NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('790790ed-6a0c-4256-a466-6c43b911e49b', 'Workflow', '2', 'is_active', 'is_active', 'Check', NULL, NULL, NULL, 'false', 'false', '1', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('79f12551-56df-4116-b2c3-39f956fe0fa5', 'App Setting', '3', 'value', 'Value', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('79f35786-55b3-4397-9f22-62731d2aa09e', 'Job Execution', '7', 'duration_ms', 'Duration (ms)', 'Int', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('7a3f5a18-f94e-4817-a020-ef7edcffda58', 'Column', '6', 'row_table', 'Row Table', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('7b6c543d-c6e7-4d7c-8d92-94ad9a4b7c6a', 'Sign In Method', '7', 'client_id', 'client_id', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('7c20ab81-7784-4061-af74-dfb12297b21c', 'System Settings', '9', 'people_review', 'People review', 'JSON', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('7cc83feb-b91d-497b-a44b-d16e1ac7ae0e', 'Workflow Document State', '1', 'state', 'state', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('7d5a6c98-915d-4c29-a942-67e960e881c1', 'Dataset Miss', '3', 'last_seen', 'last_seen', 'Datetime', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('7d5d422f-7ac6-495b-95cf-0c70989330d3', 'Person', '10', 'theme', 'Theme', 'Choice', NULL, 'light
dark
device', NULL, 'false', 'false', 'device', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('7e27e4ce-ef4e-42e1-9291-b6e3c6d98f51', 'Sign In Method', '6', 'self_link', 'self_link', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('7f4213ab-e59f-4eed-abfd-aed24e1ab8cf', 'Import Source', '2', 'ref_name', 'ref_name', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('7f502678-346c-488e-be6b-04c100b0d1af', 'Identifier System', '12', 'retain_after_leaving_days', 'retain_after_leaving_days', 'Int', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('803c911f-5e19-48c1-a434-0342351d0f14', 'Column', '9', 'default_value', 'Default', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('82474fd4-80bc-46c3-9713-edd0ad24110f', 'Metadata Override', '3', 'property', 'property', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('82da22ef-49f5-4e21-8492-e753b995aafd', 'Scheduled Job', '8', 'last_duration_ms', 'last_duration_ms', 'Int', NULL, NULL, NULL, 'false', 'false', NULL, 'true', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('82eec5ed-529d-4252-b256-4864aa51e7fd', 'Import Log', '3', 'sheet_name', 'sheet_name', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('830cb5fb-2f42-4fa4-a8a2-3dd163ae2a9d', 'File', '8', 'thumbnail_url', 'Thumbnail', 'Long Text', NULL, NULL, NULL, 'false', 'false', NULL, 'true', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('83b46fa4-5194-4675-9553-c586def37493', 'Server Script', '3', 'event', 'event', 'Choice', NULL, 'validate
before_save
after_save', NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('83fc02dd-b5c2-426b-96c5-547b4830658d', 'Workflow Transition', '2', 'action', 'action', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('8454af98-7b12-491d-9324-96460270df84', 'Permission', '8', 'can_delete', 'can_delete', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('853726cc-628d-447c-a914-449c54ddf5da', 'Custom Field', '2', 'column_name', 'column_name', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('860e6fde-f070-4c36-80ed-69a0040bf0a5', 'Glossary Term', '5', 'avoid', 'Words to avoid', 'Sub-table', NULL, NULL, 'Glossary Avoid Word', 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('87871682-d653-4be8-9722-994afb5e6237', 'Data Source', '1', 'engine', 'Engine', 'Choice', NULL, 'postgres
mysql
duckdb
csv-folder', NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('87b567d2-a1fd-4dba-b8b8-dbb2e2cfc5e6', 'Auto Email Report', '5', 'enabled', 'enabled', 'Check', NULL, NULL, NULL, 'false', 'false', '1', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('88270811-1a9f-4f01-8b3f-00948ce87274', 'Background Job', '4', 'attempts', 'attempts', 'Int', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('88553dd9-2c2a-4014-893f-d110c0697f6c', 'Web Form', '1', 'title', 'title', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('8982fb15-2e41-4a34-9e72-e51bb12c131c', 'System Settings', '1', 'app_name', 'app_name', 'Data', NULL, NULL, NULL, 'false', 'false', 'Featherbase', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('89b94f11-e3cb-4a51-85fe-255c405c8a2d', 'Comment', '1', 'ref_table', 'ref_table', 'Reference', 'Table', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('8a7b5303-3bd5-4783-9b42-e8a911aa6bd2', 'Saved View', '1', 'ref_table', 'ref_table', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('8bfdf6db-1e98-487b-a82c-6529bc6b86a3', 'Web Form', '4', 'web_fields', 'web_fields', 'JSON', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('8c6caccb-4ed6-4859-9b91-08a43202821c', 'Person', '2', 'expects_google_sign_in', 'Expects Google sign-in', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, 'They can sign in with Google using this email the first time; after that the link is permanent.');
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('8d05f15d-d5b1-4a32-9d50-371fa56322e5', 'Import Conflict', '5', 'incoming', 'incoming', 'JSON', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('8d6144c2-7f5f-4efe-9d7d-58c3a1f0a025', 'Dataset Snapshot', '1', 'dataset', 'dataset', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('8e2d44d6-b0b5-427e-a575-1212706c61c9', 'Dataset Miss', '2', 'first_seen', 'first_seen', 'Datetime', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('8e82d2cb-f2ea-415e-a2e9-0fc70f0ad5cd', 'Share', '6', 'share', 'share', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('8ec56e7f-a4db-4e1a-ad3f-acfbec4bf43b', 'Identifier System', '3', 'source', 'source', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('8f4f6a9d-d1a8-4aac-8442-568c0d14c8c4', 'Activity Log', '2', 'operation', 'operation', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('8f89088c-b22d-4fe4-a902-34e21f69923b', 'Dataset Miss', '1', 'dataset', 'dataset', 'Data', NULL, NULL, NULL, 'true', 'true', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('8f9fdd0a-31ff-4b85-8550-bd0c9107458f', 'Sign In Method', '1', 'kind', 'kind', 'Choice', NULL, 'password
google
delegated_password', NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('8fcd095c-13b1-4e69-85db-b6cd51ff8587', 'Custom Field', '3', 'label', 'label', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('909f71f4-7c90-4122-837d-72db85cd000c', 'Email Rule', '2', 'event', 'event', 'Choice', NULL, 'on_create
on_save
on_submit
on_cancel', NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('90bc8fc7-cfbe-4b61-9ff0-b1d534da1add', 'Home Page', '4', 'sequence', 'sequence', 'Int', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('928e5fb8-b24e-4f4b-adb7-b9df1694e0f4', 'Table', '6', 'description', 'Description', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('931aad92-996a-4543-a348-009f4ddbff74', 'Dataset Miss', '4', 'hits', 'hits', 'Int', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('93fffcfe-75b5-408c-ba8d-df4d04cab189', 'SLA Priority', '2', 'response_hours', 'response_hours', 'Float', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('9582f50d-4ee7-4f11-8765-d504c5ef3304', 'Import Source', '1', 'ref_table', 'ref_table', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('95f92c61-7bc1-46ec-8360-8bf763f7e207', 'ToDo', '4', 'description', 'description', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('96c0cffe-bf65-4ebc-9bca-0a0b6b9d4787', 'Person', '5', 'password_hash', 'password_hash', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'true', 'true', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('98308d0f-1ecd-4f09-9146-2e5913d53fe5', 'Permission', '10', 'can_cancel', 'can_cancel', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('99939e4b-462d-4dc5-b15e-885148311c05', 'Activity Log', '5', 'sign_in_method', 'Sign-in Method', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'true', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('99c0b475-46cc-4020-81d1-8948111cb909', 'Client Script', '3', 'enabled', 'enabled', 'Check', NULL, NULL, NULL, 'false', 'false', '1', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('99c6cce8-461a-4697-aea3-fa330cdb645b', 'App Role Binding', '2', 'app_role', 'App role', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('99d4f2a9-0414-4c43-87d3-038caf13cfa0', 'Email Queue', '9', 'attachments', 'attachments', 'JSON', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('9a678222-5942-44c7-a0c8-08e533350fda', 'Custom Field', '7', 'row_table', 'row_table', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('9b33cbd9-4d3a-4c99-991d-2ea424b13613', 'Permission', '3', 'tier', 'tier', 'Choice', NULL, 'basic
restricted', NULL, 'false', 'false', 'basic', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('9bfcb042-e771-42d9-b8cc-bb4c38f63f52', 'Table', '9', 'system_written', 'Written by the platform only', 'Check', NULL, NULL, NULL, 'false', 'false', NULL, 'true', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('9c583057-5e64-4d6d-9a24-eaf46377e43c', 'Dataset Snapshot', '4', 'source_as_of', 'source_as_of', 'Date', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('9c77f84c-c6b4-41ab-b0fb-461d316c897b', 'Home Page Link', '3', 'link_to', 'Link To', 'Reference', 'Table', NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('9ce3b36d-9608-4919-9f1d-13b8bcc0cca4', 'User Event', '5', 'path', 'path', 'Long Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('9cf0aa19-80a2-4a77-bd03-24c11d014df5', 'Table', '7', 'columns', 'Columns', 'Sub-table', NULL, NULL, 'Column', 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('9d66bc02-ba58-4892-9250-1430f381c294', 'File', '3', 'mime_type', 'mime_type', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('9d8f645e-c2d9-4084-8c64-e2710b74825a', 'Permission', '4', 'own_rows_only', 'own_rows_only', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('9d90e6f9-b52c-4e8f-bc6a-ad495584d967', 'Share', '8', 'service_account', 'Service account', 'Reference', 'Service Account', NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('9df10d13-bcf1-4e27-ba57-f6a5f012e5f1', 'Import Log', '10', 'empty_cells', 'empty_cells', 'Choice', NULL, 'keep
clear', NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('9dfb3a35-b61b-404b-9a26-74748b77ad85', 'Import Log', '16', 'reverted_at', 'reverted_at', 'Datetime', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('9ee3a3ea-bdee-4c96-981b-7a9aa7fcef31', 'Custom Field', '1', 'dt', 'dt', 'Reference', 'Table', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('9f6b9f40-efed-4a65-a0a2-01cd2cb84221', 'Column', '13', 'tier', 'Tier', 'Choice', NULL, 'basic
restricted', NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('9f8253f6-51a7-4d85-b438-c50d3fde496b', 'Assignment Rule', '6', 'last_user', 'last_user', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'true', 'true', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('9f9a9e78-65ca-4423-a4b6-0eded161d48c', 'Workflow Action', '3', 'action', 'action', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('9fdaa0ca-ba92-48d1-a2bd-6ff3d68a76ba', 'Home Page', '3', 'module', 'module', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('a036ba70-9c2e-4b0a-a247-efb15c17e592', 'Identifier System', '15', 'display', 'display', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'true', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('a195d18d-1ad6-450b-bdd0-188b3f524c8d', 'Import Source', '3', 'values', 'values', 'JSON', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('a23144f3-ca98-4276-a2fb-caa29c964772', 'Service Level Agreement', '3', 'priority_field', 'priority_field', 'Data', NULL, NULL, NULL, 'false', 'false', 'priority', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('a2a44ade-2920-4803-9149-c476b4479e62', 'Translation', '3', 'translated_text', 'translated_text', 'Text', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('a2ba666c-3bbf-4d21-8e5d-d5d806ebab86', 'Workflow Transition', '3', 'next_state', 'next_state', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('a3a6e7e5-135e-4851-a18e-059667d3e3b8', 'Column', '7', 'reqd', 'Required', 'Check', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('a3af84b9-6dc8-4297-a43e-8f35c5fae31d', 'Print Format', '1', 'ref_table', 'ref_table', 'Reference', 'Table', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('a3f6d482-dd37-4932-bee4-34d9221d7f80', 'Person', '8', 'user_image', 'User Image', 'Attach Image', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('a48f8a5d-b939-4db5-ac3c-a43746201f1a', 'Background Job', '6', 'run_at', 'run_at', 'Datetime', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('a4d95c40-5f53-4175-83fb-efb589506e06', 'Activity Log', '4', 'ip_address', 'ip_address', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('a52305a8-19c2-4071-b689-698da4bd9dbf', 'Glossary Term', '8', 'app_wording', 'App wording', 'JSON', NULL, NULL, NULL, 'false', 'false', NULL, 'true', 'true', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('a583bf36-dde3-4924-a709-a4c973911592', 'Comment', '3', 'content', 'content', 'Text', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('a7593bba-326b-4d7d-b6e1-7620cc69536a', 'Import Log', '11', 'part', 'part', 'Int', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('a7ad880a-7741-426b-8fbc-835e01e48494', 'Data Source', '8', 'table_allowlist', 'Table Allowlist', 'Long Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('a7cf1dd6-3ab3-4075-ab33-391fefff6c7c', 'Workflow Action', '4', 'from_state', 'from_state', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('a83fcea7-26e7-4bca-84f0-ff767c43f5f4', 'Role', '1', 'disabled', 'disabled', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('a877c781-4e23-4db9-b033-bea1abd1d671', 'Job Execution', '6', 'started_at', 'Started At', 'Datetime', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('a90a24c3-5d63-4afe-be7f-2b863374c3d3', 'Email Rule', '5', 'recipient', 'recipient', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('a95fbfb9-bbfd-4acd-9d25-51891be92b8c', 'Service Account', '1', 'label', 'Name', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('a9b6821c-a878-4652-addf-693648d60281', 'Service Account', '2', 'enabled', 'enabled', 'Check', NULL, NULL, NULL, 'false', 'false', '1', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('a9ea653f-ff30-4c58-b51e-838e0a0322ea', 'Import Log', '14', 'batch_id', 'batch_id', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('aae774a1-bd4d-4f41-8cec-70a8d3bd631b', 'Identifier System', '1', 'label', 'label', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('aba37fe5-a679-43d6-b2f3-dc2b8dbb5a25', 'Assignment Rule', '7', 'users', 'users', 'Sub-table', NULL, NULL, 'Assignment Rule User', 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('ad8cd581-ee89-4628-ae21-3451f1e77fc4', 'Email Rule', '6', 'subject', 'subject', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('aed1ffdc-428c-4408-ac19-67810c59bdbf', 'Webhook', '1', 'webhook_table', 'webhook_table', 'Reference', 'Table', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('affd932f-a63f-47b2-9dac-f75fbf453751', 'Assignment Rule', '3', 'assign_condition', 'Assign Condition', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('b2762635-170f-4da3-95a2-66d969ee8bde', 'Identifier System', '5', 'sensitivity', 'sensitivity', 'Choice', NULL, 'Normal
Restricted
Restricted, hidden
Secret', NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('b2bb76d6-19ab-4328-8b20-79c945552399', 'Table', '2', 'kind', 'Kind', 'Choice', NULL, 'table
sub_table
settings', NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('b367ee77-3b33-4465-8380-d680176964eb', 'System Settings', '3', 'date_format', 'date_format', 'Choice', NULL, 'dd-mon-yyyy', NULL, 'false', 'false', 'dd-mon-yyyy', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('b4526a77-635b-42f0-b670-8803a6ce639d', 'Workflow Transition', '1', 'state', 'state', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('b48f4ade-b9c5-445a-8419-78cd03105af1', 'Sign In Method', '9', 'settings', 'settings', 'JSON', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('b58e656e-5145-40b8-9aef-2b97f2738949', 'Workflow Transition', '4', 'allowed', 'allowed', 'Reference', 'Role', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('b6649525-7ddd-4cde-8e1b-aa2993948bd1', 'Workflow Action', '1', 'ref_table', 'ref_table', 'Reference', 'Table', NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('b720ba23-ae0d-48a2-a67f-b5dc278bfbf4', 'Job Execution', '2', 'method', 'method', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('b7de2943-91f3-4170-a1c0-e3f5ce5f0c9b', 'Workflow', '1', 'ref_table', 'ref_table', 'Reference', 'Table', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('b9a512cd-7798-42ce-a828-56865f2a030a', 'Identifier System', '2', 'kind', 'kind', 'Choice', NULL, 'employee-record
external-record
national-id
contact', NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('b9c25e29-250a-4fe5-a315-f8fdb4fefb9c', 'Share', '7', 'person', 'Person', 'Reference', 'Person', NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('b9f1792b-5cda-4d01-a34e-2aaf4b72e92d', 'Identifier System', '10', 'assigner_scoped', 'Values are scoped by assigner', 'Check', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('bb53fc4c-760d-43c7-856b-31635a4866fc', 'Permission', '11', 'can_amend', 'can_amend', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('bb784d8b-b865-41be-b61d-e4744832b9ca', 'Scheduled Job', '7', 'last_result', 'Last Result', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'true', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('bd23da9f-5b8d-4245-9670-dc1483dd2d45', 'Job Execution', '3', 'attempt', 'attempt', 'Int', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('bd99bda0-2b8d-41d8-b9c1-4ea3e21e5176', 'App Role Binding', '3', 'bound_role', 'Held through role', 'Reference', 'Role', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('bf5bdf9b-1580-4a2d-9a30-6f02f85179eb', 'System Settings', '10', 'privacy_notice', 'Privacy Notice (Markdown)', 'Long Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('c1237c2a-ae47-4477-82eb-6f6e0c5ebe90', 'Saved View', '3', 'filters', 'filters', 'JSON', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('c1682883-54c9-460e-8bac-5cfef06384cd', 'Import Log', '12', 'parts', 'parts', 'Int', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('c1d51919-6502-48e6-a56d-03f442ad6788', 'Letter Head', '3', 'footer_html', 'footer_html', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('c25f4d5c-86d2-4982-8002-f07dce3f60dc', 'Custom Field', '4', 'column_type', 'column_type', 'Data', NULL, NULL, NULL, 'false', 'false', 'Data', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('c27b8bad-72fc-4a00-bd1d-84a2f795b8dc', 'Email Rule', '1', 'ref_table', 'ref_table', 'Reference', 'Table', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('c3a79a10-9d15-4b0e-9db6-d1ae8348becb', 'Data Scope', '5', 'service_account', 'Service account', 'Reference', 'Service Account', NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('c4806407-4fd2-4b0a-b728-6f416011dec8', 'Home Page', '7', 'shortcuts', 'shortcuts', 'JSON', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('c505a046-9fb6-4d44-9347-3d13a46e7352', 'Scheduled Job', '6', 'last_outcome', 'last_outcome', 'Choice', NULL, 'success
error
refused', NULL, 'false', 'false', NULL, 'true', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('c5f6fd3c-39a9-43ab-8a0d-9eabe7af7d1b', 'Notification Log', '4', 'ref_name', 'ref_name', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('c679fcf2-7628-406e-974b-20106f32efa3', 'Column', '2', 'label', 'Label', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('c6ec614c-109a-4963-9a14-db27a4124cd3', 'Background Job', '5', 'max_attempts', 'max_attempts', 'Int', NULL, NULL, NULL, 'false', 'false', '3', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('c6ec838f-7f1d-4081-aec8-a02f2f2faf47', 'Email Rule', '4', 'condition_value', 'condition_value', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('c6f324d5-2b12-4cf8-8a39-e58db332b228', 'Background Job', '3', 'job_status', 'job_status', 'Choice', NULL, 'queued
running
done
failed', NULL, 'false', 'false', 'queued', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('c705215c-b0b6-46d0-b907-602221e0cfb7', 'System Settings', '11', 'invitation_email_intro', 'Invitation Email Introduction', 'Long Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('c7ad8d7e-2598-43a2-8f05-02400097b848', 'Dataset Snapshot', '9', 'fetch_ms', 'Fetch (ms)', 'Int', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('c82e1352-6ff5-4339-8e97-359e73301ba3', 'Auto Email Report', '3', 'file_format', 'file_format', 'Choice', NULL, 'CSV
HTML', NULL, 'false', 'false', 'CSV', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('c9d713ab-2ec9-4007-9835-ffef365acb4b', 'Email Sink', '5', 'attachment_names', 'attachment_names', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('ca00546c-971e-41b9-b792-141502ec73f1', 'Web Page', '1', 'title', 'title', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('ca6678d9-8a6f-4722-a6ef-48a716b3e3f5', 'Person', '13', 'username', 'Username', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('cb2a751a-b38c-434b-bbad-da716631cf6a', 'Scheduled Job', '9', 'problem_alert_queued', 'Problem alert queued', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'true', 'true', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('cb43a3df-2ec4-42eb-bf30-f2bc49fbf84e', 'Dataset Snapshot', '12', 'error', 'error', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('cb880bf4-a395-417e-9c5d-6bfdeeea8ee0', 'Permission', '2', 'role', 'role', 'Reference', 'Role', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('cbf58fdf-d9d0-4c36-bf89-80035ec68534', 'Webhook', '3', 'request_url', 'request_url', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('cc7a11c8-b503-4fcd-a7c5-aaf2437d81eb', 'Permission', '1', 'ref_table', 'ref_table', 'Reference', 'Table', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('ccfd3fcd-750e-48be-aa5a-3c2516e02be8', 'Home Page', '6', 'roles', 'roles', 'Sub-table', NULL, NULL, 'Home Page Role', 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('cd2deef5-1806-4eaa-aded-6fdba043e767', 'Print Format', '2', 'is_default', 'is_default', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('cd452916-d8ac-44b9-9e13-90e665a32f70', 'Column', '10', 'read_only', 'Read Only', 'Check', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('cea18866-66ab-4809-9046-fbd8745588d7', 'Home Page Link', '2', 'type', 'type', 'Choice', NULL, 'Link
Card Break', NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('cf4ed98d-a1e3-4d1f-856a-532187ebd41d', 'File', '2', 'file_url', 'file_url', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('d0063759-b7e0-4650-9539-cfc42e411f70', 'System Settings', '2', 'time_zone', 'time_zone', 'Data', NULL, NULL, NULL, 'false', 'false', 'UTC', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('d1284517-7b1f-408d-8be6-7622bfa8a3ff', 'App Role Binding', '1', 'app', 'App', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('d136973b-31e9-4545-9d52-3312bc5d4e38', 'Data Source', '4', 'default_schema', 'Default Schema', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('d3e9e493-323b-47df-b3f5-8d5bf8310094', 'Sign In Method', '3', 'enabled', 'enabled', 'Check', NULL, NULL, NULL, 'false', 'false', '1', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('d42c2796-6c5d-4bcc-a6d3-8f043004cca5', 'File', '5', 'is_private', 'is_private', 'Check', NULL, NULL, NULL, 'false', 'false', '1', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('d4eb0089-3a00-451e-a94d-fb23e50cca20', 'Workflow Document State', '2', 'target_status', 'target_status', 'Choice', NULL, 'draft
submitted
cancelled', NULL, 'false', 'false', 'draft', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('d5b57b67-3b57-4f6e-9bd1-007b87ca5b84', 'Web Form', '6', 'success_message', 'success_message', 'Data', NULL, NULL, NULL, 'false', 'false', 'Thank you — your submission was received.', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('d6a2c0ff-1b05-4b46-9944-e06e1381e8bc', 'SLA Priority', '3', 'resolution_hours', 'resolution_hours', 'Float', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('d708789f-183e-4d84-a02e-a1d7c2950c77', 'Home Page Role', '1', 'role', 'role', 'Reference', 'Role', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('d8211802-6541-43d8-ad51-59f0c6d4c4e9', 'Assignment Rule', '2', 'description', 'Assignment Description', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('d88cc0a4-0efe-4b89-b34c-7e48ab897ade', 'Email Account', '3', 'smtp_port', 'smtp_port', 'Int', NULL, NULL, NULL, 'false', 'false', '1025', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('dab3a943-4fca-4025-a376-6d16c15f3461', 'Workflow', '5', 'state_field', 'State Field', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('dabdbbf8-7d6a-49e2-925b-4ae9cea1ce1c', 'Person', '6', 'language', 'language', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('db220560-1017-4e73-b6c6-cdf1d1fddfcc', 'Email Account', '1', 'email_id', 'email_id', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('db8dd193-bc97-4ceb-aa74-b47b9143edc4', 'Data Source', '12', 'read_scaling_token', 'Read-scaling token (MotherDuck, read-only)', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('dc839727-3750-4e90-8e4e-30abced6fcfb', 'Import Log', '4', 'table_created', 'table_created', 'Check', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('dcc89a72-f655-48f7-bf1a-c0dfc0e16465', 'Service Level Agreement', '4', 'fulfilled_states', 'Fulfilled States', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('dde6cddf-6d33-423f-9cef-8100284b248e', 'Table', '3', 'is_submittable', 'Is Submittable', 'Check', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('de21f7f9-853b-4f03-85c8-b852ac9fc7d2', 'Email Sink', '2', 'mail_to', 'mail_to', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('debe36f4-e68f-4a38-b884-a9778f2da092', 'System Settings', '12', 'logo', 'Logo', 'Attach Image', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('deda5164-515f-487a-b487-cd75f189db16', 'Assignment Rule', '1', 'ref_table', 'ref_table', 'Reference', 'Table', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('df1530a3-33dc-4098-9b50-f800b2b61403', 'Scheduled Job', '3', 'enabled', 'enabled', 'Check', NULL, NULL, NULL, 'false', 'false', '1', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('e0d95e4a-f416-48ce-8b5b-d4be4cfdac5c', 'Data Source', '7', 'statement_timeout_ms', 'Statement Timeout (ms)', 'Int', NULL, NULL, NULL, 'false', 'false', '10000', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('e178e453-f9e8-415e-b536-6b597172bf02', 'Email Queue', '4', 'body', 'body', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('e22469dd-2fb1-4e35-8234-00e5bcbe659a', 'Person', '7', 'roles', 'roles', 'Sub-table', NULL, NULL, 'Has Role', 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('e24f054d-e995-48cd-8bef-7674e357dca2', 'Email Queue', '1', 'sender', 'sender', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('e2db7b71-7a03-4935-b3e9-c3d462543631', 'Auto Email Report', '1', 'report', 'report', 'Reference', 'Report', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('e55b0ecf-161e-4cb0-a687-d591a2c6cc65', 'Data Scope', '3', 'for_value', 'for_value', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('e5634c3c-495b-4c01-b0fb-8a9c7d772f67', 'Column', '4', 'reference_table', 'Reference Table', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('e7368bc3-3011-40b5-84f8-9250909f5735', 'Home Page', '5', 'links', 'links', 'Sub-table', NULL, NULL, 'Home Page Link', 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('e78f51fa-e43d-452c-91cd-9ad68beb0eb1', 'Import Log', '2', 'file_name', 'file_name', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('e846359b-ec29-4665-b1f5-4ec9e7c38fe5', 'Service Account', '3', 'api_rate_limit', 'API rate limit', 'Int', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('e888c530-be54-471c-91f2-5f23a5a79319', 'Workflow', '3', 'states', 'states', 'Sub-table', NULL, NULL, 'Workflow Document State', 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('e8fa50d4-afec-49a7-afa4-ae3e896311d8', 'Auto Email Report', '2', 'recipients', 'recipients', 'Text', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('e9c83344-df4a-441e-8467-7430a7dd76c6', 'Sign In Method', '8', 'service_url', 'service_url', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('e9f0c49e-c6d5-4502-a2b4-f9853683b84a', 'Glossary Avoid Word', '2', 'reason', 'Why', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('ea1beec6-ceb6-45fe-8924-e7d141f30d79', 'Server Script', '6', 'enabled', 'enabled', 'Check', NULL, NULL, NULL, 'false', 'false', '1', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('ea3d0b17-fed2-4226-9846-654b28b14d66', 'Dataset Snapshot', '10', 'load_ms', 'Load (ms)', 'Int', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('ea703337-da53-4cbf-9cab-3b779e2c253c', 'Import Conflict', '3', 'field', 'field', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('ead150a4-bd05-4966-83d8-820087613c4e', 'Scheduled Job', '5', 'last_run_at', 'last_run_at', 'Datetime', NULL, NULL, NULL, 'false', 'false', NULL, 'true', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('eb2d8eca-c1d6-463e-a0d1-fcb6595d2cb6', 'Version', '3', 'data', 'data', 'JSON', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('eb50ea7f-6c59-44e0-b0b5-bee4190f859d', 'Metadata Override', '1', 'table_name', 'doc_type', 'Reference', 'Table', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('eb518461-cc64-4a37-afc0-1527bb471cbe', 'Auto Email Report', '4', 'frequency', 'frequency', 'Choice', NULL, 'Daily
Weekly
Monthly', NULL, 'false', 'false', 'Daily', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('edb4fc46-00c1-48ea-ad70-c4c510fc1fd2', 'Email Rule', '3', 'condition_field', 'condition_field', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('edc55f0b-1b6b-475f-86fa-379b14c4cd80', 'Email Queue', '6', 'error', 'error', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('ee3bc349-ed1b-42c9-b44d-1fa51b92e1fc', 'Notification Log', '2', 'subject', 'subject', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('ee438fd2-af62-40f3-a884-dda048a3aab8', 'Scheduled Job', '4', 'description', 'description', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('f146aa7e-29be-4930-99b3-f94881913895', 'Column', '1', 'column_name', 'Column Name', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('f2f36d3c-5743-4e7b-9d37-64357a28ce8a', 'Identifier System', '14', 'storage', 'storage', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'true', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('f3798c1c-9885-4ad1-8415-6f7cb43cd178', 'Dashboard', '1', 'label', 'label', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('f39bdad3-9cf0-4eb9-a57f-714dbc91af6b', 'Notification Log', '1', 'for_user', 'for_user', 'Reference', 'Person', NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('f3d9b065-d035-4dbb-8c8d-cd7ebfd7f1a3', 'Person', '9', 'api_rate_limit', 'API Rate Limit (per minute)', 'Int', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('f3dcfbb6-17d4-44fd-8231-ee0d771f81e2', 'Email Rule', '8', 'enabled', 'enabled', 'Check', NULL, NULL, NULL, 'false', 'false', '1', 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('f45e9dbc-a192-4eb7-ae75-98e071bfea5e', 'Data Source', '3', 'root_path', 'Root Path (csv-folder)', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('f46e1ec4-cd53-4a76-9c79-cbf0b35961b9', 'Person', '14', 'built_in', 'Built-in', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'true', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('f5af3fdb-e9f0-4aa4-a94e-9025424da4bb', 'Saved View', '2', 'label', 'label', 'Data', NULL, NULL, NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('f620d651-9101-483c-995b-fac68e53cfe7', 'Import Conflict', '7', 'edited_at', 'edited_at', 'Datetime', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('f6933c33-4071-4291-aaac-dbfb77e0daa0', 'Column', '3', 'column_type', 'Column Type', 'Choice', NULL, 'Data
Int
Float
Currency
Check
Choice
Date
Datetime
Text
Long Text
Reference
Sub-table
Attach
Attach Image
JSON
Section Break
Column Break', NULL, 'true', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('f69c75ea-ccba-4b0b-964c-ede83f50ce8e', 'Custom Field', '6', 'choices', 'choices', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('f7631b9d-102d-4f00-a9b3-e7682f7db3a2', 'Custom Field', '9', 'in_list_view', 'in_list_view', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('f7833cc2-83a6-4b68-bf6d-89369d6ae113', 'Email Sink', '4', 'body', 'body', 'Text', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('f788ea6d-cbf6-4dfe-8304-9a02a82ff4a3', 'Dataset Snapshot', '3', 'definition_version', 'definition_version', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('f960aba8-8f84-4076-b9a0-ca2e123b9290', 'Dataset Snapshot', '5', 'built_at', 'built_at', 'Datetime', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'true', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('f9c56ec2-f4dd-45c0-a993-9af96fbf7b6b', 'Identifier System', '11', 'edited_by', 'edited_by', 'Choice', NULL, 'source
system-manager
reviewers
self', NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('fb4849a9-76a2-4126-9a96-ed5aea84fa5e', 'Permission', '9', 'can_submit', 'can_submit', 'Check', NULL, NULL, NULL, 'false', 'false', '0', 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('fe65ba9a-de7c-4609-91f8-03d99b539519', 'Notification Log', '3', 'ref_table', 'ref_table', 'Reference', 'Table', NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('ffe5ef69-07f6-481e-93b3-d02527216f24', 'Identifier System', '7', 'normalise', 'normalise', 'Choice', NULL, 'none
trim
upper
lower
digits
indian-mobile', NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);
INSERT INTO featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "row_table", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "created_by", "updated_by", "created_at", "updated_at", "status", "parenttype", "parentfield", "custom", "source_column", "source_fk_schema", "source_fk_table", "source_fk_column", "description") VALUES ('ffed601c-74c1-4c69-aaaf-c173f4e66749', 'Table', '4', 'id_pattern', 'ID Pattern', 'Data', NULL, NULL, NULL, 'false', 'false', NULL, 'false', 'false', 'false', 'basic', 'Administrator', 'Administrator', now(), now(), 'draft', 'Table', 'columns', 'false', NULL, NULL, NULL, NULL, NULL);


--
-- Data for Name: has_role; Type: TABLE DATA; Schema: featherbase
--

INSERT INTO featherbase.has_role ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "role") VALUES ('f213a980eb', 'Administrator', now(), now(), 'Administrator', 'draft', '1', 'Administrator', 'Person', 'roles', 'System Manager');


--
-- Data for Name: home_page; Type: TABLE DATA; Schema: featherbase
--

INSERT INTO featherbase.home_page ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "label", "icon", "module", "sequence", "shortcuts") VALUES ('system', 'Administrator', now(), now(), 'Administrator', 'draft', '0', 'System', NULL, NULL, '100', NULL);


--
-- Data for Name: home_page_link; Type: TABLE DATA; Schema: featherbase
--

INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('12a3da01-98fc-404d-af01-286151110a3f', 'Administrator', now(), now(), 'Administrator', 'draft', '7', 'system', 'Home Page', 'links', 'Automation', 'Card Break', NULL);
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('16a96b15-f729-4ba8-932c-6556e3dabb2b', 'Administrator', now(), now(), 'Administrator', 'draft', '25', 'system', 'Home Page', 'links', 'Dashboard', 'Link', 'Dashboard');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('1c6752ff-50cd-4e3f-b8a3-e41584dc7cd2', 'Administrator', now(), now(), 'Administrator', 'draft', '20', 'system', 'Home Page', 'links', 'Email Sink', 'Link', 'Email Sink');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('1dfdee91-5fcc-413d-99e9-4082b4bc31b6', 'Administrator', now(), now(), 'Administrator', 'draft', '38', 'system', 'Home Page', 'links', 'Home Page', 'Link', 'Home Page');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('21d01b2d-c248-4a8a-b41a-005a586839b3', 'Administrator', now(), now(), 'Administrator', 'draft', '34', 'system', 'Home Page', 'links', 'Background Job', 'Link', 'Background Job');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('3a786c93-693b-4afe-9404-007e57402811', 'Administrator', now(), now(), 'Administrator', 'draft', '14', 'system', 'Home Page', 'links', 'Service Level Agreement', 'Link', 'Service Level Agreement');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('477da579-42d6-499e-bc00-07b57f460a46', 'Administrator', now(), now(), 'Administrator', 'draft', '5', 'system', 'Home Page', 'links', 'Share', 'Link', 'Share');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('4bb35e13-0b82-460d-a7e4-a1e66f8e3413', 'Administrator', now(), now(), 'Administrator', 'draft', '27', 'system', 'Home Page', 'links', 'Letter Head', 'Link', 'Letter Head');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('4bf05245-f12c-49f8-b378-45c9160d8f9f', 'Administrator', now(), now(), 'Administrator', 'draft', '17', 'system', 'Home Page', 'links', 'Email Account', 'Link', 'Email Account');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('4d817831-1108-4038-90b4-d09395b69fb5', 'Administrator', now(), now(), 'Administrator', 'draft', '8', 'system', 'Home Page', 'links', 'Workflow', 'Link', 'Workflow');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('51ba5a24-88e6-4b16-97ea-af8359e6f73a', 'Administrator', now(), now(), 'Administrator', 'draft', '44', 'system', 'Home Page', 'links', 'Translation', 'Link', 'Translation');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('540716d0-88e4-4131-9051-29dc033bf140', 'Administrator', now(), now(), 'Administrator', 'draft', '11', 'system', 'Home Page', 'links', 'Client Script', 'Link', 'Client Script');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('571b7661-1f10-4557-81e2-f0647a9817f1', 'Administrator', now(), now(), 'Administrator', 'draft', '2', 'system', 'Home Page', 'links', 'Person', 'Link', 'Person');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('60360b20-223e-4657-b765-7a44482e467b', 'Administrator', now(), now(), 'Administrator', 'draft', '16', 'system', 'Home Page', 'links', 'Email', 'Card Break', NULL);
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('7aa84317-00b3-4274-a6c9-507649104dac', 'Administrator', now(), now(), 'Administrator', 'draft', '35', 'system', 'Home Page', 'links', 'Comment', 'Link', 'Comment');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('7c3fd863-b157-435d-a503-ccc3ca001e7f', 'Administrator', now(), now(), 'Administrator', 'draft', '45', 'system', 'Home Page', 'links', 'Version', 'Link', 'Version');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('7e76f52a-bdb4-43d6-af6f-6a8de56eee4d', 'Administrator', now(), now(), 'Administrator', 'draft', '13', 'system', 'Home Page', 'links', 'Webhook', 'Link', 'Webhook');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('83553548-d63f-4273-8bee-4e3882fe1aa9', 'Administrator', now(), now(), 'Administrator', 'draft', '23', 'system', 'Home Page', 'links', 'Reports & Dashboards', 'Card Break', NULL);
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('86f45e4d-4ec8-48f7-bedf-3d6a1f243909', 'Administrator', now(), now(), 'Administrator', 'draft', '4', 'system', 'Home Page', 'links', 'Permission', 'Link', 'Permission');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('88dd091f-aaae-493d-bd6d-449666a480ad', 'Administrator', now(), now(), 'Administrator', 'draft', '30', 'system', 'Home Page', 'links', 'Web Form', 'Link', 'Web Form');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('96b19ee1-45d0-4a6c-bf8c-e06481b9e7c0', 'Administrator', now(), now(), 'Administrator', 'draft', '18', 'system', 'Home Page', 'links', 'Email Queue', 'Link', 'Email Queue');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('9db62a19-1499-4afa-999b-2f92c19dfd5c', 'Administrator', now(), now(), 'Administrator', 'draft', '32', 'system', 'Home Page', 'links', 'Access Log', 'Link', 'Access Log');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('9dc2fa37-db1c-4d71-bb57-f69c8d82305e', 'Administrator', now(), now(), 'Administrator', 'draft', '43', 'system', 'Home Page', 'links', 'Table', 'Link', 'Table');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('ab783570-4537-45fd-b447-095c315aeec8', 'Administrator', now(), now(), 'Administrator', 'draft', '10', 'system', 'Home Page', 'links', 'Server Script', 'Link', 'Server Script');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('b03a4ca5-2718-43c1-b3ac-a4ae1b796ee0', 'Administrator', now(), now(), 'Administrator', 'draft', '26', 'system', 'Home Page', 'links', 'Print Format', 'Link', 'Print Format');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('b0b5c70d-2c27-4521-a86a-646ba7d3703c', 'Administrator', now(), now(), 'Administrator', 'draft', '3', 'system', 'Home Page', 'links', 'Role', 'Link', 'Role');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('b59ecd6c-4872-4006-acde-550c7e0b3b05', 'Administrator', now(), now(), 'Administrator', 'draft', '19', 'system', 'Home Page', 'links', 'Email Rule', 'Link', 'Email Rule');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('bf4102a2-ec12-4e4b-adce-f4d9c9476b33', 'Administrator', now(), now(), 'Administrator', 'draft', '28', 'system', 'Home Page', 'links', 'Website', 'Card Break', NULL);
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('c0faffa0-5be3-44f5-bf7b-4de30b475c55', 'Administrator', now(), now(), 'Administrator', 'draft', '15', 'system', 'Home Page', 'links', 'ToDo', 'Link', 'ToDo');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('c2102c8b-0230-4600-9dd2-b23e5054a069', 'Administrator', now(), now(), 'Administrator', 'draft', '22', 'system', 'Home Page', 'links', 'Notification Log', 'Link', 'Notification Log');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('cf73324c-0cc1-41db-95b5-0830d01ca021', 'Administrator', now(), now(), 'Administrator', 'draft', '41', 'system', 'Home Page', 'links', 'Metadata Override', 'Link', 'Metadata Override');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('d1b817c1-8dd7-4ea9-b276-921a676eb52c', 'Administrator', now(), now(), 'Administrator', 'draft', '42', 'system', 'Home Page', 'links', 'System Settings', 'Link', 'System Settings');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('d25ea18e-ada1-40e3-b41e-398ba1488701', 'Administrator', now(), now(), 'Administrator', 'draft', '12', 'system', 'Home Page', 'links', 'Assignment Rule', 'Link', 'Assignment Rule');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('d274c279-356f-40df-bec5-3663c5a25d61', 'Administrator', now(), now(), 'Administrator', 'draft', '40', 'system', 'Home Page', 'links', 'Job Execution', 'Link', 'Job Execution');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('d81c31f4-9d22-4926-87eb-2edeac6bf19e', 'Administrator', now(), now(), 'Administrator', 'draft', '29', 'system', 'Home Page', 'links', 'Web Page', 'Link', 'Web Page');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('d8777cb4-6519-432e-ba76-d93707a1d2d5', 'Administrator', now(), now(), 'Administrator', 'draft', '24', 'system', 'Home Page', 'links', 'Report', 'Link', 'Report');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('d9bb6372-a851-4dc8-afb1-e0fb3ad315a0', 'Administrator', now(), now(), 'Administrator', 'draft', '6', 'system', 'Home Page', 'links', 'Data Scope', 'Link', 'Data Scope');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('dfd8ca6d-b43e-4223-a066-ed1d35403cbe', 'Administrator', now(), now(), 'Administrator', 'draft', '21', 'system', 'Home Page', 'links', 'Auto Email Report', 'Link', 'Auto Email Report');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('e2298c24-0ced-4a0c-8f94-59f01ed570bd', 'Administrator', now(), now(), 'Administrator', 'draft', '33', 'system', 'Home Page', 'links', 'Activity Log', 'Link', 'Activity Log');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('e265a921-a3e6-4287-9215-1fb5e20868c3', 'Administrator', now(), now(), 'Administrator', 'draft', '37', 'system', 'Home Page', 'links', 'File', 'Link', 'File');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('e524b5f5-e6ce-4c41-8811-3b5b08a78804', 'Administrator', now(), now(), 'Administrator', 'draft', '36', 'system', 'Home Page', 'links', 'Custom Field', 'Link', 'Custom Field');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('e7f4cdce-5096-4ca9-a021-990d359f0363', 'Administrator', now(), now(), 'Administrator', 'draft', '39', 'system', 'Home Page', 'links', 'Import Log', 'Link', 'Import Log');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('f63ddf9b-c79f-49ee-9466-69e56519bed7', 'Administrator', now(), now(), 'Administrator', 'draft', '31', 'system', 'Home Page', 'links', 'Platform', 'Card Break', NULL);
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('fecac944-8134-488d-b0a0-d7b542a2f2a2', 'Administrator', now(), now(), 'Administrator', 'draft', '9', 'system', 'Home Page', 'links', 'Workflow Action', 'Link', 'Workflow Action');
INSERT INTO featherbase.home_page_link ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "parent", "parenttype", "parentfield", "label", "type", "link_to") VALUES ('ffa9f040-064c-4479-8d87-6b6b70a7e149', 'Administrator', now(), now(), 'Administrator', 'draft', '1', 'system', 'Home Page', 'links', 'Users & Access', 'Card Break', NULL);


--
-- Data for Name: identifier_system; Type: TABLE DATA; Schema: featherbase
--

INSERT INTO featherbase.identifier_system ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "label", "kind", "source", "match", "sensitivity", "normalise", "one_holder_at_a_time", "one_per_person", "assigner_scoped", "edited_by", "retain_after_leaving_days", "enabled", "storage", "display", "tier") VALUES ('email', 'Administrator', now(), now(), 'Administrator', 'draft', '0', 'Email address', 'contact', 'self', 'Suggest', 'Normal', 'lower', 'false', 'false', 'false', 'self', NULL, 'true', 'plain', 'full', 'basic');
INSERT INTO featherbase.identifier_system ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "label", "kind", "source", "match", "sensitivity", "normalise", "one_holder_at_a_time", "one_per_person", "assigner_scoped", "edited_by", "retain_after_leaving_days", "enabled", "storage", "display", "tier") VALUES ('phone', 'Administrator', now(), now(), 'Administrator', 'draft', '0', 'Mobile phone', 'contact', 'self', 'Suggest', 'Restricted', 'indian-mobile', 'false', 'false', 'false', 'self', NULL, 'true', 'plain', 'full', 'restricted');


--
-- Data for Name: permission; Type: TABLE DATA; Schema: featherbase
--

INSERT INTO featherbase.permission ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "ref_table", "role", "tier", "own_rows_only", "can_read", "can_write", "can_create", "can_delete", "can_submit", "can_cancel", "can_amend", "owner_app") VALUES ('glossary-term-everyone-reads', 'Administrator', now(), now(), 'Administrator', 'draft', '0', 'Glossary Term', 'All', 'basic', 'false', 'true', 'false', 'false', 'false', 'false', 'false', 'false', NULL);


--
-- Data for Name: person; Type: TABLE DATA; Schema: featherbase
--

INSERT INTO featherbase.person ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "email", "full_name", "enabled", "password_hash", "language", "user_image", "api_rate_limit", "theme", "username", "built_in", "replaced_by", "sessions_ended_at", "expects_google_sign_in") VALUES ('Administrator', 'Administrator', now(), now(), 'Administrator', 'draft', '0', NULL, 'Administrator', 'true', NULL, NULL, NULL, NULL, 'device', NULL, 'true', NULL, NULL, 'false');
INSERT INTO featherbase.person ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "email", "full_name", "enabled", "password_hash", "language", "user_image", "api_rate_limit", "theme", "username", "built_in", "replaced_by", "sessions_ended_at", "expects_google_sign_in") VALUES ('Guest', 'Administrator', now(), now(), 'Administrator', 'draft', '0', NULL, 'Guest', 'true', NULL, NULL, NULL, NULL, 'device', NULL, 'true', NULL, NULL, 'false');


--
-- Data for Name: role; Type: TABLE DATA; Schema: featherbase
--

INSERT INTO featherbase.role ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "disabled") VALUES ('All', 'Administrator', now(), now(), 'Administrator', 'draft', '0', 'false');
INSERT INTO featherbase.role ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "disabled") VALUES ('Data Quality Manager', 'Administrator', now(), now(), 'Administrator', 'draft', '0', 'false');
INSERT INTO featherbase.role ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "disabled") VALUES ('Guest', 'Administrator', now(), now(), 'Administrator', 'draft', '0', 'false');
INSERT INTO featherbase.role ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "disabled") VALUES ('Identity Sync', 'Administrator', now(), now(), 'Administrator', 'draft', '0', 'false');
INSERT INTO featherbase.role ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "disabled") VALUES ('System Manager', 'Administrator', now(), now(), 'Administrator', 'draft', '0', 'false');


--
-- Data for Name: scheduled_job; Type: TABLE DATA; Schema: featherbase
--

INSERT INTO featherbase.scheduled_job ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "method", "cadence", "enabled", "description", "last_run_at", "last_outcome", "last_duration_ms", "last_result", "problem_alert_queued") VALUES ('auto_email_reports', 'Administrator', now(), now(), 'Administrator', 'draft', '0', 'auto_email_reports', 'daily', 'true', 'Send every enabled Auto Email Report whose schedule is due.', NULL, NULL, NULL, NULL, 'false');
INSERT INTO featherbase.scheduled_job ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "method", "cadence", "enabled", "description", "last_run_at", "last_outcome", "last_duration_ms", "last_result", "problem_alert_queued") VALUES ('check_instance_health', 'Administrator', now(), now(), 'Administrator', 'draft', '0', 'check_instance_health', 'every 15 minutes', 'true', 'Run the instance health checks and record every check that started failing or passed again, so the history on the Instance health page is right even when nobody opens it.', NULL, NULL, NULL, NULL, 'false');
INSERT INTO featherbase.scheduled_job ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "method", "cadence", "enabled", "description", "last_run_at", "last_outcome", "last_duration_ms", "last_result", "problem_alert_queued") VALUES ('check_sla', 'Administrator', now(), now(), 'Administrator', 'draft', '0', 'check_sla', 'every minute', 'true', 'Escalate rows past their SLA resolution deadline.', NULL, NULL, NULL, NULL, 'false');
INSERT INTO featherbase.scheduled_job ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "method", "cadence", "enabled", "description", "last_run_at", "last_outcome", "last_duration_ms", "last_result", "problem_alert_queued") VALUES ('disable_leavers', 'Administrator', now(), now(), 'Administrator', 'draft', '0', 'disable_leavers', 'daily', 'false', 'Disable everyone whose StyleHR record in the warehouse shows they have left: an exit date that has passed, an inactive status, or not on the latest payroll. Only ever disables; skips and reports System Managers; refuses on a stale feed or an implausibly large batch.', NULL, NULL, NULL, NULL, 'false');
INSERT INTO featherbase.scheduled_job ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "method", "cadence", "enabled", "description", "last_run_at", "last_outcome", "last_duration_ms", "last_result", "problem_alert_queued") VALUES ('refresh_datasets', 'Administrator', now(), now(), 'Administrator', 'draft', '0', 'refresh_datasets', 'every 4 hours', 'true', 'Rebuild every dataset snapshot a report has asked for. Four-hourly to follow the warehouse fleet grid an hour behind its dbt build (data-warehouse #3036/#3082); a cache miss also wakes this job immediately, so a new report never waits a full period.', NULL, NULL, NULL, NULL, 'false');


--
-- Data for Name: sign_in_method; Type: TABLE DATA; Schema: featherbase
--

INSERT INTO featherbase.sign_in_method ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "kind", "label", "enabled", "new_person", "allowed_email_domains", "self_link", "client_id", "service_url", "settings", "identifier_system") VALUES ('google', 'Administrator', now(), now(), 'Administrator', 'draft', '0', 'google', 'Google', 'false', 'create_if_email_domain_allowed', NULL, 'true', NULL, NULL, NULL, NULL);
INSERT INTO featherbase.sign_in_method ("row_id", "created_by", "created_at", "updated_at", "updated_by", "status", "position", "kind", "label", "enabled", "new_person", "allowed_email_domains", "self_link", "client_id", "service_url", "settings", "identifier_system") VALUES ('password', 'Administrator', now(), now(), 'Administrator', 'draft', '0', 'password', 'Password', 'true', 'refuse', NULL, 'true', NULL, NULL, NULL, NULL);


--
-- Data for Name: single_value; Type: TABLE DATA; Schema: featherbase
--

INSERT INTO featherbase.single_value ("table_name", "field", "value") VALUES ('System Settings', 'people_review', '{"compare_columns":["full_name","codes","roles","data_scope","sign_in_methods","last_sign_in"],"survivor_rule":"most-recent-sign-in"}');


--
-- Data for Name: table_def; Type: TABLE DATA; Schema: featherbase
--

INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Access Log', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'true', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Activity Log', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'true', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('App Role Binding', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('App Setting', 'Core', 'table', 'false', 'prompt', 'setting', 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Assignment Rule', 'Core', 'table', 'false', 'prompt', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Assignment Rule User', 'Core', 'sub_table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Auto Email Report', 'Core', 'table', 'false', 'prompt', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Background Job', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'true', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Client Script', 'Core', 'table', 'false', 'prompt', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Column', 'Core', 'sub_table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Comment', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Custom Field', 'Core', 'table', 'false', 'prompt', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Dashboard', 'Core', 'table', 'false', 'prompt', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Data Scope', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Data Source', 'Integrations', 'table', 'false', 'prompt', NULL, 'updated_at', 'desc', 'true', 'A connection to an external store (Postgres, MySQL, DuckDB/MotherDuck, or a CSV folder). Credentials are read from the named environment variable at connect time and are never stored. For read-only access, prefer a database role/token that is itself read-only — the access flag here is a guard rail, not the security boundary.', 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Dataset Miss', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'true', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Dataset Snapshot', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'true', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Email Account', 'Core', 'table', 'false', 'prompt', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Email Queue', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'true', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Email Rule', 'Core', 'table', 'false', 'prompt', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Email Sink', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'true', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('File', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Glossary Avoid Word', 'Core', 'sub_table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Glossary Link', 'Core', 'sub_table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Glossary Term', 'Core', 'table', 'false', 'hash', 'term', 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Has Role', 'Core', 'sub_table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Home Page', 'Core', 'table', 'false', 'prompt', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Home Page Link', 'Core', 'sub_table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Home Page Role', 'Core', 'sub_table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Identifier System', 'Core', 'table', 'false', 'prompt', 'label', 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Import Conflict', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'false', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'true', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Import Log', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'true', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Import Source', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'false', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'true', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Job Execution', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'true', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Letter Head', 'Core', 'table', 'false', 'prompt', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Metadata Override', 'Core', 'table', 'false', 'prompt', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Notification Log', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'true', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Permission', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Person', 'Core', 'table', 'false', 'opaque:psn_', 'full_name', 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, 'Person', NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Print Format', 'Core', 'table', 'false', 'prompt', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Report', 'Core', 'table', 'false', 'prompt', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Role', 'Core', 'table', 'false', 'prompt', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Saved View', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Scheduled Job', 'Core', 'table', 'false', 'field:method', 'method', 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Server Script', 'Core', 'table', 'false', 'prompt', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Service Account', 'Core', 'table', 'false', 'opaque:svc_', 'label', 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Service Level Agreement', 'Core', 'table', 'false', 'prompt', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Share', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Sign In Method', 'Core', 'table', 'false', 'prompt', 'label', 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('SLA Priority', 'Core', 'sub_table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('System Settings', 'Core', 'settings', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Table', 'Core', 'table', 'false', 'prompt', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('ToDo', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Translation', 'Core', 'table', 'false', 'prompt', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('User Event', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'true', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Version', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'true', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Web Form', 'Website', 'table', 'false', 'prompt', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Web Page', 'Website', 'table', 'false', 'prompt', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Webhook', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Workflow', 'Core', 'table', 'false', 'prompt', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Workflow Action', 'Core', 'table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Workflow Document State', 'Core', 'sub_table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');
INSERT INTO featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "created_at", "updated_at", "status", "position", "data_source", "external_schema", "external_table", "external_pk", "external_modified", "label", "owner_app", "physical_schema", "physical_relation", "system_written", "decides_scope") VALUES ('Workflow Transition', 'Core', 'sub_table', 'false', 'hash', NULL, 'updated_at', 'desc', 'true', NULL, 'false', 'true', 'Administrator', 'Administrator', now(), now(), 'draft', '0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'false', 'false');


SET LOCAL default_tablespace = '';


--
-- Name: access_log access_log_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.access_log
    ADD CONSTRAINT access_log_pkey PRIMARY KEY (row_id);


--
-- Name: access_token access_token_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.access_token
    ADD CONSTRAINT access_token_pkey PRIMARY KEY (id);


--
-- Name: access_token access_token_token_hash_key; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.access_token
    ADD CONSTRAINT access_token_token_hash_key UNIQUE (token_hash);


--
-- Name: activity_log activity_log_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.activity_log
    ADD CONSTRAINT activity_log_pkey PRIMARY KEY (row_id);


--
-- Name: app_role_binding app_role_binding_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.app_role_binding
    ADD CONSTRAINT app_role_binding_pkey PRIMARY KEY (row_id);


--
-- Name: app_setting app_setting_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.app_setting
    ADD CONSTRAINT app_setting_pkey PRIMARY KEY (row_id);


--
-- Name: assignment_rule assignment_rule_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.assignment_rule
    ADD CONSTRAINT assignment_rule_pkey PRIMARY KEY (row_id);


--
-- Name: assignment_rule_user assignment_rule_user_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.assignment_rule_user
    ADD CONSTRAINT assignment_rule_user_pkey PRIMARY KEY (row_id);


--
-- Name: auto_email_report auto_email_report_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.auto_email_report
    ADD CONSTRAINT auto_email_report_pkey PRIMARY KEY (row_id);


--
-- Name: background_job background_job_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.background_job
    ADD CONSTRAINT background_job_pkey PRIMARY KEY (row_id);


--
-- Name: client_script client_script_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.client_script
    ADD CONSTRAINT client_script_pkey PRIMARY KEY (row_id);


--
-- Name: column_def column_def_parent_column_name; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.column_def
    ADD CONSTRAINT column_def_parent_column_name UNIQUE (parent, column_name);


--
-- Name: column_def column_def_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.column_def
    ADD CONSTRAINT column_def_pkey PRIMARY KEY (row_id);


--
-- Name: comment comment_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.comment
    ADD CONSTRAINT comment_pkey PRIMARY KEY (row_id);


--
-- Name: custom_field custom_field_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.custom_field
    ADD CONSTRAINT custom_field_pkey PRIMARY KEY (row_id);


--
-- Name: dashboard dashboard_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.dashboard
    ADD CONSTRAINT dashboard_pkey PRIMARY KEY (row_id);


--
-- Name: data_scope data_scope_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.data_scope
    ADD CONSTRAINT data_scope_pkey PRIMARY KEY (row_id);


--
-- Name: data_source data_source_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.data_source
    ADD CONSTRAINT data_source_pkey PRIMARY KEY (row_id);


--
-- Name: dataset_miss dataset_miss_dataset_uq; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.dataset_miss
    ADD CONSTRAINT dataset_miss_dataset_uq UNIQUE (dataset);


--
-- Name: dataset_miss dataset_miss_pkey1; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.dataset_miss
    ADD CONSTRAINT dataset_miss_pkey1 PRIMARY KEY (row_id);


--
-- Name: dataset_place_drop dataset_place_drop_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.dataset_place_drop
    ADD CONSTRAINT dataset_place_drop_pkey PRIMARY KEY (app, dataset, provider, filter_keys, app_version, provider_version);


--
-- Name: dataset_snapshot dataset_snapshot_pkey1; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.dataset_snapshot
    ADD CONSTRAINT dataset_snapshot_pkey1 PRIMARY KEY (row_id);


--
-- Name: email_account email_account_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.email_account
    ADD CONSTRAINT email_account_pkey PRIMARY KEY (row_id);


--
-- Name: email_queue email_queue_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.email_queue
    ADD CONSTRAINT email_queue_pkey PRIMARY KEY (row_id);


--
-- Name: email_rule email_rule_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.email_rule
    ADD CONSTRAINT email_rule_pkey PRIMARY KEY (row_id);


--
-- Name: email_sink email_sink_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.email_sink
    ADD CONSTRAINT email_sink_pkey PRIMARY KEY (row_id);


--
-- Name: file file_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.file
    ADD CONSTRAINT file_pkey PRIMARY KEY (row_id);


--
-- Name: glossary_avoid_word glossary_avoid_word_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.glossary_avoid_word
    ADD CONSTRAINT glossary_avoid_word_pkey PRIMARY KEY (row_id);


--
-- Name: glossary_link glossary_link_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.glossary_link
    ADD CONSTRAINT glossary_link_pkey PRIMARY KEY (row_id);


--
-- Name: glossary_term glossary_term_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.glossary_term
    ADD CONSTRAINT glossary_term_pkey PRIMARY KEY (row_id);


--
-- Name: has_role has_role_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.has_role
    ADD CONSTRAINT has_role_pkey PRIMARY KEY (row_id);


--
-- Name: health_check_event health_check_event_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.health_check_event
    ADD CONSTRAINT health_check_event_pkey PRIMARY KEY (id);


--
-- Name: home_page_link home_page_link_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.home_page_link
    ADD CONSTRAINT home_page_link_pkey PRIMARY KEY (row_id);


--
-- Name: home_page home_page_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.home_page
    ADD CONSTRAINT home_page_pkey PRIMARY KEY (row_id);


--
-- Name: home_page_role home_page_role_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.home_page_role
    ADD CONSTRAINT home_page_role_pkey PRIMARY KEY (row_id);


--
-- Name: identifier_system identifier_system_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.identifier_system
    ADD CONSTRAINT identifier_system_pkey PRIMARY KEY (row_id);


--
-- Name: import_conflict import_conflict_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.import_conflict
    ADD CONSTRAINT import_conflict_pkey PRIMARY KEY (row_id);


--
-- Name: import_log import_log_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.import_log
    ADD CONSTRAINT import_log_pkey PRIMARY KEY (row_id);


--
-- Name: import_source import_source_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.import_source
    ADD CONSTRAINT import_source_pkey PRIMARY KEY (row_id);


--
-- Name: installed_app installed_app_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.installed_app
    ADD CONSTRAINT installed_app_pkey PRIMARY KEY (name);


--
-- Name: instance_settings_apply instance_settings_apply_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.instance_settings_apply
    ADD CONSTRAINT instance_settings_apply_pkey PRIMARY KEY (id);


--
-- Name: internal_metadata internal_metadata_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.internal_metadata
    ADD CONSTRAINT internal_metadata_pkey PRIMARY KEY (key);


--
-- Name: job_execution job_execution_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.job_execution
    ADD CONSTRAINT job_execution_pkey PRIMARY KEY (row_id);


--
-- Name: letter_head letter_head_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.letter_head
    ADD CONSTRAINT letter_head_pkey PRIMARY KEY (row_id);


--
-- Name: notification_log notification_log_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.notification_log
    ADD CONSTRAINT notification_log_pkey PRIMARY KEY (row_id);


--
-- Name: password_reset password_reset_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.password_reset
    ADD CONSTRAINT password_reset_pkey PRIMARY KEY (token);


--
-- Name: permission permission_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.permission
    ADD CONSTRAINT permission_pkey PRIMARY KEY (row_id);


--
-- Name: person_id_map person_id_map_new_id_key; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.person_id_map
    ADD CONSTRAINT person_id_map_new_id_key UNIQUE (new_id);


--
-- Name: person_id_map person_id_map_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.person_id_map
    ADD CONSTRAINT person_id_map_pkey PRIMARY KEY (old_id);


--
-- Name: person_identifier_fingerprint person_identifier_fingerprint_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.person_identifier_fingerprint
    ADD CONSTRAINT person_identifier_fingerprint_pkey PRIMARY KEY (identifier_id);


--
-- Name: person_identifier person_identifier_one_holder; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.person_identifier
    ADD CONSTRAINT person_identifier_one_holder EXCLUDE USING gist (system WITH =, assigner WITH =, value WITH =, valid WITH &&) WHERE ((one_holder AND (value IS NOT NULL)));


--
-- Name: person_identifier person_identifier_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.person_identifier
    ADD CONSTRAINT person_identifier_pkey PRIMARY KEY (id);


--
-- Name: person_match_member person_match_member_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.person_match_member
    ADD CONSTRAINT person_match_member_pkey PRIMARY KEY (match_id, person_id);


--
-- Name: person_match person_match_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.person_match
    ADD CONSTRAINT person_match_pkey PRIMARY KEY (id);


--
-- Name: person_merge person_merge_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.person_merge
    ADD CONSTRAINT person_merge_pkey PRIMARY KEY (id);


--
-- Name: person person_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.person
    ADD CONSTRAINT person_pkey PRIMARY KEY (row_id);


--
-- Name: pre_auth_bucket pre_auth_bucket_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.pre_auth_bucket
    ADD CONSTRAINT pre_auth_bucket_pkey PRIMARY KEY (key);


--
-- Name: print_format print_format_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.print_format
    ADD CONSTRAINT print_format_pkey PRIMARY KEY (row_id);


--
-- Name: metadata_override property_setter_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.metadata_override
    ADD CONSTRAINT property_setter_pkey PRIMARY KEY (row_id);


--
-- Name: report report_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.report
    ADD CONSTRAINT report_pkey PRIMARY KEY (row_id);


--
-- Name: revoked_session revoked_session_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.revoked_session
    ADD CONSTRAINT revoked_session_pkey PRIMARY KEY (jti);


--
-- Name: role role_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.role
    ADD CONSTRAINT role_pkey PRIMARY KEY (row_id);


--
-- Name: runtime_action_result runtime_action_result_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.runtime_action_result
    ADD CONSTRAINT runtime_action_result_pkey PRIMARY KEY (caller, app, action, idempotency_key);


--
-- Name: sales_target_snapshot_name sales_target_snapshot_name_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.sales_target_snapshot_name
    ADD CONSTRAINT sales_target_snapshot_name_pkey PRIMARY KEY (snapshot_id, hierarchy_code);


--
-- Name: saved_view saved_view_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.saved_view
    ADD CONSTRAINT saved_view_pkey PRIMARY KEY (row_id);


--
-- Name: scheduled_job scheduled_job_method_uq; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.scheduled_job
    ADD CONSTRAINT scheduled_job_method_uq UNIQUE (method);


--
-- Name: scheduled_job scheduled_job_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.scheduled_job
    ADD CONSTRAINT scheduled_job_pkey PRIMARY KEY (row_id);


--
-- Name: series series_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.series
    ADD CONSTRAINT series_pkey PRIMARY KEY (name);


--
-- Name: server_script server_script_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.server_script
    ADD CONSTRAINT server_script_pkey PRIMARY KEY (row_id);


--
-- Name: service_account service_account_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.service_account
    ADD CONSTRAINT service_account_pkey PRIMARY KEY (row_id);


--
-- Name: service_level_agreement service_level_agreement_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.service_level_agreement
    ADD CONSTRAINT service_level_agreement_pkey PRIMARY KEY (row_id);


--
-- Name: share share_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.share
    ADD CONSTRAINT share_pkey PRIMARY KEY (row_id);


--
-- Name: sign_in_identity sign_in_identity_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.sign_in_identity
    ADD CONSTRAINT sign_in_identity_pkey PRIMARY KEY (id);


--
-- Name: sign_in_method sign_in_method_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.sign_in_method
    ADD CONSTRAINT sign_in_method_pkey PRIMARY KEY (row_id);


--
-- Name: single_value single_value_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.single_value
    ADD CONSTRAINT single_value_pkey PRIMARY KEY (table_name, field);


--
-- Name: sla_priority sla_priority_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.sla_priority
    ADD CONSTRAINT sla_priority_pkey PRIMARY KEY (row_id);


--
-- Name: table_def table_def_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.table_def
    ADD CONSTRAINT table_def_pkey PRIMARY KEY (name);


--
-- Name: tag_link tag_link_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.tag_link
    ADD CONSTRAINT tag_link_pkey PRIMARY KEY (ref_table, ref_name, tag);


--
-- Name: todo todo_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.todo
    ADD CONSTRAINT todo_pkey PRIMARY KEY (row_id);


--
-- Name: translation translation_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.translation
    ADD CONSTRAINT translation_pkey PRIMARY KEY (row_id);


--
-- Name: user_event user_event_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.user_event
    ADD CONSTRAINT user_event_pkey PRIMARY KEY (row_id);


--
-- Name: user_settings user_settings_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY ("user", table_name);


--
-- Name: version version_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.version
    ADD CONSTRAINT version_pkey PRIMARY KEY (row_id);


--
-- Name: web_form web_form_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.web_form
    ADD CONSTRAINT web_form_pkey PRIMARY KEY (row_id);


--
-- Name: web_form web_form_route_uq; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.web_form
    ADD CONSTRAINT web_form_route_uq UNIQUE (route);


--
-- Name: web_page web_page_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.web_page
    ADD CONSTRAINT web_page_pkey PRIMARY KEY (row_id);


--
-- Name: web_page web_page_route_uq; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.web_page
    ADD CONSTRAINT web_page_route_uq UNIQUE (route);


--
-- Name: webhook webhook_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.webhook
    ADD CONSTRAINT webhook_pkey PRIMARY KEY (row_id);


--
-- Name: workflow_action workflow_action_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.workflow_action
    ADD CONSTRAINT workflow_action_pkey PRIMARY KEY (row_id);


--
-- Name: workflow_document_state workflow_document_state_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.workflow_document_state
    ADD CONSTRAINT workflow_document_state_pkey PRIMARY KEY (row_id);


--
-- Name: workflow workflow_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.workflow
    ADD CONSTRAINT workflow_pkey PRIMARY KEY (row_id);


--
-- Name: workflow_transition workflow_transition_pkey; Type: CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.workflow_transition
    ADD CONSTRAINT workflow_transition_pkey PRIMARY KEY (row_id);


--
-- Name: site site_host_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site
    ADD CONSTRAINT site_host_key UNIQUE (host);


--
-- Name: site site_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site
    ADD CONSTRAINT site_pkey PRIMARY KEY (name);


--
-- Name: access_token_person_ix; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX access_token_person_ix ON featherbase.access_token USING btree (person);


--
-- Name: access_token_service_account_ix; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX access_token_service_account_ix ON featherbase.access_token USING btree (service_account);


--
-- Name: activity_log_operation_pattern; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX activity_log_operation_pattern ON featherbase.activity_log USING btree (operation varchar_pattern_ops, created_at);


--
-- Name: activity_log_user_operation; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX activity_log_user_operation ON featherbase.activity_log USING btree ("user", operation, created_at);


--
-- Name: app_dataset_row_snapshot; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX app_dataset_row_snapshot ON featherbase.app_dataset_row USING btree (snapshot_id);


--
-- Name: app_storage_location; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE UNIQUE INDEX app_storage_location ON featherbase.table_def USING btree (physical_schema, physical_relation) WHERE (owner_app IS NOT NULL);


--
-- Name: assignment_rule_user_parent_idx; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX assignment_rule_user_parent_idx ON featherbase.assignment_rule_user USING btree (parent, "position");


--
-- Name: column_def_parent_position; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX column_def_parent_position ON featherbase.column_def USING btree (parent, "position");


--
-- Name: comment_ref_idx; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX comment_ref_idx ON featherbase.comment USING btree (ref_table, ref_name);


--
-- Name: data_scope_person_ix; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX data_scope_person_ix ON featherbase.data_scope USING btree (person);


--
-- Name: data_scope_service_account_ix; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX data_scope_service_account_ix ON featherbase.data_scope USING btree (service_account);


--
-- Name: dataset_snapshot_dataset_state; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX dataset_snapshot_dataset_state ON featherbase.dataset_snapshot USING btree (dataset, state);


--
-- Name: dataset_snapshot_one_active; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE UNIQUE INDEX dataset_snapshot_one_active ON featherbase.dataset_snapshot USING btree (dataset) WHERE (state = 'active'::text);


--
-- Name: file_ref_idx; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX file_ref_idx ON featherbase.file USING btree (ref_table, ref_name);


--
-- Name: glossary_avoid_word_parent_idx; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX glossary_avoid_word_parent_idx ON featherbase.glossary_avoid_word USING btree (parent, "position");


--
-- Name: glossary_link_parent_idx; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX glossary_link_parent_idx ON featherbase.glossary_link USING btree (parent, "position");


--
-- Name: has_role_parent_idx; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX has_role_parent_idx ON featherbase.has_role USING btree (parent, "position");


--
-- Name: health_check_event_key_at; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX health_check_event_key_at ON featherbase.health_check_event USING btree (check_key, at DESC, id DESC);


--
-- Name: home_page_link_parent_idx; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX home_page_link_parent_idx ON featherbase.home_page_link USING btree (parent, "position");


--
-- Name: home_page_role_parent_idx; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX home_page_role_parent_idx ON featherbase.home_page_role USING btree (parent, "position");


--
-- Name: import_conflict_target_idx; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX import_conflict_target_idx ON featherbase.import_conflict USING btree (ref_table, ref_name, field) WHERE (closed IS NOT TRUE);


--
-- Name: import_source_target_idx; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX import_source_target_idx ON featherbase.import_source USING btree (ref_table, ref_name, created_at DESC);


--
-- Name: notification_log_ref_idx; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX notification_log_ref_idx ON featherbase.notification_log USING btree (ref_table, ref_name);


--
-- Name: person_email_lower_uq; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE UNIQUE INDEX person_email_lower_uq ON featherbase.person USING btree (lower((email)::text)) WHERE (email IS NOT NULL);


--
-- Name: person_identifier_lookup_ix; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX person_identifier_lookup_ix ON featherbase.person_identifier USING btree (system, value);


--
-- Name: person_identifier_one_per_person; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE UNIQUE INDEX person_identifier_one_per_person ON featherbase.person_identifier USING btree (person_id, system) WHERE (upper_inf(valid) AND one_per_person);


--
-- Name: person_identifier_person_ix; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX person_identifier_person_ix ON featherbase.person_identifier USING btree (person_id);


--
-- Name: person_match_anchor_uq; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE UNIQUE INDEX person_match_anchor_uq ON featherbase.person_match USING btree (anchor_identifier_id);


--
-- Name: person_username_lower_uq; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE UNIQUE INDEX person_username_lower_uq ON featherbase.person USING btree (lower((username)::text)) WHERE (username IS NOT NULL);


--
-- Name: pre_auth_bucket_expiry; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX pre_auth_bucket_expiry ON featherbase.pre_auth_bucket USING btree (expires_at);


--
-- Name: revoked_session_expiry; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX revoked_session_expiry ON featherbase.revoked_session USING btree (expires_at);


--
-- Name: sales_target_snapshot_row_scope; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX sales_target_snapshot_row_scope ON featherbase.sales_target_snapshot_row USING btree (snapshot_id, plant_code, hierarchy_code);


--
-- Name: saved_view_table; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX saved_view_table ON featherbase.saved_view USING btree (ref_table, created_by);


--
-- Name: service_account_label_lower_uq; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE UNIQUE INDEX service_account_label_lower_uq ON featherbase.service_account USING btree (lower((label)::text));


--
-- Name: share_person_ix; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX share_person_ix ON featherbase.share USING btree (person);


--
-- Name: share_ref_idx; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX share_ref_idx ON featherbase.share USING btree (share_table, share_name);


--
-- Name: share_service_account_ix; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX share_service_account_ix ON featherbase.share USING btree (service_account);


--
-- Name: sign_in_identity_pending_uq; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE UNIQUE INDEX sign_in_identity_pending_uq ON featherbase.sign_in_identity USING btree (method, pending_email) WHERE ((subject IS NULL) AND (ended_at IS NULL));


--
-- Name: sign_in_identity_person_ix; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX sign_in_identity_person_ix ON featherbase.sign_in_identity USING btree (person_id);


--
-- Name: sign_in_identity_sign_in_name_uq; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE UNIQUE INDEX sign_in_identity_sign_in_name_uq ON featherbase.sign_in_identity USING btree (method, lower((sign_in_name)::text)) WHERE ((sign_in_name IS NOT NULL) AND (ended_at IS NULL));


--
-- Name: sign_in_identity_subject_uq; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE UNIQUE INDEX sign_in_identity_subject_uq ON featherbase.sign_in_identity USING btree (method, subject) WHERE (ended_at IS NULL);


--
-- Name: sla_priority_parent_idx; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX sla_priority_parent_idx ON featherbase.sla_priority USING btree (parent, "position");


--
-- Name: tag_link_doc_idx; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX tag_link_doc_idx ON featherbase.tag_link USING btree (ref_table, ref_name);


--
-- Name: todo_ref_idx; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX todo_ref_idx ON featherbase.todo USING btree (ref_table, reference_name);


--
-- Name: translation_lang_src; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE UNIQUE INDEX translation_lang_src ON featherbase.translation USING btree (language, source_text);


--
-- Name: user_event_occurred; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX user_event_occurred ON featherbase.user_event USING btree (occurred_at);


--
-- Name: user_event_user_time; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX user_event_user_time ON featherbase.user_event USING btree (created_by, occurred_at DESC);


--
-- Name: version_ref_idx; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX version_ref_idx ON featherbase.version USING btree (ref_table, ref_name);


--
-- Name: workflow_action_ref_idx; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX workflow_action_ref_idx ON featherbase.workflow_action USING btree (ref_table, ref_name);


--
-- Name: workflow_document_state_parent_idx; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX workflow_document_state_parent_idx ON featherbase.workflow_document_state USING btree (parent, "position");


--
-- Name: workflow_one_active_per_table; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE UNIQUE INDEX workflow_one_active_per_table ON featherbase.workflow USING btree (ref_table) WHERE (is_active = true);


--
-- Name: workflow_transition_parent_idx; Type: INDEX; Schema: featherbase; Owner: -
--

CREATE INDEX workflow_transition_parent_idx ON featherbase.workflow_transition USING btree (parent, "position");


--
-- Name: person person_cancel_email_invites; Type: TRIGGER; Schema: featherbase; Owner: -
--

CREATE TRIGGER person_cancel_email_invites AFTER UPDATE OF email ON featherbase.person FOR EACH ROW EXECUTE FUNCTION featherbase.fc_cancel_email_invites();


--
-- Name: person person_clear_expected_sign_in; Type: TRIGGER; Schema: featherbase; Owner: -
--

CREATE TRIGGER person_clear_expected_sign_in BEFORE UPDATE OF email ON featherbase.person FOR EACH ROW EXECUTE FUNCTION featherbase.fc_clear_expected_sign_in();


--
-- Name: person person_id_is_permanent; Type: TRIGGER; Schema: featherbase; Owner: -
--

CREATE TRIGGER person_id_is_permanent BEFORE UPDATE OF row_id ON featherbase.person FOR EACH ROW EXECUTE FUNCTION featherbase.fc_person_id_is_permanent();


--
-- Name: access_token access_token_person_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.access_token
    ADD CONSTRAINT access_token_person_fkey FOREIGN KEY (person) REFERENCES featherbase.person(row_id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: access_token access_token_service_account_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.access_token
    ADD CONSTRAINT access_token_service_account_fkey FOREIGN KEY (service_account) REFERENCES featherbase.service_account(row_id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: app_dataset_row app_dataset_row_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.app_dataset_row
    ADD CONSTRAINT app_dataset_row_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES featherbase.dataset_snapshot(row_id) ON DELETE CASCADE;


--
-- Name: column_def column_def_parent_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.column_def
    ADD CONSTRAINT column_def_parent_fkey FOREIGN KEY (parent) REFERENCES featherbase.table_def(name) ON DELETE CASCADE;


--
-- Name: data_scope data_scope_person_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.data_scope
    ADD CONSTRAINT data_scope_person_fkey FOREIGN KEY (person) REFERENCES featherbase.person(row_id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: data_scope data_scope_service_account_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.data_scope
    ADD CONSTRAINT data_scope_service_account_fkey FOREIGN KEY (service_account) REFERENCES featherbase.service_account(row_id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: has_role has_role_person_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.has_role
    ADD CONSTRAINT has_role_person_fkey FOREIGN KEY (person) REFERENCES featherbase.person(row_id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: has_role has_role_service_account_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.has_role
    ADD CONSTRAINT has_role_service_account_fkey FOREIGN KEY (service_account) REFERENCES featherbase.service_account(row_id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: person_identifier_fingerprint person_identifier_fingerprint_identifier_id_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.person_identifier_fingerprint
    ADD CONSTRAINT person_identifier_fingerprint_identifier_id_fkey FOREIGN KEY (identifier_id) REFERENCES featherbase.person_identifier(id) ON DELETE CASCADE;


--
-- Name: person_identifier person_identifier_person_id_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.person_identifier
    ADD CONSTRAINT person_identifier_person_id_fkey FOREIGN KEY (person_id) REFERENCES featherbase.person(row_id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: person_identifier person_identifier_record_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.person_identifier
    ADD CONSTRAINT person_identifier_record_fkey FOREIGN KEY (record_identifier_id) REFERENCES featherbase.person_identifier(id) ON DELETE SET NULL;


--
-- Name: person_identifier person_identifier_system_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.person_identifier
    ADD CONSTRAINT person_identifier_system_fkey FOREIGN KEY (system) REFERENCES featherbase.identifier_system(row_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: person_match person_match_anchor_identifier_id_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.person_match
    ADD CONSTRAINT person_match_anchor_identifier_id_fkey FOREIGN KEY (anchor_identifier_id) REFERENCES featherbase.person_identifier(id);


--
-- Name: person_match_member person_match_member_identifier_id_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.person_match_member
    ADD CONSTRAINT person_match_member_identifier_id_fkey FOREIGN KEY (identifier_id) REFERENCES featherbase.person_identifier(id);


--
-- Name: person_match_member person_match_member_match_id_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.person_match_member
    ADD CONSTRAINT person_match_member_match_id_fkey FOREIGN KEY (match_id) REFERENCES featherbase.person_match(id) ON DELETE CASCADE;


--
-- Name: person_match_member person_match_member_person_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.person_match_member
    ADD CONSTRAINT person_match_member_person_fkey FOREIGN KEY (person_id) REFERENCES featherbase.person(row_id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: person_match person_match_system_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.person_match
    ADD CONSTRAINT person_match_system_fkey FOREIGN KEY (system) REFERENCES featherbase.identifier_system(row_id) ON UPDATE CASCADE;


--
-- Name: person_merge person_merge_match_id_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.person_merge
    ADD CONSTRAINT person_merge_match_id_fkey FOREIGN KEY (match_id) REFERENCES featherbase.person_match(id);


--
-- Name: person person_replaced_by_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.person
    ADD CONSTRAINT person_replaced_by_fkey FOREIGN KEY (replaced_by) REFERENCES featherbase.person(row_id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: sales_target_snapshot_name sales_target_snapshot_name_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.sales_target_snapshot_name
    ADD CONSTRAINT sales_target_snapshot_name_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES featherbase.dataset_snapshot(row_id) ON DELETE CASCADE;


--
-- Name: sales_target_snapshot_row sales_target_snapshot_row_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.sales_target_snapshot_row
    ADD CONSTRAINT sales_target_snapshot_row_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES featherbase.dataset_snapshot(row_id) ON DELETE CASCADE;


--
-- Name: share share_person_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.share
    ADD CONSTRAINT share_person_fkey FOREIGN KEY (person) REFERENCES featherbase.person(row_id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: share share_service_account_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.share
    ADD CONSTRAINT share_service_account_fkey FOREIGN KEY (service_account) REFERENCES featherbase.service_account(row_id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: sign_in_identity sign_in_identity_method_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.sign_in_identity
    ADD CONSTRAINT sign_in_identity_method_fkey FOREIGN KEY (method) REFERENCES featherbase.sign_in_method(row_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sign_in_identity sign_in_identity_person_id_fkey; Type: FK CONSTRAINT; Schema: featherbase; Owner: -
--

ALTER TABLE ONLY featherbase.sign_in_identity
    ADD CONSTRAINT sign_in_identity_person_id_fkey FOREIGN KEY (person_id) REFERENCES featherbase.person(row_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: access_log; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.access_log ENABLE ROW LEVEL SECURITY;


--
-- Name: activity_log; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.activity_log ENABLE ROW LEVEL SECURITY;


--
-- Name: app_role_binding; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.app_role_binding ENABLE ROW LEVEL SECURITY;


--
-- Name: app_setting; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.app_setting ENABLE ROW LEVEL SECURITY;


--
-- Name: assignment_rule; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.assignment_rule ENABLE ROW LEVEL SECURITY;


--
-- Name: assignment_rule_user; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.assignment_rule_user ENABLE ROW LEVEL SECURITY;


--
-- Name: auto_email_report; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.auto_email_report ENABLE ROW LEVEL SECURITY;


--
-- Name: background_job; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.background_job ENABLE ROW LEVEL SECURITY;


--
-- Name: client_script; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.client_script ENABLE ROW LEVEL SECURITY;


--
-- Name: comment; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.comment ENABLE ROW LEVEL SECURITY;


--
-- Name: custom_field; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.custom_field ENABLE ROW LEVEL SECURITY;


--
-- Name: dashboard; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.dashboard ENABLE ROW LEVEL SECURITY;


--
-- Name: data_scope; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.data_scope ENABLE ROW LEVEL SECURITY;


--
-- Name: data_source; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.data_source ENABLE ROW LEVEL SECURITY;


--
-- Name: dataset_miss; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.dataset_miss ENABLE ROW LEVEL SECURITY;


--
-- Name: dataset_snapshot; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.dataset_snapshot ENABLE ROW LEVEL SECURITY;


--
-- Name: email_account; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.email_account ENABLE ROW LEVEL SECURITY;


--
-- Name: email_queue; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.email_queue ENABLE ROW LEVEL SECURITY;


--
-- Name: email_rule; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.email_rule ENABLE ROW LEVEL SECURITY;


--
-- Name: email_sink; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.email_sink ENABLE ROW LEVEL SECURITY;


--
-- Name: access_log fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.access_log FOR SELECT USING (featherbase.fc_has_read('Access Log'::text));


--
-- Name: activity_log fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.activity_log FOR SELECT USING (featherbase.fc_has_read('Activity Log'::text));


--
-- Name: app_role_binding fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.app_role_binding FOR SELECT USING (featherbase.fc_has_read('App Role Binding'::text));


--
-- Name: app_setting fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.app_setting FOR SELECT USING (featherbase.fc_has_read('App Setting'::text));


--
-- Name: assignment_rule fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.assignment_rule FOR SELECT USING (featherbase.fc_has_read('Assignment Rule'::text));


--
-- Name: assignment_rule_user fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.assignment_rule_user FOR SELECT USING (featherbase.fc_has_read((parenttype)::text));


--
-- Name: auto_email_report fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.auto_email_report FOR SELECT USING (featherbase.fc_has_read('Auto Email Report'::text));


--
-- Name: background_job fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.background_job FOR SELECT USING (featherbase.fc_has_read('Background Job'::text));


--
-- Name: client_script fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.client_script FOR SELECT USING (featherbase.fc_has_read('Client Script'::text));


--
-- Name: comment fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.comment FOR SELECT USING (featherbase.fc_has_read('Comment'::text));


--
-- Name: custom_field fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.custom_field FOR SELECT USING (featherbase.fc_has_read('Custom Field'::text));


--
-- Name: dashboard fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.dashboard FOR SELECT USING (featherbase.fc_has_read('Dashboard'::text));


--
-- Name: data_scope fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.data_scope FOR SELECT USING (featherbase.fc_has_read('Data Scope'::text));


--
-- Name: data_source fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.data_source FOR SELECT USING (featherbase.fc_has_read('Data Source'::text));


--
-- Name: dataset_miss fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.dataset_miss FOR SELECT USING (featherbase.fc_has_read('Dataset Miss'::text));


--
-- Name: dataset_snapshot fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.dataset_snapshot FOR SELECT USING (featherbase.fc_has_read('Dataset Snapshot'::text));


--
-- Name: email_account fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.email_account FOR SELECT USING (featherbase.fc_has_read('Email Account'::text));


--
-- Name: email_queue fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.email_queue FOR SELECT USING (featherbase.fc_has_read('Email Queue'::text));


--
-- Name: email_rule fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.email_rule FOR SELECT USING (featherbase.fc_has_read('Email Rule'::text));


--
-- Name: email_sink fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.email_sink FOR SELECT USING (featherbase.fc_has_read('Email Sink'::text));


--
-- Name: file fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.file FOR SELECT USING (featherbase.fc_has_read('File'::text));


--
-- Name: glossary_avoid_word fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.glossary_avoid_word FOR SELECT USING (featherbase.fc_has_read((parenttype)::text));


--
-- Name: glossary_link fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.glossary_link FOR SELECT USING (featherbase.fc_has_read((parenttype)::text));


--
-- Name: glossary_term fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.glossary_term FOR SELECT USING (featherbase.fc_has_read('Glossary Term'::text));


--
-- Name: has_role fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.has_role FOR SELECT USING (featherbase.fc_has_read((parenttype)::text));


--
-- Name: home_page fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.home_page FOR SELECT USING (featherbase.fc_has_read('Home Page'::text));


--
-- Name: home_page_link fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.home_page_link FOR SELECT USING (featherbase.fc_has_read((parenttype)::text));


--
-- Name: home_page_role fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.home_page_role FOR SELECT USING (featherbase.fc_has_read((parenttype)::text));


--
-- Name: identifier_system fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.identifier_system FOR SELECT USING (featherbase.fc_has_read('Identifier System'::text));


--
-- Name: import_conflict fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.import_conflict FOR SELECT USING (featherbase.fc_has_read('Import Conflict'::text));


--
-- Name: import_log fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.import_log FOR SELECT USING (featherbase.fc_has_read('Import Log'::text));


--
-- Name: import_source fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.import_source FOR SELECT USING (featherbase.fc_has_read('Import Source'::text));


--
-- Name: job_execution fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.job_execution FOR SELECT USING (featherbase.fc_has_read('Job Execution'::text));


--
-- Name: letter_head fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.letter_head FOR SELECT USING (featherbase.fc_has_read('Letter Head'::text));


--
-- Name: metadata_override fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.metadata_override FOR SELECT USING (featherbase.fc_has_read('Metadata Override'::text));


--
-- Name: notification_log fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.notification_log FOR SELECT USING (featherbase.fc_has_read('Notification Log'::text));


--
-- Name: permission fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.permission FOR SELECT USING (featherbase.fc_has_read('Permission'::text));


--
-- Name: person fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.person FOR SELECT USING (featherbase.fc_has_read('User'::text));


--
-- Name: print_format fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.print_format FOR SELECT USING (featherbase.fc_has_read('Print Format'::text));


--
-- Name: report fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.report FOR SELECT USING (featherbase.fc_has_read('Report'::text));


--
-- Name: role fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.role FOR SELECT USING (featherbase.fc_has_read('Role'::text));


--
-- Name: saved_view fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.saved_view FOR SELECT USING (featherbase.fc_has_read('Saved View'::text));


--
-- Name: scheduled_job fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.scheduled_job FOR SELECT USING (featherbase.fc_has_read('Scheduled Job'::text));


--
-- Name: server_script fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.server_script FOR SELECT USING (featherbase.fc_has_read('Server Script'::text));


--
-- Name: service_account fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.service_account FOR SELECT USING (featherbase.fc_has_read('Service Account'::text));


--
-- Name: service_level_agreement fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.service_level_agreement FOR SELECT USING (featherbase.fc_has_read('Service Level Agreement'::text));


--
-- Name: share fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.share FOR SELECT USING (featherbase.fc_has_read('Share'::text));


--
-- Name: sign_in_method fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.sign_in_method FOR SELECT USING (featherbase.fc_has_read('Sign In Method'::text));


--
-- Name: sla_priority fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.sla_priority FOR SELECT USING (featherbase.fc_has_read((parenttype)::text));


--
-- Name: todo fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.todo FOR SELECT USING (featherbase.fc_has_read('ToDo'::text));


--
-- Name: translation fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.translation FOR SELECT USING (featherbase.fc_has_read('Translation'::text));


--
-- Name: user_event fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.user_event FOR SELECT USING (featherbase.fc_has_read('User Event'::text));


--
-- Name: version fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.version FOR SELECT USING (featherbase.fc_has_read('Version'::text));


--
-- Name: web_form fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.web_form FOR SELECT USING (featherbase.fc_has_read('Web Form'::text));


--
-- Name: web_page fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.web_page FOR SELECT USING (featherbase.fc_has_read('Web Page'::text));


--
-- Name: webhook fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.webhook FOR SELECT USING (featherbase.fc_has_read('Webhook'::text));


--
-- Name: workflow fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.workflow FOR SELECT USING (featherbase.fc_has_read('Workflow'::text));


--
-- Name: workflow_action fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.workflow_action FOR SELECT USING (featherbase.fc_has_read('Workflow Action'::text));


--
-- Name: workflow_document_state fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.workflow_document_state FOR SELECT USING (featherbase.fc_has_read((parenttype)::text));


--
-- Name: workflow_transition fc_select; Type: POLICY; Schema: featherbase; Owner: -
--

CREATE POLICY fc_select ON featherbase.workflow_transition FOR SELECT USING (featherbase.fc_has_read((parenttype)::text));


--
-- Name: file; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.file ENABLE ROW LEVEL SECURITY;


--
-- Name: glossary_avoid_word; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.glossary_avoid_word ENABLE ROW LEVEL SECURITY;


--
-- Name: glossary_link; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.glossary_link ENABLE ROW LEVEL SECURITY;


--
-- Name: glossary_term; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.glossary_term ENABLE ROW LEVEL SECURITY;


--
-- Name: has_role; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.has_role ENABLE ROW LEVEL SECURITY;


--
-- Name: home_page; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.home_page ENABLE ROW LEVEL SECURITY;


--
-- Name: home_page_link; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.home_page_link ENABLE ROW LEVEL SECURITY;


--
-- Name: home_page_role; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.home_page_role ENABLE ROW LEVEL SECURITY;


--
-- Name: identifier_system; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.identifier_system ENABLE ROW LEVEL SECURITY;


--
-- Name: import_conflict; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.import_conflict ENABLE ROW LEVEL SECURITY;


--
-- Name: import_log; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.import_log ENABLE ROW LEVEL SECURITY;


--
-- Name: import_source; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.import_source ENABLE ROW LEVEL SECURITY;


--
-- Name: job_execution; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.job_execution ENABLE ROW LEVEL SECURITY;


--
-- Name: letter_head; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.letter_head ENABLE ROW LEVEL SECURITY;


--
-- Name: metadata_override; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.metadata_override ENABLE ROW LEVEL SECURITY;


--
-- Name: notification_log; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.notification_log ENABLE ROW LEVEL SECURITY;


--
-- Name: permission; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.permission ENABLE ROW LEVEL SECURITY;


--
-- Name: person; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.person ENABLE ROW LEVEL SECURITY;


--
-- Name: print_format; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.print_format ENABLE ROW LEVEL SECURITY;


--
-- Name: report; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.report ENABLE ROW LEVEL SECURITY;


--
-- Name: role; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.role ENABLE ROW LEVEL SECURITY;


--
-- Name: saved_view; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.saved_view ENABLE ROW LEVEL SECURITY;


--
-- Name: scheduled_job; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.scheduled_job ENABLE ROW LEVEL SECURITY;


--
-- Name: server_script; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.server_script ENABLE ROW LEVEL SECURITY;


--
-- Name: service_account; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.service_account ENABLE ROW LEVEL SECURITY;


--
-- Name: service_level_agreement; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.service_level_agreement ENABLE ROW LEVEL SECURITY;


--
-- Name: share; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.share ENABLE ROW LEVEL SECURITY;


--
-- Name: sign_in_method; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.sign_in_method ENABLE ROW LEVEL SECURITY;


--
-- Name: sla_priority; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.sla_priority ENABLE ROW LEVEL SECURITY;


--
-- Name: todo; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.todo ENABLE ROW LEVEL SECURITY;


--
-- Name: translation; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.translation ENABLE ROW LEVEL SECURITY;


--
-- Name: user_event; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.user_event ENABLE ROW LEVEL SECURITY;


--
-- Name: version; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.version ENABLE ROW LEVEL SECURITY;


--
-- Name: web_form; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.web_form ENABLE ROW LEVEL SECURITY;


--
-- Name: web_page; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.web_page ENABLE ROW LEVEL SECURITY;


--
-- Name: webhook; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.webhook ENABLE ROW LEVEL SECURITY;


--
-- Name: workflow; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.workflow ENABLE ROW LEVEL SECURITY;


--
-- Name: workflow_action; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.workflow_action ENABLE ROW LEVEL SECURITY;


--
-- Name: workflow_document_state; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.workflow_document_state ENABLE ROW LEVEL SECURITY;


--
-- Name: workflow_transition; Type: ROW SECURITY; Schema: featherbase; Owner: -
--

ALTER TABLE featherbase.workflow_transition ENABLE ROW LEVEL SECURITY;
