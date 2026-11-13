-- Runs once, when the Postgres volume is first initialised.
-- Integration tests use this separate database so they never touch dev data.
CREATE DATABASE deviceflow_test;
