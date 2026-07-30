#!/usr/bin/env bash
set -e

IMAGE="node:18"
CONTAINER_NAME="meirim-dev"
WORKDIR="/app"

# Ports: client (3000), api (3001), serve (80)
PORTS="-p 3000:3000 -p 3001:3001 -p 80:80"

# Mount the project root so changes are reflected live
MOUNTS="-v $(pwd):$WORKDIR -w $WORKDIR"

# Check if container already exists
if docker ps -a --format '{{.Names}}' | grep -q "^$CONTAINER_NAME$"; then
  if docker ps --format '{{.Names}}' | grep -q "^$CONTAINER_NAME$"; then
    echo "Container '$CONTAINER_NAME' is already running. Attaching..."
    docker exec -it "$CONTAINER_NAME" /bin/bash
  else
    echo "Container '$CONTAINER_NAME' exists but is stopped. Starting..."
    docker start -ai "$CONTAINER_NAME"
  fi
else
  echo "Creating and starting container '$CONTAINER_NAME'..."
  docker run -it --name "$CONTAINER_NAME" $PORTS $MOUNTS "$IMAGE" /bin/bash
fi
