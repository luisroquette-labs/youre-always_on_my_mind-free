#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/luisroquette-labs/youre-always_on_my_mind-free.git"
TARGET="${YOURE_ALWAYS_ON_MY_MIND_HOME:-${HOME}/.local/share/youre-always-on-my-mind}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22+ is required. Install it from https://nodejs.org and run this again." >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ "${NODE_MAJOR}" -lt 22 ]]; then
  echo "Node.js 22+ is required. Current version: $(node -v)" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required." >&2
  exit 1
fi

SOURCE=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  CANDIDATE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  if [[ -f "${CANDIDATE}/package.json" ]]; then
    SOURCE="${CANDIDATE}"
  fi
fi

if [[ -z "${SOURCE}" ]]; then
  if ! command -v git >/dev/null 2>&1; then
    echo "git is required to clone the repository." >&2
    exit 1
  fi
  mkdir -p "$(dirname "${TARGET}")"
  if [[ -d "${TARGET}/.git" ]]; then
    git -C "${TARGET}" pull --ff-only origin main
  else
    git clone --depth 1 "${REPO_URL}" "${TARGET}"
  fi
  SOURCE="${TARGET}"
fi

cd "${SOURCE}"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

echo "You're Always on My Mind is a local cockpit for claude-mem."
echo "It does not replace the claude-mem viewer, and it is not affiliated with claude-mem."
if [[ ! -f "${HOME}/.claude-mem/claude-mem.db" && " $* " != *" --demo "* && -z "${YOURE_ALWAYS_ON_MY_MIND_DATABASE_PATH:-}" ]]; then
  echo "No claude-mem database found at ~/.claude-mem/claude-mem.db."
  echo "Opening fictional demo data. Re-run after claude-mem has created a database to use your own memory."
  set -- --demo "$@"
fi

exec node "${SOURCE}/bin/youre-always-on-my-mind.mjs" "$@"
