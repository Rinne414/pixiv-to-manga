#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24 LTS or newer is required. Install it from https://nodejs.org/ and re-run."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run: installing dependencies (this can take a few minutes)..."
  npm install
fi

echo "Starting Pixiv-to-Manga Studio... the app will open in your browser."
echo "Keep this terminal open while you work; press Ctrl+C to stop the studio."
npm start
