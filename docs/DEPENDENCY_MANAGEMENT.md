# Dependency management

This repository currently has two JavaScript manifests with different roles:

- Root `package.json` declares dependencies for the root service utilities/tests. Its legacy launch scripts also reference absent root index/worker files; this manifest is not evidence of a working second deployment.
- `backend/package.json` owns the Express/Nest backend, workers and its Jest/Playwright tools.

They have different entry points, dependency sets and SDK versions. Consolidating
them without an application migration would change runtime resolution, so each
keeps its own manifest and lockfile. `legacy_cleanup/` is retained historical
code, not an additional deployment package covered by this CI gate. Rust crates
continue using their Cargo manifests/lockfiles.

Use `npm ci` at each package directory for repeatable installs. Change a declared
dependency in that directory and regenerate its lock with
`npm install --package-lock-only --ignore-scripts`. Commit both manifest and lock
for review. Never run `npm install` during a validation step to silently repair
an inconsistent committed lock. Keep lifecycle scripts disabled for metadata-only
operations. Application builds/tests remain separate.

Compatible caret ranges are the default policy for npm dependencies, as used in
both current manifests. Use exact versions only for a documented compatibility
exception. The audit enforces exact `x.y.z` or caret `^x.y.z` registry specs,
including valid prerelease/build versions, across dependencies, development,
optional and peer dependencies. Tags, wildcards, tilde/comparator ranges and
remote URL/git specs fail the audit even when the manifest and lock agree.
Local `file:`, `link:` and `workspace:` references remain supported.
A major upgrade requires an explicit source/lock change and review;
`npm ci` always uses the committed exact resolved graph regardless of the allowed
manifest range. Environment/engine constraints are not dependency ranges.

The Dependency Audit workflow checks both packages. Manifest declaration drift
or invalid npm lock resolution fails the job; it does not rewrite the lock.
Run `node scripts/dependency-audit.cjs root` and
`node scripts/dependency-audit.cjs backend` locally for the same checks.
`scripts/dependency-audit.cjs` emits JSON/Markdown inventory of locked packages,
deprecation metadata and license expressions. GPL/AGPL expressions, dual licenses
and missing license metadata are review alerts, not automatic blockers or a claim
that every dependency is legally compatible. Deprecated dependencies should be
replaced in separate behavior-reviewed changes, not upgraded automatically here.
`npm outdated` reports current/wanted/latest versions and a count as informational
metadata. Registry lookup failures are explicitly unavailable, not zero outdated
packages. Reports are retained as CI artifacts for 14 days.

The newly established root lockfile is generated from the existing root manifest;
the unused root Apollo Server 3 Express adapter declaration is removed because
its Express 4-only peer range conflicts with the existing root Express 5 range.
The unused root BullMQ declaration is also removed: its current compatible-range
resolution requires Redis >=5 while the root declares Redis 4. No root source
imports either removed package; the real backend retains its Express 4
adapter and dependencies unchanged. This change does not consolidate applications
or upgrade backend dependencies.

The backend retains its existing `legacy-peer-deps` npm configuration: its current BullMQ/Redis peer mismatch is not repaired by this inventory change. The backend lock now includes the previously omitted declared `joi` and `winston` dependencies and their 30-package dependency trees; existing package versions are unchanged.
