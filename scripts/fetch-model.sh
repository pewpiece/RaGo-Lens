#!/usr/bin/env bash
# Downloads the bundled ONNX segmentation model, verifies its SHA-256 and places it in
# app/assets/models/. Safe to re-run: an already-verified file is kept.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=model.env
source "$here/model.env"
dest_dir="$here/../app/assets/models"
dest="$dest_dir/$MODEL_NAME"
mkdir -p "$dest_dir"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

if [[ -f "$dest" && "$(sha256_of "$dest")" == "$MODEL_SHA256" ]]; then
  echo "Model already present and verified: $dest"
  exit 0
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
echo "Downloading $MODEL_URL"
if ! curl --fail --location --silent --show-error --retry 3 --output "$tmp" "$MODEL_URL"; then
  echo "ERROR: download failed. Place $MODEL_NAME (sha256 $MODEL_SHA256) in $dest_dir manually," >&2
  echo "       or build with the MockEngine only (see DECISIONS.md / WEAKNESSES.md)." >&2
  exit 1
fi

actual="$(sha256_of "$tmp")"
if [[ "$actual" != "$MODEL_SHA256" ]]; then
  echo "ERROR: SHA-256 mismatch for $MODEL_NAME" >&2
  echo "  expected $MODEL_SHA256" >&2
  echo "  actual   $actual" >&2
  exit 2
fi

mv "$tmp" "$dest"
trap - EXIT
echo "OK: $dest ($(wc -c <"$dest") bytes, sha256 verified)"
