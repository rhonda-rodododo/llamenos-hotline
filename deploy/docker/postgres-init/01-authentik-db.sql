-- Create Authentik database on first PostgreSQL startup.
-- The llamenos database is created via POSTGRES_DB in docker-compose;
-- this script creates the additional authentik database in the same cluster.
SELECT 'CREATE DATABASE authentik'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'authentik')\gexec
