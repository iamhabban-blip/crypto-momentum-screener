-- Least-privilege roles. Run once by the Postgres superuser (docker does this automatically via
-- scripts/init-db.sh). Passwords come from environment variables, never from this file.
--
--   trendscope_owner     owns the schema; used ONLY by migrations (DDL rights)
--   trendscope_app       used by the API and worker: read/write data, no DDL, audit log insert-only
--   trendscope_readonly  SELECT only: backups, analytics, support debugging

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO trendscope_owner;
GRANT USAGE ON SCHEMA public TO trendscope_app, trendscope_readonly;

ALTER DEFAULT PRIVILEGES FOR ROLE trendscope_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO trendscope_app;
ALTER DEFAULT PRIVILEGES FOR ROLE trendscope_owner IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO trendscope_app;
ALTER DEFAULT PRIVILEGES FOR ROLE trendscope_owner IN SCHEMA public
    GRANT SELECT ON TABLES TO trendscope_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE trendscope_owner IN SCHEMA public
    GRANT SELECT ON SEQUENCES TO trendscope_readonly;

-- Guard rails for the application role
ALTER ROLE trendscope_app SET statement_timeout = '15s';
ALTER ROLE trendscope_app SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE trendscope_app CONNECTION LIMIT 40;
ALTER ROLE trendscope_readonly SET default_transaction_read_only = on;
