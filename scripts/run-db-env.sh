#!/usr/bin/env bash
# Environment variables for running node commands inside the meirim-dev container.
# Source this file, then use docker exec with --env-file or individual -e flags.
#
# Usage:
#   source scripts/run-db-env.sh
#
#   docker exec $(env | grep ^SERVER_ | sed 's/^/-e /' | paste -sd ' ' -) \
#     -w /app meirim-dev node server/bin/iplan
#
# Or with a one-liner (bash):
#   source scripts/run-db-env.sh && docker exec $(env | awk '/^SERVER_/{printf " -e %s", $0}') -w /app meirim-dev node server/bin/iplan

export NODE_CONFIG_DIR=/app/server/config

export SERVER_DATABASE_HOST=host.docker.internal
export SERVER_DATABASE_USER=root
export SERVER_DATABASE_PASSWORD=password

export SERVER_CYPHER_SECRET=abc
export SERVER_CORALOGIX_API_KEY=abc
export SERVER_CORALOGIX_SERVICE_NAME=dev

export SERVER_SESSION_SECRET=dev-secret

export SERVER_SENTRY_DSN=

export SERVER_PROXY_API_KEY=
export SERVER_GEOCODER_API_KEY=
