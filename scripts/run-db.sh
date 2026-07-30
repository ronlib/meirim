#!/usr/bin/env bash
set -e

CONTAINER_NAME="meirim-mariadb"
MYSQL_ROOT_PASSWORD="password"
MYSQL_PORT="3306"
DB_NAME="meirim"

export SERVER_DATABASE_HOST="127.0.0.1"
export SERVER_DATABASE_USER="root"
export SERVER_DATABASE_PASSWORD="$MYSQL_ROOT_PASSWORD"
export SERVER_PROXY_API_KEY=""
export SERVER_GEOCODER_API_KEY=""

if docker ps -a --format '{{.Names}}' | grep -q "^$CONTAINER_NAME$"; then
  if docker ps --format '{{.Names}}' | grep -q "^$CONTAINER_NAME$"; then
    echo "Container '$CONTAINER_NAME' is already running."
  else
    echo "Container '$CONTAINER_NAME' exists but is stopped. Starting..."
    docker start "$CONTAINER_NAME"
  fi
else
  echo "Creating MySQL 5.7 container '$CONTAINER_NAME'..."
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

echo "Ensuring database '$DB_NAME' exists..."
docker exec "$CONTAINER_NAME" mysql -uroot -p"$MYSQL_ROOT_PASSWORD" \
  -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` character set UTF8 collate utf8_bin; SET GLOBAL sql_mode=(SELECT REPLACE(@@sql_mode,'ONLY_FULL_GROUP_BY,',''));" 2>/dev/null

echo "Database '$DB_NAME' is ready on port $MYSQL_PORT."
echo "Connection: user=root, password=$MYSQL_ROOT_PASSWORD, database=$DB_NAME, host=localhost, port=$MYSQL_PORT"
echo ""
echo "To export env vars in your shell, run:"
echo "  export SERVER_DATABASE_HOST=$SERVER_DATABASE_HOST"
echo "  export SERVER_DATABASE_USER=$SERVER_DATABASE_USER"
echo "  export SERVER_DATABASE_PASSWORD=$SERVER_DATABASE_PASSWORD"
echo "  export SERVER_PROXY_API_KEY=$SERVER_PROXY_API_KEY"
echo "  export SERVER_GEOCODER_API_KEY=$SERVER_GEOCODER_API_KEY"
echo ""
echo "To run migrations: cd server && npx knex migrate:latest"
