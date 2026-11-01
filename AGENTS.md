# AGENTS.md — Instructions for Coding Agents in `my-office`

This repository is a customized fork of `my-office` running on Windows 11 (`win32` native) with **Claude Code** plus the **OMP (Oh My Pi) Read-Only Multi-Agent Integration** (`files` and `hybrid` modes).

---

## 1. Git Remotes & Branch Strategy

- **`origin`** (`https://github.com/lcaloi2904/my-office.git`): Owner's personal fork (push target).
- **`upstream`** (`https://github.com/khanh020905/my-office.git`): Upstream community repository (fetch/merge source only; **NEVER push to `upstream`**).
- **`main`**: Primary working and production branch containing both upstream features and the OMP integration.

---

## 2. How to Sync New Features from `upstream/main` (Without Losing OMP)

When the user asks to pull/update new features from the original repository (`upstream`):

### Step 1: Check working tree & fetch upstream
```bash
git status -s
git fetch upstream
```
*(Ensure uncommitted changes are stashed or committed before merging. Never overwrite `.gitattributes` or `data/`.)*

### Step 2: Merge `upstream/main` into `main`
```bash
git checkout main
git merge upstream/main
```
- **NEVER** run `git reset --hard upstream/main` or `git rebase upstream/main` on published history. Always use `git merge upstream/main`.

### Step 3: Conflict Resolution Rules (If Any Conflict Occurs)

1. **OMP-Exclusive Files (Always Keep Ours)**:
   - `server/agents/**` (`schema.mjs`, `registry.mjs`, `projection.mjs`, `conversation.mjs`, `claude/compat.mjs`, `omp/*`)
   - `integrations/omp/**` (`office-observer.js`, `private-storage.js`, `README.md`)
   - `src/office/ui/omp-history.js`
   - `docs/OMP-INTEGRATION.md`, `scripts/benchmark-omp.mjs`, `start-office.cmd`
   - `playwright.omp.config.ts`, `playwright.hybrid.config.ts`, `tests/unit/omp-*.test.mjs`, `tests/unit/agent-*.test.mjs`, `tests/e2e/agents.spec.ts`, `tests/e2e/omp-*.spec.ts`, `tests/fixtures/omp/**`

2. **Shared Seam Files (Keep Upstream's New Features + Preserve OMP Guards)**:
   - `server/index.mjs`: Preserve `OMP_MODE`/`ompAdapter`/`ompBridge` initialization, `agents` registry union, local-only `broadcast(msg, true)` filtering, `isClaudeRequest`/`resolveForControl` guards on `/api/open`, `/api/tasks`, `/api/accounts/*`, and OMP routes (`/api/omp/catalog`, `/api/omp/pin`, `/ingest/omp/v1`, paginated `/api/log`).
   - `src/office/people/workers.js` & `src/office/net/live.js`: Preserve `agentKind` badges (`omp`), `projectKey` grouping, stable session/child actor keys, and the 64-actor / 32-child scene cap.
   - `src/office/ui/activity.js`, `src/office/ui/lite.js`, `src/office/ui/session-drawer.js`: Preserve `unknown` rail group, OMP history picker button, read-only action banner (`capabilities`), backwards `/api/log` pagination, and nullable `metrics` (`–` instead of `0`/`NaN`).
   - `src/office/life/quota.js` & `src/office/people/accountant.js`: Preserve guards excluding `agentKind === 'omp'` and `scope === 'inherited'` from Claude quota breaks and Claude daily spend.
   - `src/shared/timeline.js` & `src/office/replay/replay.js`: Preserve `sessionKey` lane keys, per-`toolCallId` parallel tool tracking, and replay side-effect suppression.

### Step 4: Verify & Rebuild After Merge

On Windows native (`node_modules` may lack `.cmd` shims, so invoke Node entrypoints directly):

```bash
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc --noEmit
node --test tests/unit/agent-*.test.mjs tests/unit/omp-*.test.mjs tests/unit/timeline.test.mjs tests/unit/i18n.test.mjs
```

Then rebuild the production bundle used by `start-office.cmd` (or run `start-office.cmd rebuild`):
```cmd
start-office.cmd rebuild
```
And push the updated `main` to the personal fork:
```bash
git push origin main
```

---

## 3. Security & Operational Guardrails

- **Never touch real OMP credentials or sessions during tests**: Do not read, modify, or delete `~/.omp/office-private/{ingest,observer}.json`, `~/.omp/agent/extensions/office-observer/`, or `~/.omp/agent/sessions` unless explicitly instructed by the user.
- **Keep OMP read-only & loopback-only**: Never enable process kill, prompt injection, remote approvals, or non-loopback HTTP ingest for OMP.
- **Reference Docs**: See [docs/OMP-INTEGRATION.md](docs/OMP-INTEGRATION.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
