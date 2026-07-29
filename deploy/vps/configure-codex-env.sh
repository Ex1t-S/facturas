#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-/opt/fmh-deploy/app.env}"
TEMP_FILE="$(mktemp)"

grep -Ev '^(CODEX_ENGINEERING_BRIDGE_ENABLED|CODEX_ENGINEERING_BRIDGE_ALLOW_PRODUCTION|CODEX_ENGINEERING_BRIDGE_MODEL|CODEX_ENGINEERING_BRIDGE_TIMEOUT_MS|CODEX_ENGINEERING_BRIDGE_MAX_CONCURRENCY)=' "${ENV_FILE}" > "${TEMP_FILE}"

cat >> "${TEMP_FILE}" <<'EOF'
CODEX_ENGINEERING_BRIDGE_ENABLED=true
CODEX_ENGINEERING_BRIDGE_ALLOW_PRODUCTION=true
CODEX_ENGINEERING_BRIDGE_MODEL=gpt-5.6-sol
CODEX_ENGINEERING_BRIDGE_TIMEOUT_MS=120000
CODEX_ENGINEERING_BRIDGE_MAX_CONCURRENCY=1
EOF

install -m 600 "${TEMP_FILE}" "${ENV_FILE}"
rm -f "${TEMP_FILE}"

if ! grep -q '^POSTGRES_PASSWORD=' "${ENV_FILE}"; then
  python3 - "${ENV_FILE}" <<'PY'
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

env_path = Path(sys.argv[1])
lines = env_path.read_text(encoding="utf-8").splitlines()
database_url = next(
    (line.split("=", 1)[1].strip().strip('"').strip("'") for line in lines if line.startswith("DATABASE_URL=")),
    "",
)
password = unquote(urlparse(database_url).password or "")
if not password:
    raise SystemExit("DATABASE_URL no contiene una contraseña utilizable para POSTGRES_PASSWORD")
with env_path.open("a", encoding="utf-8") as env_file:
    env_file.write(f"\nPOSTGRES_PASSWORD={password}\n")
PY
  chmod 600 "${ENV_FILE}"
fi
