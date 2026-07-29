#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_DIR="/opt/fmh-gestion"
DEPLOY_DIR="/opt/fmh-deploy"
COMPOSE_FILE="${DEPLOY_DIR}/docker-compose.yml"
ENV_FILE="${DEPLOY_DIR}/app.env"

cd "${REPOSITORY_DIR}"
git pull --ff-only origin main

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" build fmh-app
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d fmh-postgres
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" run --rm --no-deps fmh-app npx prisma migrate deploy
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps
