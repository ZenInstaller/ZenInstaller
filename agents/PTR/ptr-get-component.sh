#!/bin/bash
# Extract a single component's review record and expand it to readable multi-line JSON
# This avoids line truncation issues when working with individual JSONL entries.
#
# Usage:
#   ./ptr-get-component.sh "web/corp-src/cards/RepoDetail.tsx"
#   ./ptr-get-component.sh "web/corp-src/cards/RepoDetail.tsx" /path/to/output.json
#
# Arguments:
#   $1 = Component path (required) — must match the component.path field exactly
#   $2 = Output file (optional) — defaults to /tmp/ptr-current.json
#
# Examples:
#   # Extract to default temp file, then edit and review
#   ./ptr-get-component.sh "web/corp-src/cards/AzureLoginCard.tsx"
#   cat /tmp/ptr-current.json
#
#   # Save to a specific location for later processing
#   ./ptr-get-component.sh "web/corp-src/cards/CoreInfraCard.tsx" ./my-review.json

set -e

COMPONENT="$1"
OUTPUT="${2:=/tmp/ptr-current.json}"

if [ -z "$COMPONENT" ]; then
  echo "Error: Component path required"
  echo "Usage: $0 <component-path> [output-file]"
  exit 1
fi

# Extract one component's record and expand it to readable multi-line JSON
# Using -s to slurp all records, then filter and select the matching one
jq -s \
  'map(select(.component.path == $p)) | .[0]' \
  --arg p "$COMPONENT" \
  agents/PTR/reviewManifest.jsonl > "$OUTPUT"

if [ -s "$OUTPUT" ] && [ "$(cat "$OUTPUT")" != "null" ]; then
  echo "✓ Extracted review for: $COMPONENT"
  echo "  Output: $OUTPUT"
  echo ""
  echo "Record preview:"
  jq . "$OUTPUT" | head -20
else
  echo "✗ No review found for: $COMPONENT"
  rm -f "$OUTPUT"
  exit 1
fi
