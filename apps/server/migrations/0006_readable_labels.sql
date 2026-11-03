-- Presentation metadata only. Baseline identifiers and canonical choices stay put.
ALTER TABLE featherbase.column_def ADD COLUMN IF NOT EXISTS choice_labels jsonb;
ALTER TABLE featherbase.custom_field ADD COLUMN IF NOT EXISTS choice_labels jsonb;

INSERT INTO featherbase.column_def
  (parent, position, column_name, label, column_type, parenttype, parentfield)
SELECT parent, position, 'choice_labels', 'Choice Labels', 'JSON', 'Table', 'columns'
FROM (VALUES ('Column', 30), ('Custom Field', 10)) AS definitions(parent, position)
ON CONFLICT (parent, column_name) DO NOTHING;

-- Enumerated from 0001_baseline.sql's raw-label defaults, not a scan of
-- whatever metadata an app or person has since installed. A grouped list
-- keeps the known (parent, column, old label = column) triples reviewable.
WITH baseline(parent, columns) AS (VALUES
  ('Access Log', 'user,operation,ref_table,reference_name,method'),
  ('Activity Log', 'user,operation,full_name,ip_address'),
  ('Assignment Rule', 'ref_table,disabled,last_user,users'),
  ('Assignment Rule User', 'user'),
  ('Auto Email Report', 'report,recipients,file_format,frequency,enabled,last_sent'),
  ('Background Job', 'method,payload,job_status,attempts,max_attempts,run_at,error,repeat_every'),
  ('Client Script', 'ref_table,script,enabled'),
  ('Comment', 'ref_table,ref_name,content'),
  ('Custom Field', 'dt,column_name,label,column_type,reference_table,choices,row_table,reqd,in_list_view'),
  ('Dashboard', 'label,config'),
  ('Data Scope', 'for_value'),
  ('Dataset Miss', 'dataset,first_seen,last_seen,hits'),
  ('Dataset Snapshot', 'dataset,state,definition_version,source_as_of,built_at,activated_at,row_count,triggered_by,error'),
  ('Email Account', 'email_id,smtp_host,smtp_port,is_default'),
  ('Email Queue', 'sender,recipient,subject,body,send_status,error,ref_table,reference_name,attachments'),
  ('Email Rule', 'ref_table,event,condition_field,condition_value,recipient,subject,message,enabled'),
  ('File', 'file_name,file_url,mime_type,file_size,is_private,ref_table,ref_name'),
  ('Has Role', 'role'),
  ('Home Page', 'label,icon,module,sequence,links,roles,shortcuts'),
  ('Home Page Link', 'label,type'),
  ('Home Page Role', 'role'),
  ('Identifier System', 'label,kind,source,match,sensitivity,normalise,edited_by,retain_after_leaving_days,enabled,storage,display,tier'),
  ('Import Conflict', 'ref_table,ref_name,field,kept,incoming,editor,edited_at,run_id,closed'),
  ('Import Log', 'ref_table,file_name,sheet_name,table_created,inserted,updated,failed,error_summary,key_column,empty_cells,part,parts,run_id,batch_id,touched,reverted_at'),
  ('Import Source', 'ref_table,ref_name,values,run_id'),
  ('Job Execution', 'job,method,attempt,outcome,error'),
  ('Letter Head', 'is_default,header_html,footer_html'),
  ('Metadata Override', 'property,value'),
  ('Notification Log', 'for_user,subject,ref_table,ref_name,read'),
  ('Permission', 'ref_table,role,tier,own_rows_only,can_read,can_write,can_create,can_delete,can_submit,can_cancel,can_amend'),
  ('Person', 'email,full_name,enabled,password_hash,language,roles'),
  ('Print Format', 'ref_table,is_default,template,letter_head'),
  ('Report', 'ref_table,config'),
  ('Role', 'disabled'),
  ('SLA Priority', 'priority,response_hours,resolution_hours'),
  ('Saved View', 'ref_table,label,filters,shared'),
  ('Scheduled Job', 'method,cadence,enabled,description,last_run_at,last_outcome,last_duration_ms'),
  ('Server Script', 'script_type,ref_table,event,api_method,script,enabled'),
  ('Service Account', 'enabled'),
  ('Service Level Agreement', 'ref_table,enabled,priority_field,escalation_role,priorities'),
  ('Share', 'share_table,share_name,read,write,share'),
  ('Sign In Method', 'kind,label,enabled,new_person,allowed_email_domains,self_link,client_id,service_url,settings'),
  ('System Settings', 'app_name,time_zone,date_format,session_hours,allow_signup'),
  ('ToDo', 'allocated_to,ref_table,reference_name,description,todo_status,priority'),
  ('Translation', 'language,source_text,translated_text'),
  ('User Event', 'kind,ref_key,label,sub_label,path,occurred_at'),
  ('Version', 'ref_table,ref_name,data'),
  ('Web Form', 'title,route,ref_table,web_fields,published,success_message'),
  ('Web Page', 'title,route,content,published'),
  ('Webhook', 'webhook_table,webhook_event,request_url,webhook_secret,enabled'),
  ('Workflow', 'ref_table,is_active,states,transitions'),
  ('Workflow Action', 'ref_table,ref_name,action,from_state,to_state,actor'),
  ('Workflow Document State', 'state,target_status'),
  ('Workflow Transition', 'state,action,next_state,allowed')
), known AS (
  SELECT parent, unnest(string_to_array(columns, ',')) AS column_name FROM baseline
), labels AS (
  SELECT parent, column_name,
    CASE
      WHEN parent = 'Sign In Method' AND column_name = 'new_person' THEN 'New Person Policy'
      WHEN parent = 'Sign In Method' AND column_name = 'self_link' THEN 'Allow Self-Linking'
      WHEN parent = 'Custom Field' AND column_name = 'dt' THEN 'Table'
      WHEN parent = 'Custom Field' AND column_name = 'reqd' THEN 'Required'
      ELSE (SELECT string_agg(CASE
        WHEN token IN ('id', 'url', 'api', 'sql', 'json', 'ip', 'smtp', 'mime', 'html', 'ms') THEN upper(token)
        ELSE initcap(token) END, ' ' ORDER BY ordinal)
        FROM unnest(string_to_array(column_name, '_')) WITH ORDINALITY AS words(token, ordinal))
    END AS label
  FROM known
)
UPDATE featherbase.column_def AS c SET label = labels.label
FROM labels, featherbase.table_def AS t
WHERE c.parent = labels.parent AND c.column_name = labels.column_name
  AND c.label = labels.column_name AND NOT c.custom
  AND t.name = c.parent AND t.system AND NOT t.custom AND t.owner_app IS NULL
  -- Translation catalogs are keyed by source; leave an installed source intact.
  AND NOT EXISTS (SELECT 1 FROM featherbase.translation AS tr WHERE tr.source_text = c.label);

-- Exact historical choices only, with no change to choices or saved rows.
-- Existing authored maps (including empty maps) always win. Overrides remain
-- separate and effective; values introduced by a choices override fall back.
WITH authored(parent, column_name, choices, labels) AS (VALUES
  ('Sign In Method', 'new_person', E'refuse\ncreate_if_email_domain_allowed\ncreate', '{"refuse":"Do not create a person","create_if_email_domain_allowed":"Create if email domain is allowed","create":"Create a person"}'),
  ('Sign In Method', 'kind', E'password\ngoogle\ndelegated_password', '{"password":"Password","google":"Google","delegated_password":"Delegated password"}'),
  ('Data Source', 'access', E'read_only\nread_write', '{"read_only":"Read only","read_write":"Read and write"}'),
  ('Email Rule', 'event', E'on_create\non_save\non_submit\non_cancel', '{"on_create":"On create","on_save":"On save","on_submit":"On submit","on_cancel":"On cancel"}'),
  ('Server Script', 'event', E'validate\nbefore_save\nafter_save', '{"validate":"Validate","before_save":"Before save","after_save":"After save"}'),
  ('Table', 'kind', E'table\nsub_table\nsettings', '{"table":"Table","sub_table":"Sub-table","settings":"Settings"}'),
  ('Webhook', 'webhook_event', E'after_insert\non_update\non_submit\non_cancel', '{"after_insert":"After insert","on_update":"On update","on_submit":"On submit","on_cancel":"On cancel"}'),
  ('Data Source', 'engine', E'postgres\nmysql\nduckdb\ncsv-folder', '{"postgres":"PostgreSQL","mysql":"MySQL","duckdb":"DuckDB","csv-folder":"CSV folder"}'),
  ('Data Source', 'conn_status', E'untested\nok\nerror', '{"untested":"Untested","ok":"Connected","error":"Error"}'),
  ('Column', 'tier', E'basic\nrestricted', '{"basic":"Basic","restricted":"Restricted"}'),
  ('Permission', 'tier', E'basic\nrestricted', '{"basic":"Basic","restricted":"Restricted"}'),
  ('Background Job', 'job_status', E'queued\nrunning\ndone\nfailed', '{"queued":"Queued","running":"Running","done":"Done","failed":"Failed"}'),
  ('Background Job', 'trigger', E'schedule\ndemand\nmanual\nretry', '{"schedule":"Scheduled","demand":"On demand","manual":"Manual","retry":"Retry"}'),
  ('Dataset Snapshot', 'state', E'building\nactive\nsuperseded\nfailed', '{"building":"Building","active":"Active","superseded":"Superseded","failed":"Failed"}'),
  ('Email Queue', 'send_status', E'queued\nsent\nerror', '{"queued":"Queued","sent":"Sent","error":"Error"}'),
  ('Identifier System', 'kind', E'employee-record\nexternal-record\nnational-id\ncontact', '{"employee-record":"Employee record","external-record":"External record","national-id":"National ID","contact":"Contact"}'),
  ('Identifier System', 'normalise', E'none\ntrim\nupper\nlower\ndigits\nindian-mobile', '{"none":"None","trim":"Trim spaces","upper":"Uppercase","lower":"Lowercase","digits":"Digits only","indian-mobile":"Indian mobile number"}'),
  ('Identifier System', 'edited_by', E'source\nsystem-manager\nreviewers\nself', '{"source":"Source","system-manager":"System Manager","reviewers":"Reviewers","self":"Self"}'),
  ('Import Log', 'empty_cells', E'keep\nclear', '{"keep":"Keep existing values","clear":"Clear existing values"}'),
  ('Job Execution', 'outcome', E'success\nerror\nrefused', '{"success":"Success","error":"Error","refused":"Refused"}'),
  ('Scheduled Job', 'last_outcome', E'success\nerror\nrefused', '{"success":"Success","error":"Error","refused":"Refused"}'),
  ('Scheduled Job', 'cadence', E'every minute\nevery 15 minutes\nhourly\nevery 4 hours\ndaily', '{"every minute":"Every minute","every 15 minutes":"Every 15 minutes","hourly":"Hourly","every 4 hours":"Every 4 hours","daily":"Daily"}'),
  ('Person', 'theme', E'light\ndark\ndevice', '{"light":"Light","dark":"Dark","device":"Use device setting"}'),
  ('User Event', 'kind', E'row\nlist\npage\nsearch', '{"row":"Row","list":"List","page":"Page","search":"Search"}'),
  ('Workflow Document State', 'target_status', E'draft\nsubmitted\ncancelled', '{"draft":"Draft","submitted":"Submitted","cancelled":"Cancelled"}')
)
UPDATE featherbase.column_def AS c SET choice_labels = authored.labels::jsonb
FROM authored, featherbase.table_def AS t
WHERE c.parent = authored.parent AND c.column_name = authored.column_name
  AND c.choices = authored.choices AND c.choice_labels IS NULL AND NOT c.custom
  AND t.name = c.parent AND t.system AND NOT t.custom AND t.owner_app IS NULL;
