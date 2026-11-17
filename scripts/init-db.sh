#!/bin/sh
# Runs once, when the Postgres volume is first created. Creates the three least-privilege roles
# (passwords from env, never hard-coded) and applies the permission rules in 00_roles.sql.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner_pw="$OWNER_DB_PASSWORD" -v app_pw="$APP_DB_PASSWORD" -v ro_pw="$READONLY_DB_PASSWORD" <<'SQL'
CREATE ROLE trendscope_owner LOGIN PASSWORD :'owner_pw';
CREATE ROLE trendscope_app LOGIN PASSWORD :'app_pw';
CREATE ROLE trendscope_readonly LOGIN PASSWORD :'ro_pw';
ALTER DATABASE trendscope OWNER TO trendscope_owner;
REVOKE ALL ON DATABASE trendscope FROM PUBLIC;
GRANT CONNECT ON DATABASE trendscope TO trendscope_owner, trendscope_app, trendscope_readonly;
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -f /docker-entrypoint-initdb.d/sql/00_roles.sql
