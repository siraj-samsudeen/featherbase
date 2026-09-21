-- A runtime application with its own client owns its normal navigation.
-- Remove the generic Table links created by the pre-runtime app installer;
-- administrators can still reach the underlying Tables through All tables.
create temporary table runtime_client_home_pages on commit drop as
select distinct link.parent
from home_page_link link
join table_def table_metadata on table_metadata.name = link.link_to
join installed_app application on application.name = table_metadata.owner_app
where application.runtime_package = true
  and nullif(application.manifest->>'client', '') is not null;

delete from home_page_link link
using table_def table_metadata, installed_app application
where link.link_to = table_metadata.name
  and application.name = table_metadata.owner_app
  and application.runtime_package = true
  and nullif(application.manifest->>'client', '') is not null;

delete from home_page page
using runtime_client_home_pages affected
where page.row_id = affected.parent
  and not exists (
    select 1 from home_page_link remaining where remaining.parent = page.row_id
  )
  and coalesce(page.shortcuts, '[]'::jsonb) = '[]'::jsonb;
