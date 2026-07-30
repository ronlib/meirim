#!/usr/bin/env bash
set -e

CONTAINER_NAME="meirim-mariadb"
MYSQL_ROOT_PASSWORD="password"
MYSQL_PORT="3306"
DB_NAME="meirim"

if ! docker ps --format '{{.Names}}' | grep -q "^$CONTAINER_NAME$"; then
  echo "Container '$CONTAINER_NAME' is not running."
  if docker ps -a --format '{{.Names}}' | grep -q "^$CONTAINER_NAME$"; then
    echo "Starting existing container..."
    docker start "$CONTAINER_NAME"
  else
    echo "Creating container '$CONTAINER_NAME'..."
    docker run -d \
      --name "$CONTAINER_NAME" \
      -p "$MYSQL_PORT:3306" \
      -e MYSQL_ROOT_PASSWORD="$MYSQL_ROOT_PASSWORD" \
      mariadb:10.11
  fi

  echo "Waiting for MySQL to be ready..."
  for i in {1..30}; do
    if docker exec "$CONTAINER_NAME" mysqladmin ping -uroot -p"$MYSQL_ROOT_PASSWORD" --silent 2>/dev/null; then
      break
    fi
    sleep 1
  done
fi

echo "Dropping database '$DB_NAME'..."
docker exec "$CONTAINER_NAME" mysql -uroot -p"$MYSQL_ROOT_PASSWORD" \
  -e "DROP DATABASE IF EXISTS \`$DB_NAME\`;" 2>/dev/null

echo "Recreating database '$DB_NAME'..."
docker exec "$CONTAINER_NAME" mysql -uroot -p"$MYSQL_ROOT_PASSWORD" \
  -e "CREATE DATABASE \`$DB_NAME\` character set UTF8 collate utf8_bin; SET GLOBAL sql_mode=(SELECT REPLACE(@@sql_mode,'ONLY_FULL_GROUP_BY,',''));" 2>/dev/null

echo "Database '$DB_NAME' has been cleared."

if [ "${1:-}" = "--migrate" ]; then
  echo "Running migrations..."
  docker exec -w /app meirim-dev \
    -e NODE_CONFIG_DIR=/app/server/config \
    -e SERVER_DATABASE_HOST=host.docker.internal \
    -e SERVER_DATABASE_USER=root \
    -e SERVER_DATABASE_PASSWORD="$MYSQL_ROOT_PASSWORD" \
    -e SERVER_CYPHER_SECRET=abc \
    npx knex migrate:latest --knexfile server/knexfile.js
  echo "Migrations complete."
fi
