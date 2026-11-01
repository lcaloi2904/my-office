import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAccountKeyer,
  normalizeOmpProfile,
  normalizeOmpUsagePayload,
  normalizeUsageWindow,
  projectOmpUsageSnapshot,
} from '../../server/agents/omp/usage-accounts.mjs';

const NOW = 1_762_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

test('S2: normalizeOmpProfile enforces OMP profile syntax and rejects traversal or Windows device names', () => {
  assert.deepEqual(normalizeOmpProfile(undefined), { valid: true, profile: 'default', cliProfile: null });
  assert.deepEqual(normalizeOmpProfile(''), { valid: true, profile: 'default', cliProfile: null });
  assert.deepEqual(normalizeOmpProfile('  default '), { valid: true, profile: 'default', cliProfile: null });
  assert.deepEqual(normalizeOmpProfile('work-2.team_a'), { valid: true, profile: 'work-2.team_a', cliProfile: 'work-2.team_a' });

  for (const bad of ['.', '..', 'work.', '-bad', 'Upper', 'a/b', 'a\\b', 'con', 'NUL.txt', 'com1', 'lpt9.json', 'a'.repeat(65), 123]) {
    assert.equal(normalizeOmpProfile(bad).valid, false, `expected profile ${String(bad)} to be rejected`);
  }
});

test('S3: multi-account Codex and Antigravity produce distinct keyed accountKeys, full local labels, and profile isolation', () => {
  const keyer = createAccountKeyer({ secret: 'synthetic-test-hmac-secret-32-bytes' });
  const rawPayload = {
    generatedAt: NOW,
    reports: [
      {
        provider: 'openai-codex',
        fetchedAt: NOW - 5_000,
        limits: [
          {
            id: 'openai-codex:primary',
            label: '5 hours',
            scope: { provider: 'openai-codex', windowId: '5h', shared: true },
            window: { id: '5h', label: '5 hours', durationMs: 5 * HOUR, resetsAt: NOW + 2 * HOUR },
            amount: { unit: 'percent', used: 35, limit: 100, remaining: 65, usedFraction: 0.35, remainingFraction: 0.65 },
            status: 'ok',
          },
          {
            id: 'openai-codex:secondary',
            label: '7 days',
            scope: { provider: 'openai-codex', windowId: '7d', shared: true },
            window: { id: '7d', label: '7 days', durationMs: 7 * DAY, resetsAt: NOW + 4 * DAY },
            amount: { unit: 'percent', used: 82, limit: 100, remaining: 18, usedFraction: 0.82, remainingFraction: 0.18 },
            status: 'warning',
          },
        ],
        metadata: {
          email: 'dev.owner@example.test',
          accountId: 'acct-codex-personal',
          orgId: 'org-personal',
          planType: 'pro',
        },
        raw: { secretToken: 'Bearer sk-live-1234567890abcdefghijklmnop' },
      },
      {
        // Same email, different workspace/orgId: MUST NOT be merged with the first account!
        provider: 'openai-codex',
        fetchedAt: NOW - 3_000,
        limits: [
          {
            id: 'openai-codex:primary',
            label: '5 hours',
            scope: { provider: 'openai-codex', windowId: '5h', shared: true },
            window: { id: '5h', label: '5 hours', durationMs: 5 * HOUR, resetsAt: NOW + 3 * HOUR },
            amount: { unit: 'percent', used: 10, limit: 100, remaining: 90, usedFraction: 0.1, remainingFraction: 0.9 },
            status: 'ok',
          },
        ],
        metadata: {
          email: 'dev.owner@example.test',
          accountId: 'acct-codex-team',
          orgId: 'org-enterprise',
          orgName: 'EnterpriseTeam',
          planType: 'team',
        },
      },
      {
        provider: 'google-antigravity',
        fetchedAt: NOW - 2_000,
        limits: [
          {
            id: 'google-antigravity:google:default:gemini-5h',
            label: 'Gemini',
            scope: { provider: 'google-antigravity', projectId: 'gcp-proj-alpha', windowId: '5h' },
            window: { id: '5h', label: '5 Hour', durationMs: 5 * HOUR, resetsAt: NOW + HOUR },
            amount: { unit: 'percent', remainingFraction: 0.4, usedFraction: 0.6, remaining: 40, used: 60, limit: 100 },
            status: 'ok',
          },
          // Shared third-party pool duplicated across anthropic and openai counters: must coalesce into 1 window!
          {
            id: 'google-antigravity:anthropic:default:3p-5h',
            label: 'Claude & GPT (shared)',
            scope: { provider: 'google-antigravity', projectId: 'gcp-proj-alpha', windowId: '5h', shared: true, sharedGroup: '3p:5h' },
            window: { id: '5h', label: '5 Hour', durationMs: 5 * HOUR, resetsAt: NOW + HOUR },
            amount: { unit: 'percent', remainingFraction: 0.25, usedFraction: 0.75, remaining: 25, used: 75, limit: 100 },
            status: 'ok',
          },
          {
            id: 'google-antigravity:openai:default:3p-5h',
            label: 'Claude & GPT (shared)',
            scope: { provider: 'google-antigravity', projectId: 'gcp-proj-alpha', windowId: '5h', shared: true, sharedGroup: '3p:5h' },
            window: { id: '5h', label: '5 Hour', durationMs: 5 * HOUR, resetsAt: NOW + HOUR },
            amount: { unit: 'percent', remainingFraction: 0.25, usedFraction: 0.75, remaining: 25, used: 75, limit: 100 },
            status: 'ok',
          },
        ],
        metadata: {
          email: 'agy.one@example.test',
          projectId: 'gcp-proj-alpha',
        },
      },
      {
        // Unrelated provider in OMP output (e.g. anthropic or github-copilot) must be ignored by OMP collector
        provider: 'anthropic',
        fetchedAt: NOW,
        limits: [],
        metadata: { email: 'claude@example.test' },
      },
    ],
    accountsWithoutUsage: [
      {
        provider: 'google-antigravity',
        type: 'oauth',
        email: 'agy.two@example.test',
        projectId: 'gcp-proj-beta',
      },
    ],
    disabledCredentials: [
      {
        provider: 'google-antigravity',
        type: 'oauth',
        email: 'agy.revoked@example.test',
        projectId: 'gcp-proj-gamma',
        cause: 'oauth refresh failed: invalid_grant',
        disabledAtMs: NOW - 60_000,
      },
    ],
  };

  const defaultResult = normalizeOmpUsagePayload(rawPayload, { profileNamespace: 'default', nowMs: NOW, keyer });
  const workResult = normalizeOmpUsagePayload(rawPayload, { profileNamespace: 'work', nowMs: NOW, keyer });

  assert.equal(defaultResult.ok, true);
  assert.equal(defaultResult.accounts.length, 5, '2 Codex + 3 Antigravity (ready, unavailable, auth-error)');

  const keysDefault = defaultResult.accounts.map((a) => a.accountKey);
  const keysWork = workResult.accounts.map((a) => a.accountKey);
  assert.equal(new Set(keysDefault).size, 5, 'all 5 accounts in default profile have distinct accountKeys');
  for (let i = 0; i < keysDefault.length; i++) {
    assert.notEqual(keysDefault[i], keysWork[i], 'same identity in different profile must have different accountKey');
  }

  // Local output exposes only allowlisted display labels, not metadata objects or credentials.
  const serialized = JSON.stringify(defaultResult);
  for (const forbidden of ['sk-live-1234567890', 'secretToken', 'invalid_grant', '"metadata"', '"raw"']) {
    assert.equal(serialized.includes(forbidden), false, `must not leak ${forbidden}`);
  }
  for (const account of defaultResult.accounts) {
    assert.deepEqual(Object.keys(account).sort(), [
      'accountKey', 'availability', 'label', 'lastSuccessAt', 'observedAt',
      'providerId', 'source', 'windows', ...(account.noteCode ? ['noteCode'] : []),
    ].sort(), 'identity must not be added as a separate public field');
  }
  assert.deepEqual(defaultResult.accounts.map((a) => a.label), [
    'dev.owner@example.test · org-personal · pro',
    'dev.owner@example.test · EnterpriseTeam · team',
    'agy.one@example.test',
    'agy.two@example.test',
    'agy.revoked@example.test',
  ]);

  // Same-email Codex accounts retain their distinct full organization qualifiers.
  const codexAccounts = defaultResult.accounts.filter((a) => a.providerId === 'openai-codex');
  assert.equal(codexAccounts.length, 2);
  assert.notEqual(codexAccounts[0].label, codexAccounts[1].label);
  assert.equal(codexAccounts[0].windows[0].sourceUnit, 'used');
  assert.equal(codexAccounts[0].windows[0].usedPercent, 35);
  assert.equal(codexAccounts[0].windows[0].remainingPercent, 65);

  // Antigravity shared group deduplicated from 3 raw limits to 2 windows, with sourceUnit='remaining'
  const agyReady = defaultResult.accounts.find((a) => a.providerId === 'google-antigravity' && a.availability === 'ready');
  assert.ok(agyReady);
  assert.equal(agyReady.windows.length, 2);
  assert.equal(agyReady.windows[0].sourceUnit, 'remaining');
  assert.equal(agyReady.windows[0].remainingPercent, 40);
  assert.equal(agyReady.windows[0].usedPercent, 60);

  // Unreported and disabled accounts have explicit availability states and noteCodes
  const agyUnavailable = defaultResult.accounts.find((a) => a.availability === 'unavailable');
  assert.ok(agyUnavailable);
  assert.equal(agyUnavailable.noteCode, 'no-usage-data');
  assert.deepEqual(agyUnavailable.windows, []);

  const agyAuthError = defaultResult.accounts.find((a) => a.availability === 'auth-error');
  assert.ok(agyAuthError);
  assert.equal(agyAuthError.noteCode, 'oauth-disabled');
  assert.deepEqual(agyAuthError.windows, []);

  // Only local projection retains full labels; remote output contains no identity strings.
  const localSnap = { version: 1, enabled: true, state: 'ready', profile: 'work', accounts: defaultResult.accounts, collector: {} };
  assert.equal(projectOmpUsageSnapshot(localSnap, { local: true }), localSnap);
  const remoteSnap = projectOmpUsageSnapshot(localSnap, { local: false });
  assert.equal(remoteSnap.profile, 'configured');
  assert.deepEqual(
    remoteSnap.accounts.map((a) => a.label),
    ['Codex #1', 'Codex #2', 'Antigravity #1', 'Antigravity #2', 'Antigravity #3']
  );
  const remoteSerialized = JSON.stringify(remoteSnap);
  for (const forbidden of [
    'dev.owner@example.test', 'agy.one@example.test', 'agy.two@example.test', 'agy.revoked@example.test',
    'acct-codex-personal', 'acct-codex-team', 'org-personal', 'org-enterprise', 'EnterpriseTeam',
    'gcp-proj-alpha', 'gcp-proj-beta', 'gcp-proj-gamma', '"work"', '"pro"', '"team"',
  ]) {
    assert.equal(remoteSerialized.includes(forbidden), false, `remote must not reveal ${forbidden}`);
  }
  assert.deepEqual(remoteSnap.accounts.map((a) => a.accountKey), keysDefault, 'projection preserves opaque keys');
  assert.equal(localSnap.accounts[0].label, 'dev.owner@example.test · org-personal · pro', 'remote projection does not mutate local labels');
});

test('S7: normalizeUsageWindow preserves units, handles remaining-only/unknown counters without faking 0, and validates resetsAt', () => {
  // Unknown unit with remaining count only (e.g. Antigravity bucket with remainingAmount but no fraction)
  const unknownPct = normalizeUsageWindow('google-antigravity', {
    id: 'google-antigravity:google:default:credits',
    label: 'Quota Bucket',
    scope: { provider: 'google-antigravity', windowId: 'weekly' },
    window: { id: 'weekly', label: 'Weekly', resetsAt: NOW + DAY },
    amount: { unit: 'unknown', remaining: 42 },
  }, { nowMs: NOW });
  assert.equal(unknownPct.usedPercent, null, 'must not fabricate 0% when fraction/limit is absent');
  assert.equal(unknownPct.remainingPercent, null);
  assert.equal(unknownPct.sourceUnit, 'unknown');
  assert.equal(unknownPct.resetsAt, NOW + DAY);

  // Credits spend-cap with certified used and limit
  const spendCap = normalizeUsageWindow('openai-codex', {
    id: 'openai-codex:spend-cap',
    label: 'Spend cap',
    scope: { provider: 'openai-codex', tier: 'credits', windowId: 'spend-cap' },
    window: { id: 'spend-cap', label: 'Spend cap', resetsAt: NOW + 5 * DAY },
    amount: { unit: 'credits', used: 25, limit: 100, remaining: 75, usedFraction: 0.25 },
  }, { nowMs: NOW });
  assert.equal(spendCap.kind, 'credits');
  assert.equal(spendCap.usedPercent, 25);
  assert.equal(spendCap.remainingPercent, 75);
  assert.equal(spendCap.sourceUnit, 'used');

  // Implausible or non-epoch-ms reset timestamps become null
  const badReset = normalizeUsageWindow('openai-codex', {
    id: 'openai-codex:primary',
    label: '5 hours',
    scope: { provider: 'openai-codex', windowId: '5h' },
    window: { id: '5h', label: '5 hours', resetsAt: 3600 }, // seconds, not epoch ms
    amount: { unit: 'percent', usedFraction: 0 },
  }, { nowMs: NOW });
  assert.equal(badReset.usedPercent, 0, 'certified 0% usedFraction stays 0');
  assert.equal(badReset.remainingPercent, 100);
  assert.equal(badReset.resetsAt, null, 'non-epoch-ms timestamp rejected');

  // Identity-less accounts stay distinct and get fallback labels
  const anonPayload = {
    generatedAt: NOW,
    reports: [
      { provider: 'openai-codex', fetchedAt: NOW, limits: [], metadata: {} },
      { provider: 'openai-codex', fetchedAt: NOW, limits: [], metadata: {} },
    ],
  };
  const anonRes = normalizeOmpUsagePayload(anonPayload, { nowMs: NOW });
  assert.equal(anonRes.accounts.length, 2);
  assert.notEqual(anonRes.accounts[0].accountKey, anonRes.accounts[1].accountKey);
  assert.equal(anonRes.accounts[0].label, 'Codex #1');
  assert.equal(anonRes.accounts[1].label, 'Codex #2');
  assert.equal(anonRes.accounts[0].availability, 'unsupported');
  assert.equal(anonRes.accounts[0].noteCode, 'no-limits-reported');
});

test('full labels disambiguate same-email organizations, account IDs, and workspaces without changing HMAC identity', () => {
  const identities = [
    { email: 'owner@example.test', orgName: 'Shared organization', orgId: 'org-one', accountId: 'acct-one', planType: 'team' },
    { email: 'owner@example.test', orgName: 'Shared organization', orgId: 'org-two', accountId: 'acct-two', planType: 'team' },
    { email: 'owner@example.test', orgName: 'Shared organization', orgId: 'org-two', accountId: 'acct-three', planType: 'team' },
    { email: 'workspace@example.test', projectId: 'project-one' },
    { email: 'workspace@example.test', projectId: 'project-two' },
  ];
  const keyer = createAccountKeyer({ secret: 'synthetic-stable-label-test' });
  const result = normalizeOmpUsagePayload({
    generatedAt: NOW,
    reports: identities.map((metadata) => ({ provider: 'openai-codex', limits: [], metadata })),
  }, { nowMs: NOW, keyer });
  assert.deepEqual(result.accounts.map((a) => a.label), [
    'owner@example.test · Shared organization · org-one · team',
    'owner@example.test · Shared organization · org-two · acct-two · team',
    'owner@example.test · Shared organization · org-two · acct-three · team',
    'workspace@example.test · project-one',
    'workspace@example.test · project-two',
  ]);
  assert.equal(new Set(result.accounts.map((a) => a.accountKey)).size, identities.length);
  result.accounts.forEach((account, i) => {
    assert.equal(account.accountKey, keyer('default', 'openai-codex', identities[i]));
  });
  const remote = projectOmpUsageSnapshot({ profile: 'default', accounts: result.accounts }, { local: false });
  for (const identity of identities) {
    for (const value of Object.values(identity)) {
      assert.equal(JSON.stringify(remote).includes(value), false);
    }
  }
});

test('organization-only and account-only labels are visible, with generic indexed fallbacks for missing identity', () => {
  const result = normalizeOmpUsagePayload({
    generatedAt: NOW,
    reports: [
      { provider: 'openai-codex', limits: [], metadata: { orgId: 'org-only', orgName: 'Organization only', planType: 'team' } },
      { provider: 'openai-codex', limits: [], metadata: { orgName: 'Name-only organization' } },
      { provider: 'openai-codex', limits: [], metadata: { orgId: 'org-id-only' } },
      { provider: 'openai-codex', limits: [], metadata: { accountId: 'acct-only' } },
      { provider: 'openai-codex', limits: [], metadata: { email: {}, orgName: [], planType: 'pro' } },
      { provider: 'google-antigravity', limits: [], metadata: { enterpriseUrl: 'https://enterprise.example.test' } },
    ],
    accountsWithoutUsage: [{ provider: 'google-antigravity', type: 'oauth', orgId: 'org-unreported', orgName: 'Unreported organization' }],
    disabledCredentials: [{ provider: 'google-antigravity', type: 'oauth', orgId: 'org-disabled', orgName: 'Disabled organization' }],
  }, { nowMs: NOW });
  assert.deepEqual(result.accounts.map((a) => a.label), [
    'Organization only · team', 'Name-only organization', 'org-id-only', 'acct-only',
    'Codex #5 · pro', 'https://enterprise.example.test', 'Unreported organization', 'Disabled organization',
  ]);
  assert.equal(new Set(result.accounts.map((a) => a.accountKey)).size, result.accounts.length);
  const remote = projectOmpUsageSnapshot({ profile: 'work', accounts: result.accounts }, { local: false });
  for (const label of [
    'Organization only', 'Name-only organization', 'org-id-only', 'acct-only',
    'https://enterprise.example.test', 'Unreported organization', 'Disabled organization',
  ]) {
    assert.equal(JSON.stringify(remote).includes(label), false, `remote must not reveal ${label}`);
  }
});

test('assembled full local labels retain long email and organization while individual fields remain bounded', () => {
  const email = 'first.middle.last.account.owner.with.long.name@subdomain.example.test';
  const orgName = 'Long organization name with several distinct workspace qualifiers';
  const oversizedEmail = `${'a.'.repeat(70)}@example.test`;
  const oversizedOrg = 'Long organization '.repeat(10);
  const oversizedPlan = 'team '.repeat(12);
  const result = normalizeOmpUsagePayload({
    reports: [
      { provider: 'openai-codex', limits: [], metadata: { email, orgName, planType: 'business' } },
      { provider: 'openai-codex', limits: [], metadata: { email: oversizedEmail, orgName: oversizedOrg, planType: oversizedPlan } },
    ],
  }, { nowMs: NOW });
  assert.equal(result.accounts[0].label, `${email} · ${orgName} · business`);
  assert.ok(result.accounts[0].label.length > 72, 'the complete assembled label must not be truncated');
  assert.equal(result.accounts[1].label, `${oversizedEmail.slice(0, 128)} · ${oversizedOrg.trim().slice(0, 80)} · ${oversizedPlan.trim().slice(0, 40)}`);
});

test('full local labels still redact secrets and sanitize controls without publishing raw metadata or credential fields', () => {
  const secret = 'sk-live-1234567890abcdefghijklmnop';
  const result = normalizeOmpUsagePayload({
    reports: [{
      provider: 'openai-codex',
      limits: [],
      metadata: {
        email: 'OWNER@example.test',
        orgName: `Workspace\nBearer ${secret}`,
        planType: `team token=${secret}`,
        accessToken: 'unpublished-access-token',
        refreshToken: 'unpublished-refresh-token',
        credentials: { password: 'unpublished-password' },
        displayName: 'unapproved-display-name',
      },
      raw: { apiKey: 'unpublished-api-key' },
    }],
  }, { nowMs: NOW });
  assert.equal(result.accounts[0].label, 'owner@example.test · Workspace Bearer ••• · team token=•••');
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    secret, 'unpublished-access-token', 'unpublished-refresh-token', 'unpublished-password',
    'unpublished-api-key', 'unapproved-display-name', '"metadata"', '"credentials"', '"raw"',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `must not reveal ${forbidden}`);
  }
});

test('same-email accounts with conflicting CLI account, organization, or project IDs are not dropped as duplicates', () => {
  const identity = { email: 'shared@example.test', orgId: 'org-shared', accountId: 'acct-ready', projectId: 'project-ready' };
  const result = normalizeOmpUsagePayload({
    generatedAt: NOW,
    reports: [{ provider: 'openai-codex', limits: [], metadata: identity }],
    accountsWithoutUsage: [
      { provider: 'openai-codex', type: 'oauth', ...identity },
      { provider: 'openai-codex', type: 'oauth', ...identity, accountId: 'acct-unreported' },
      { provider: 'openai-codex', type: 'oauth', ...identity, projectId: 'project-other' },
      { provider: 'openai-codex', type: 'oauth', ...identity, orgId: 'org-other' },
    ],
    disabledCredentials: [{ provider: 'openai-codex', type: 'oauth', ...identity, accountId: 'acct-disabled' }],
  }, { nowMs: NOW });
  assert.equal(result.accounts.length, 5, 'only the exact matching account row is deduplicated');
  assert.equal(new Set(result.accounts.map((a) => a.accountKey)).size, 5);
  assert.equal(new Set(result.accounts.map((a) => a.label)).size, 5);
  assert.equal(result.accounts.filter((a) => a.availability === 'unavailable').length, 3);
  assert.equal(result.accounts.filter((a) => a.availability === 'auth-error').length, 1);
  const remote = projectOmpUsageSnapshot({ profile: 'default', accounts: result.accounts }, { local: false });
  for (const value of [...Object.values(identity), 'acct-unreported', 'project-other', 'org-other', 'acct-disabled']) {
    assert.equal(JSON.stringify(remote).includes(value), false);
  }
});
