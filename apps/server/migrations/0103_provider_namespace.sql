-- @spec provider_configuration_is_an_authentication_boundary
-- Two configuration rows must not split ownership for the very same OAuth client.
alter table featherbase.login_provider add constraint login_provider_namespace unique (kind, issuer, client_id);
