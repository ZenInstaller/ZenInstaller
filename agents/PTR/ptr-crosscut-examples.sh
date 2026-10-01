#!/bin/bash
# Cross-cutting queries on reviewManifest.jsonl
# These patterns extract specific fields across all components without truncation.
# Output formats (TSV/CSV) are short enough to avoid line-length issues.
#
# Each function demonstrates a different cross-cutting analysis use case.

set -e

MANIFEST="agents/PTR/reviewManifest.jsonl"

# Validate manifest exists
if [ ! -f "$MANIFEST" ]; then
  echo "Error: Manifest not found at $MANIFEST"
  exit 1
fi

echo "Cross-cutting analysis on reviewManifest.jsonl"
echo "=============================================="
echo ""

# 1. All mock-test findings, flattened (one finding per line)
# Useful for: aggregating all findings, creating a findings report
echo "1. All mock-test findings (component | finding):"
echo "---"
jq -r 'select(.mockTest.findings != null)
       | .component.path as $c
       | .mockTest.findings[]
       | [$c, .] | @tsv' "$MANIFEST" | head -20
echo ""

# 2. Coverage gap report: which components lack tests
# Useful for: identifying untested components, prioritizing test creation
echo "2. Coverage gap report (component | integration test | mock test):"
echo "---"
jq -r '[.component.path,
        (.integrationTest.path // "MISSING"),
        (.mockTest.path // "MISSING")] | @csv' "$MANIFEST" | head -20
echo ""

# 3. Compact index: path + hash + timestamp only
# Useful for: staleness checks, quick lookups, diff analysis
echo "3. Compact index (for staleness/freshness checks):"
echo "---"
jq -c '{path: .component.path, hash: .component.gitHash, reviewedAt: .component.reviewTimestamp}' \
  "$MANIFEST" | head -10
echo ""

# 4. Finding counts per component
# Useful for: identifying heavily-reviewed components, test health metrics
echo "4. Finding counts (component | integration test findings | mock test findings):"
echo "---"
jq -r '[.component.path,
        ((.integrationTest.findings // []) | length),
        ((.mockTest.findings // []) | length)] | @tsv' "$MANIFEST" | head -20
echo ""

# 5. Components with no tests at all
# Useful for: identifying gaps in test coverage
echo "5. Components with no tests (integration path is null and mock path is null):"
echo "---"
jq -r 'select(.integrationTest.path == null and .mockTest.path == null)
       | .component.path' "$MANIFEST"
echo ""

# 6. Components with findings
# Useful for: identifying components that need attention
echo "6. Components with findings (component | test type | finding count):"
echo "---"
jq -r 'if (.integrationTest.findings | length) > 0 then
         [.component.path, "integration", (.integrationTest.findings | length)] | @tsv
       else empty end' "$MANIFEST" | head -10
echo ""

echo "=============================================="
echo "Tip: Pipe these outputs to 'sort', 'uniq -c', or 'awk' for further analysis."
echo "Tip: For a single component, use ptr-get-component.sh instead."
