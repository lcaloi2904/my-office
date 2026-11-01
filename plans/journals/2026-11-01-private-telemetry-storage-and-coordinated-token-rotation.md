---
title: Private telemetry storage and coordinated token rotation
date: 2026-11-01
summary: Applied authorized ACL and token cutover; verified old-token rejection and preserved active agents
---

# Private telemetry storage and coordinated token rotation

## Authorization and outcome

User approved fixing ACL and rotating the source-bound OMP telemetry token. Moved receiver and observer credentials to ~/.omp/office-private, created protected DACLs at birth (runtime account/SYSTEM/Administrators), installed the standalone helper plus observer as a private directory package, and removed obsolete credential/single-file extension paths. No unrelated repo/data/home/.omp ACL reset; no active OMP agent stopped; provider keys/accounts unchanged.

## Durable boundary

Private storage validates ownership, Windows DACL and ancestor replacement rights, reparse/hardlinks, bounded JSON and unique exclusive same-directory temporary writes with fsync/rename. Missing source keys may provision; malformed JSON/null or invalid present tokens fail closed. Existing factories keep their old token until a fresh load; no hot reload added. Broader executable-code integrity and privileged/runtime-account compromise are outside this permission boundary.

## Evidence and failures

Full unit268/268, focused70/70, lint/typecheck and hybrid browser1/1 pass. Actual HTTP: old401/new200/missing401/Origin403/foreign-source422; public OMP controls false. New default private settings accepted from a fresh actual18.14.2 RPC process with explicit installed-directory load and no model turn. Its original45s exit criterion timed out after shutdown callback; stdin EOF then exit0, preserved as a failed clean-exit check, not reclassified. Receiver/probe ports released and original OMP parent remains running.

Earlier gate failures exposed unsafe Windows TEMP ancestry, wrong inherited build-home test environment, fixture Set-Acl SACL privilege request and native Windows open-reader rename EPERM. Fixed fixture placement/environment/DACL-only mutation and platform assertions from observed semantics; never loosened product security policy, skipped checks, retried overwrite or raised privileges. Review caught malformed-store provisioning ambiguity, reproduced then fixed with regression coverage. Independent security review reports no remaining concrete targeted findings.

## State

Report: plans/261030-1754-omp-multi-agent-integration/reports/phase-04-token-remediation.md. Owned logs contain no exact old/new telemetry value matches. G4 remains OPEN for cross-host and runtime limitations. No Phase06/rollout, external inference, commit/push or publication. AgentWiki publish skipped.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
