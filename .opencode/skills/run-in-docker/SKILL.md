---
name: run-in-docker
description: Use when running any node, npm, npx, or node-based command in this project. All node commands must be executed inside the running `meirim-dev` Docker container, not on the host machine.
---

# Run Node Commands in Docker

This project requires node commands to run inside the `meirim-dev` Docker container.

## How to run commands

The container mounts the project root at `/app`. Use `docker exec` to run any node/npm/npx command:

```
docker exec -w /app meirim-dev <command>
```

### Examples

| Instead of this (on host)            | Run this instead                                                        |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `node server/bin/api`                | `docker exec -w /app meirim-dev node server/bin/api`                |
| `npm test` (in server/)              | `docker exec -w /app meirim-dev npm run test --prefix server`      |
| `npm run lint` (in server/)          | `docker exec -w /app meirim-dev npm run lint --prefix server`      |
| `npm install` (in server/)           | `docker exec -w /app meirim-dev npm install --prefix server`       |
| `node server/bin/serve`              | `docker exec -w /app meirim-dev node server/bin/serve`             |
| `npm run crawl` (in server/)         | `docker exec -w /app meirim-dev npm run crawl --prefix server`     |
| `npm run test:integration` (in server/) | `docker exec -w /app meirim-dev npm run test:integration --prefix server` |

### Notes

- The `meirim-dev` container must already be running. If it is not, start it first with `bash docker-run.sh` from the project root.
- The working directory inside the container is `/app`, which maps to the project root. All paths are relative to the project root (e.g. `server/bin/api`, not `bin/api`).
- For commands that run inside `server/` specifically, prepend paths with `server/` (e.g. `node server/bin/api`).

### Required environment variables

The `config` npm package (`node-config`) looks for config files in a `config/` directory relative to `process.cwd()`. Since CWD inside the container is `/app` but configs live at `/app/server/config/`, **always set `NODE_CONFIG_DIR`** for any `node` command.

Many scripts also require config values that come from environment variables (see `server/config/custom-environment-variables.json`). The MariaDB container runs on the **host** machine, so from inside the `meirim-dev` container use `host.docker.internal` (on macOS) or the host's LAN IP.

Common environment variables:

| Env var | Config path | Needed for |
|---------|-------------|------------|
| `SERVER_DATABASE_HOST` | `database.connection.host` | Database connection (use `host.docker.internal` inside container) |
| `SERVER_DATABASE_USER` | `database.connection.user` | Database connection |
| `SERVER_DATABASE_PASSWORD` | `database.connection.password` | Database connection |
| `SERVER_CYPHER_SECRET` | `cypher.secret` | Encryption (many models require this at import time) |
| `SERVER_CORALOGIX_API_KEY` | `coralogix.apikey` | Metrics reporting |
| `SERVER_CORALOGIX_SERVICE_NAME` | `coralogix.serviceName` | Metrics reporting |
| `SERVER_PROXY_API_KEY` | `proxy.apiKey` | ScrapingBee proxy (HTML scraping sources) |
| `SERVER_GEOCODER_API_KEY` | `geocoder.apiKey` | Google Geocoder (address lookup fallback) |
| `SERVER_SESSION_SECRET` | `session.secret` | Web sessions |
| `SERVER_SENTRY_DSN` | `sentry_dsn` | Error reporting (optional) |

### Convenience script

Source `scripts/run-db-env.sh` to export the common environment variables, then use `docker exec` with the `--env-file` flag:

```bash
# Source the env vars
source scripts/run-db-env.sh

# Write them to a temp file for docker exec
env | grep ^SERVER_ > /tmp/meirim-env
echo "NODE_CONFIG_DIR=/app/server/config" >> /tmp/meirim-env

# Run any command
docker exec --env-file /tmp/meirim-env -w /app meirim-dev node server/bin/iplan
```

Or as a one-liner:

```bash
source scripts/run-db-env.sh && docker exec $(env | awk '/^(NODE_CONFIG_DIR|SERVER_)/{printf " -e %s", $0}') -w /app meirim-dev node server/bin/iplan
```

**Full example** — iplan crawl:

```
docker exec \
  -e NODE_CONFIG_DIR=/app/server/config \
  -e SERVER_DATABASE_HOST=host.docker.internal \
  -e SERVER_DATABASE_USER=root \
  -e SERVER_DATABASE_PASSWORD=password \
  -e SERVER_CYPHER_SECRET=abc \
  -e SERVER_CORALOGIX_API_KEY=abc \
  -e SERVER_CORALOGIX_SERVICE_NAME=dev \
  -e SERVER_PROXY_API_KEY= \
  -e SERVER_GEOCODER_API_KEY= \
  -w /app \
  meirim-dev node server/bin/iplan
```


docker exec -it \
  -e NODE_CONFIG_DIR=/app/server/config \
  -e NODE_OPTIONS=--openssl-legacy-provider \
  -e SERVER_CORALOGIX_API_KEY=abc \
  -e SERVER_CORALOGIX_SERVICE_NAME=dev \
  -e SERVER_CYPHER_SECRET=abc \
  -e SERVER_DATABASE_HOST=host.docker.internal \
  -e SERVER_DATABASE_PASSWORD=password \
  -e SERVER_DATABASE_USER=root \
  -e SERVER_GEOCODER_API_KEY= \
  -e SERVER_PROXY_API_KEY= \
  -e SERVER_SENTRY_DSN= \
  -e SERVER_SESSION_SECRET=dev-secret \
  -e NODE_CONFIG_DIR=/app/client/config \
  meirim-dev bash