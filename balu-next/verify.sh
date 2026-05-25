#!/usr/bin/env bash
# verify.sh — valida que o scaffold compila e tem sanidade mínima.
# Roda: install (se preciso) → tsc → next build (se NEXT_PUBLIC_SUPABASE_URL existir).
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "→ npm install"
  npm install --silent
fi

echo "→ tsc --noEmit"
npx tsc --noEmit

if [ -f .env.local ] && grep -q "NEXT_PUBLIC_SUPABASE_URL=https" .env.local; then
  echo "→ next build (com env)"
  npx next build
else
  echo "⏭  next build pulado — preencha .env.local com NEXT_PUBLIC_SUPABASE_URL."
fi

echo "✅ verify ok"
