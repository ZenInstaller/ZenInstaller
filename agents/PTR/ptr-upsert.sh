#!/bin/bash
# Safe upsert for reviewManifest.jsonl
# Replaces any prior review of a component, or appends a new one.
# Maintains JSONL format and guarantees max one record per component.
#
# Usage:
#   ./ptr-upsert.sh "web/corp-src/cards/RepoDetail.tsx" review.json
#
# Arguments:
#   $1 = Component path (required) — identifies which record to replace
#   $2 = Input review file (required) — path to the new review (single JSON object, not JSONL)
#
# Environment:
#   MANIFEST = Path to reviewManifest.jsonl (defaults to agents/PTR/reviewManifest.jsonl)
#
# How it works:
#   1. Filter out any existing record for the component
#   2. Append the new review record (converted to JSONL format)
#   3. Replace the original manifest atomically
#   4. Validate the result
#
# Example:
#   # After updating /tmp/ptr-current.json with new findings:
#   ./ptr-upsert.sh "web/corp-src/cards/AzureLoginCard.tsx" /tmp/ptr-current.json

set -e

COMPONENT="$1"
NEW_REVIEW="$2"
MANIFEST="${MANIFEST:=agents/PTR/reviewManifest.jsonl}"

if [ -z "$COMPONENT" ] || [ -z "$NEW_REVIEW" ]; then
  echo "Error: Component path and input review file required"
  echo "Usage: $0 <component-path> <review-file>"
  exit 1
fi

if [ ! -f "$NEW_REVIEW" ]; then
  echo "Error: Input review file not found: $NEW_REVIEW"
  exit 1
fi

if [ ! -f "$MANIFEST" ]; then
  echo "Error: Manifest not found: $MANIFEST"
  exit 1
fi

# Create a temporary file for the filtered manifest
tmp=$(mktemp)
trap "rm -f '$tmp'" EXIT

echo "Upserting review for: $COMPONENT"
echo "Source: $NEW_REVIEW"
echo ""

# Step 1: Filter out any prior review of this component
echo "Step 1: Filtering out prior reviews..."
jq -c --arg p "$COMPONENT" 'select(.component.path != $p)' \
  "$MANIFEST" > "$tmp"
PRIOR_COUNT=$(grep -c "\"path\":\"$(echo "$COMPONENT" | sed 's/"/\\"/g')\"" "$MANIFEST" || true)
if [ "$PRIOR_COUNT" -gt 0 ]; then
  echo "  ✓ Removed $PRIOR_COUNT prior review(s)"
fi

# Step 2: Append the new review (convert to JSONL format with -c)
echo "Step 2: Appending new review..."
jq -c . "$NEW_REVIEW" >> "$tmp"
echo "  ✓ Review appended"

# Step 3: Validate the result
echo "Step 3: Validating..."
if ! jq -e . "$tmp" > /dev/null 2>&1; then
  echo "  ✗ Validation failed — manifest is corrupted"
  echo "  Original manifest preserved"
  exit 1
fi
echo "  ✓ All records are valid JSON"

# Step 4: Replace the original manifest atomically
echo "Step 4: Finalizing..."
mv "$tmp" "$MANIFEST"
echo "  ✓ Manifest updated"

echo ""
echo "✓ Upsert complete"
echo ""
echo "New record preview:"
jq -c --arg p "$COMPONENT" 'select(.component.path == $p)' "$MANIFEST" | jq .

echo ""
echo "Manifest health check:"
total_records=$(jq -c . "$MANIFEST" | wc -l)
echo "  Total records: $total_records"
echo "  File size: $(du -h "$MANIFEST" | cut -f1)"
