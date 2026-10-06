#!/usr/bin/env bash
# Validates .github/ISSUE_TEMPLATE: required templates exist, parse as YAML,
# and issue forms carry the minimum fields GitHub needs (name + body).
set -euo pipefail

cd "$(dirname "$0")/.."
dir=".github/ISSUE_TEMPLATE"

required=(bug_report feature_request technical_debt config)
missing=0
for name in "${required[@]}"; do
	if [[ ! -f "$dir/$name.yml" ]]; then
		echo "missing required template: $dir/$name.yml" >&2
		missing=1
	fi
done
[[ $missing -eq 0 ]] || exit 1

# Issue forms are only usable when they declare a name and a body.
for name in bug_report feature_request technical_debt; do
	for key in name body; do
		if ! grep -q "^$key:" "$dir/$name.yml"; then
			echo "$dir/$name.yml: missing required '$key' field" >&2
			exit 1
		fi
	done
done

shopt -s nullglob
files=("$dir"/*.yml)
if [[ ${#files[@]} -eq 0 ]]; then
	echo "no template files found under $dir" >&2
	exit 1
fi

for f in "${files[@]}"; do
	if ! npx --yes js-yaml@4 "$f" > /dev/null; then
		echo "invalid YAML: $f" >&2
		exit 1
	fi
done

echo "Validated ${#files[@]} issue template file(s) under $dir"
