-- person-rename (#275): a service-account name names one account, ignoring
-- case — held by the database, so two concurrent creates cannot both pass
-- (Codex review on #384). Its own file so a database that already ran 0101
-- converges.
create unique index if not exists service_account_label_lower_uq on service_account (lower(label));
