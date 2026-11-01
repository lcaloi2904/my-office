// Replay messages become metadata-only lanes. Stable session keys identify new recordings; legacy recordings
// keep their name-based restart grouping. Names never change an already resolved session's identity.
export const KINDS = ['think', 'read', 'edit', 'shell', 'web', 'agent', 'wait', 'turn', 'idle', 'unknown', 'stale', 'ended'];
const OF_TYPE = { prompt: 'think', plan: 'think', other: 'think', compact: 'think', skill: 'read', read: 'read', grep: 'read', glob: 'read',
  edit: 'edit', write: 'edit', bash: 'shell', test: 'shell', web: 'web', fetch: 'web', mcp: 'web', agent: 'agent', wait: 'wait', ask: 'wait',
  stop: 'turn', idle: 'turn', interrupt: 'turn', turn_start: 'think', turn_end: 'turn', unknown: 'unknown', stale: 'stale' };
const CATEGORY = { read: 'read', edit: 'edit', cmd: 'shell', web: 'web', agent: 'agent', other: 'think' };
const TOOL = new Set(['read', 'edit', 'shell', 'web', 'agent']);
const DEGRADED = new Set(['unknown', 'stale', 'ended']);
export const TURN_CAP = 30 * 60e3;

function evidenceKind(s) {
  if (s.lifecycle === 'ended' || s.lifecycle === 'aborted') return 'ended';
  if (s.connection === 'stale' || s.connection === 'disconnected') return 'stale';
  if (s.persistedOnly || s.lifecycle === 'historical' || s.activity === 'unknown' || s.eventGap === true) return 'unknown';
  if (s.activity === 'waiting') return s.waitReasons?.includes('approval') ? 'wait' : s.waitReasons?.includes('input') ? 'turn' : 'unknown';
  if (s.activity === 'active') return 'think';
  if (s.activity === 'idle') return ['success', 'error', 'aborted'].includes(s.lastTurnOutcome) ? 'turn' : 'idle';
  if (s.agentKind === 'omp') return 'unknown';
  return null;
}

export function buildTimeline(items, from, to) {
  const rows = new Map(), roots = new Map(), children = new Map();
  const root = (s) => {
    const key = s.sessionKey ? JSON.stringify(['session', s.sessionKey]) : roots.get(s.id)?.key || JSON.stringify(['legacy', s.name || s.id]);
    let r = rows.get(key);
    if (!r) rows.set(key, (r = makeRow(key, s.id, null, s.name || 'claude', null)));
    if (s.runtimeInstanceId !== undefined || s.generation !== undefined) {
      const epoch = JSON.stringify([s.runtimeInstanceId, s.generation]);
      if (r.epoch && r.epoch !== epoch) { r.tools.clear(); r.terminal.clear(); r.anonymous = 0; r.afterTools = 'think'; }
      r.epoch = epoch;
    }
    roots.set(s.id, r);
    r.sess = s.id;
    if (s.name) r.name = s.name;
    if (s.sessionKey) r.sessionKey = s.sessionKey;
    if (s.title) r.title = s.title;
    r.desk = s.desk ?? r.desk;
    r.evidence = evidenceKind(s);
    return r;
  };
  const child = (r, x) => {
    const lookup = JSON.stringify([r.key, x.id]);
    const key = x.agentKey ? JSON.stringify(['agent', x.agentKey]) : children.get(lookup) || JSON.stringify(['child', r.sessionKey || r.sess, x.id]);
    children.set(lookup, key);
    let sr = rows.get(key);
    const name = x.name || [x.type, x.desc].filter(Boolean).join(' · ');
    if (!sr) rows.set(key, (sr = makeRow(key, r.sess, x.id, name, r.key)));
    sr.sess = r.sess;
    sr.agent = x.id;
    if (r.sessionKey) sr.sessionKey = r.sessionKey;
    if (name) sr.name = name;
    for (const k of ['agentKey', 'parentAgentKey', 'rootSessionKey', 'relationKind']) if (x[k] !== undefined) sr[k] = x[k];
    sr.evidence = evidenceKind(x) || r.evidence;
    return sr;
  };
  function makeRow(key, sess, agent, name, rootKey) {
    return { key, sess, agent, name, rootKey, spans: [], marks: [], cur: null, desk: -1, evidence: null, tools: new Map(), terminal: new Set(), anonymous: 0, afterTools: 'think', epoch: null };
  }
  const close = (r, t) => {
    if (!r.cur) return;
    const s = Math.max(r.cur.s, from), e = Math.min(t, to), last = r.spans.at(-1);
    if (e > s) {
      if (last && last[2] === r.cur.kind && last[1] === s && last[3] === r.cur.label) last[1] = e;
      else r.spans.push([s, e, r.cur.kind, r.cur.label || '']);
    }
    r.cur = null;
  };
  const open = (r, t, kind, label = '') => {
    if (r.cur?.kind === kind && r.cur.label === label) return;
    close(r, t); r.cur = { kind, s: t, label };
  };
  const mark = (r, t, kind, label = '') => { if (t >= from && t <= to) r.marks.push([t, kind, label]); };
  const clearTools = (r) => { r.tools.clear(); r.anonymous = 0; };
  const finish = (r, t, outcome, label) => {
    clearTools(r); open(r, t, 'ended');
    mark(r, t, outcome === 'error' || outcome === 'failed' ? 'fail' : outcome === 'aborted' ? 'aborted' : 'end', label);
  };
  const activeKind = (r) => [...r.tools.values()].at(-1) || (r.anonymous ? r.cur?.kind || 'think' : r.afterTools);
  const settleTool = (r, t, id, phase, label) => {
    if (id) {
      if (r.terminal.has(id)) return;
      r.terminal.add(id);
      if (!r.tools.delete(id)) {
        if (phase === 'error' || phase === 'failed') mark(r, t, 'fail', label);
        else if (phase === 'aborted') mark(r, t, 'aborted', label);
        return;
      }
    } else if (r.anonymous) r.anonymous--;
    else if (r.tools.size) return; // An uncorrelated legacy completion cannot close a correlated tool.
    else if (!id && !TOOL.has(r.cur?.kind)) return;
    if (phase === 'error' || phase === 'failed') mark(r, t, 'fail', label);
    else if (phase === 'aborted') mark(r, t, 'aborted', label);
    if (r.cur && !DEGRADED.has(r.cur.kind)) open(r, t, activeKind(r));
  };
  const snapshot = (s, t) => {
    const r = root(s), kind = r.evidence || (s.status === 'work' ? 'think' : s.status === 'wait' ? 'wait' : s.lastPrompt ? 'turn' : 'idle');
    if (DEGRADED.has(kind)) clearTools(r);
    else if (kind === 'turn' || kind === 'idle') { r.afterTools = kind; r.anonymous = 0; }
    if (kind === 'ended' && r.cur?.kind !== 'ended') finish(r, t, s.lastTurnOutcome, '');
    // Routine rest snapshots cannot settle correlated tools without their terminal evidence.
    open(r, t, ['think', 'turn', 'idle'].includes(kind) && (r.tools.size || r.anonymous) ? activeKind(r) : kind);
    const present = new Set();
    for (const x of s.subs || []) {
      const sr = child(r, x); present.add(sr.key);
      const k = sr.evidence || (x.last ? OF_TYPE[x.last.type] || 'unknown' : 'think');
      if (DEGRADED.has(k)) clearTools(sr);
      open(sr, t, k === 'think' && (sr.tools.size || sr.anonymous) ? activeKind(sr) : k);
    }
    for (const x of s.doneSubs || []) {
      const sr = child(r, x); present.add(sr.key);
      if (sr.cur?.kind !== 'ended') finish(sr, t, x.lifecycle === 'aborted' ? 'aborted' : x.lastTurnOutcome || x.outcome, '');
    }
    for (const sr of rows.values()) if (sr.rootKey === r.key && !present.has(sr.key)) { close(sr, t); clearTools(sr); }
    return r;
  };

  for (const { t, m } of items) {
    if (!m || !Number.isFinite(t) || t > to) continue;
    if (m.k === 'snap') {
      const present = new Set();
      for (const s of m.sessions || []) present.add(snapshot(s, t).key);
      for (const r of rows.values()) if (!present.has(r.rootKey || r.key)) { close(r, t); clearTools(r); }
    } else if (m.k === 'ev' && m.e) {
      const e = m.e, s = m.s || { id: e.sess, sessionKey: e.sessionKey, name: e.name };
      const r0 = m.s || e.sessionKey ? root(s) : roots.get(e.sess) || root(s);
      const x = e.agent ? [...(s.subs || []), ...(s.doneSubs || [])].find((x) => x.id === e.agent) : null;
      const r = e.agent ? child(r0, { ...x, id: e.agent, agentKey: e.agentKey || x?.agentKey, type: e.agentType || x?.type }) : r0;
      if (e.type === 'substart') { open(r, t, r.evidence || 'think'); continue; }
      if (e.type === 'substop') { if (e.desc) r.name = [e.label || r.name, e.desc].filter(Boolean).join(' · '); finish(r, t, e.outcome, e.label); continue; }
      if (e.type === 'end' || e.type === 'session_end') {
        finish(r, t, e.outcome || s.lastTurnOutcome, e.label);
        if (!r.agent) for (const sr of rows.values()) if (sr.rootKey === r.key) finish(sr, t, '', '');
        continue;
      }
      if (['testok', 'testfail', 'deploy'].includes(e.type)) {
        if (e.type !== 'testok') mark(r, t, e.type === 'testfail' ? 'fail' : 'deploy', e.label);
        // Old files recorded these result events instead of stats. Correlated tools require their own stats ID.
        if (r.anonymous) settleTool(r, t, null, '', '');
        continue;
      }
      if (['commit', 'push', 'cigreen', 'cired'].includes(e.type)) continue;
      if (e.type === 'fail' || e.type === 'aborted') { mark(r, t, e.type, e.label); continue; }
      if (e.type === 'tool_end') { settleTool(r, t, e.toolCallId, e.phase, e.label); continue; }
      if (e.type === 'start') { if (!r.cur || r.cur.kind === 'ended') open(r, t, r.evidence || 'idle'); mark(r, t, 'start'); continue; }
      if (e.type === 'prompt') mark(r, t, 'prompt', e.label);
      if (e.type === 'turn_end' && ['error', 'failed', 'aborted'].includes(e.outcome)) mark(r, t, e.outcome === 'aborted' ? 'aborted' : 'fail', e.label);
      const kind = e.type === 'tool_start' ? CATEGORY[e.category] || 'think' : OF_TYPE[e.type] || 'unknown';
      if (DEGRADED.has(r.evidence)) { open(r, t, r.evidence); continue; }
      if (e.type === 'tool_start' || TOOL.has(kind) || (e.toolCallId && e.phase === 'running')) {
        if (e.toolCallId) {
          if (r.terminal.has(e.toolCallId)) continue;
          r.afterTools = 'think';
          r.tools.set(e.toolCallId, kind);
        } else r.anonymous++;
      } else if (['prompt', 'stop', 'interrupt', 'idle', 'turn_start', 'turn_end'].includes(e.type)) {
        r.anonymous = 0; r.afterTools = kind;
      }
      // A turn-end cannot hide still-running parallel tools.
      open(r, t, (r.tools.size || r.anonymous) && ['turn', 'think'].includes(kind) ? activeKind(r) : kind, e.label);
    } else if (m.k === 'stats' && m.s) {
      const r0 = root(m.s), r = m.post && m.post !== 'main'
        ? child(r0, { ...(m.s.subs || []).find((x) => x.id === m.post), id: m.post }) : r0;
      if (DEGRADED.has(r.evidence)) { clearTools(r); open(r, t, r.evidence); }
      else settleTool(r, t, m.toolCallId, m.phase, '');
    } else if (m.k === 'sess' && m.s) snapshot(m.s, t);
    else if (m.k === 'gone') {
      const r0 = roots.get(m.id);
      if (r0) for (const r of rows.values()) if (r === r0 || r.rootKey === r0.key) { close(r, t); clearTools(r); }
    }
  }
  const end = Math.min(to, Date.now());
  for (const r of rows.values()) close(r, end);
  const sum = (r, kinds, cap = Infinity) => r.spans.reduce((a, [s, e, k]) => a + (kinds.includes(k) ? Math.min(e - s, cap) : 0), 0);
  const out = [...rows.values()]
    .filter((r) => r.spans.some((x) => x[2] !== 'idle' && x[2] !== 'turn') || r.marks.length)
    .map(({ cur, evidence, tools, terminal, anonymous, afterTools, epoch, ...r }) => ({ ...r, totals: {
      work: sum(r, ['think', 'read', 'edit', 'shell', 'web', 'agent']), wait: sum(r, ['wait']), turn: sum(r, ['turn'], TURN_CAP),
      unknown: sum(r, ['unknown', 'stale']), prompts: r.marks.filter((x) => x[1] === 'prompt').length,
    } }));
  const first = (r) => r.spans.find((x) => x[2] !== 'idle' && x[2] !== 'turn')?.[0] ?? r.marks[0]?.[0] ?? to;
  const mains = out.filter((r) => !r.agent).sort((a, b) => first(a) - first(b));
  const ordered = [];
  for (const r of mains) { ordered.push(r); ordered.push(...out.filter((x) => x.rootKey === r.key).sort((a, b) => first(a) - first(b))); }
  for (const r of out) if (r.agent && !mains.some((x) => x.key === r.rootKey)) ordered.push(r);
  const totals = { work: 0, wait: 0, turn: 0, unknown: 0, prompts: 0 };
  for (const r of ordered) if (!r.agent) for (const k of Object.keys(totals)) totals[k] += r.totals[k];
  return { from, to, rows: ordered, totals };
}
