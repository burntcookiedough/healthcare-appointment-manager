# Continuous integration

[`ci.yml`](ci.yml) runs the frozen JavaScript workspace checks and the two Python
application checks on pushes and pull requests. It uses Node 24, pnpm 11.23.0, Python
3.13, and `uv sync --locked`; no provider credentials or hosted services are used.

The API PostgreSQL/concurrency suite remains a local or separately provisioned isolated
database check because CI does not create a database. The workflow must stay aligned
with the root scripts and each application's lockfile.
