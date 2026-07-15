#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/root/xme-mail"
cd "$APP_DIR"

# Load nvm node if present
export NVM_DIR="${NVM_DIR:-/root/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  nvm use default >/dev/null 2>&1 || true
fi

export PATH="/root/.nvm/versions/node/v24.16.0/bin:$PATH"
export NODE_ENV=production
export PORT="${PORT:-3110}"

# Ensure env exists
if [ ! -f "$APP_DIR/.env" ]; then
  echo "Missing $APP_DIR/.env" >&2
  exit 1
fi

# Load .env into environment for Next/Prisma
set -a
# shellcheck disable=SC1091
. "$APP_DIR/.env"
set +a

export DATABASE_URL="${DATABASE_URL:-file:./dev.db}"

echo "[xme-mail] prisma generate/migrate + seed"
npx prisma generate
npx prisma migrate deploy
npx tsx prisma/seed.ts

if [ ! -d "$APP_DIR/.next" ]; then
  echo "[xme-mail] building Next.js app..."
  npm run build
fi

echo "[xme-mail] starting on :$PORT"
exec npm run start
