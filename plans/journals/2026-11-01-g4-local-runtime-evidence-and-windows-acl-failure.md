---
title: G4 local runtime evidence and Windows ACL failure
date: 2026-11-01
summary: Verified actual TUI mappings; token ACL policy fails and G4 remains open
---

# G4 local runtime evidence and Windows ACL failure

## What happened

Verified remaining local G4 runtime scenarios using actual installed OMP 18.14.2 in a disposable Windows TUI and a scripted loopback model. The installed observer matches repository bytes. Real built-in read/message/shutdown callbacks, manual native plan-review request/resolution and waiting/input to idle projection were captured. A dedicated ask dialog completed; Office stayed active without an exact input-wait reason. A real task child completed with correct parent identity but was deliberately excluded from telemetry.

## Failure evidence and limits

Read-only Get-Acl confirmed the token privacy policy fails: ingress token inherits Users read and Authenticated Users Modify; observer settings inherit additional principals including CodexSandboxUsers. No secret value, cross-account read or exploitation was involved. No ACL/config/token mutation was authorized or made. Safe remediation must protect storage/temp/replacement lifecycle, then rotate telemetry token together, not merely chmod a Windows file.

The plan overlay resolved execute/local rather than intended cancellation; callback mapping passed but execution continuation did not. Fixture rejected 15 unexpected-marker requests (3 before review, 12 after selection). The old continuation overlapped a fresh ask session; accepted ask evidence is scoped to its distinct session/call. No cancellation or comprehensive workflow pass is claimed. Fixture setup initially had an incorrect relative import, corrected after counsel. No fake-pi callbacks or broadened model guard.

## Outcome

G4 remains OPEN: local R10 partial, exact ask wait/live children unsupported, ACL FAIL, cross-host NOT RUN. Product source unchanged; no unit/build run claimed as new evidence. All owned OMP processes/listener stopped, disposable source scaffolds removed, metadata evidence retained under ignored test-results-phase5/g4-local. Report: plans/261030-1754-omp-multi-agent-integration/reports/phase-04-local-validation.md. Next action needs approval for private-storage/ACL remediation and coordinated token rotation. No Phase06, rollout, billable provider inference, commit/push or publication. AgentWiki publish skipped.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
