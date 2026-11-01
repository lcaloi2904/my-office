// How events read on screen: actions per event type, verbs, bubble text, streamer mode.
import { state } from '../core/state.js';
import { PRO, replay } from '../core/env.js';
import { cap } from './activity.js';
import { t as tr } from '../../i18n/index.js';

/* ---------- how events look ---------- */
export const ACT = {
  prompt:  { station: 'board',   anim: 'board',   icon: '📝', dwell: 2.2 },
  read:    { station: 'library', anim: 'read',    icon: '📖' },
  grep:    { station: 'library', anim: 'read',    icon: '🔍' },
  glob:    { station: 'library', anim: 'read',    icon: '🗂️' },
  skill:   { station: 'library', anim: 'read',    icon: '📚' },
  edit:    { station: 'desk',    anim: 'type',    icon: '✏️' },
  write:   { station: 'desk',    anim: 'type',    icon: '📄' },
  plan:    { station: 'board',   anim: 'board',   icon: '🗒️' },
  bash:    { station: 'server',  anim: 'console', icon: '⌨️' },
  web:     { station: 'globe',   anim: 'globe',   icon: '🌐' },
  fetch:   { station: 'globe',   anim: 'globe',   icon: '🌐' },
  mcp:     { station: 'globe',   anim: 'globe',   icon: '🔌' },
  agent:   { station: 'board',   anim: 'board',   icon: '👥', dwell: 2.6 },   // the boss hands out work at the board
  other:   { station: 'desk',    anim: 'type',    icon: '🛠️' },
  compact: { station: 'desk',    anim: 'stomp',   icon: '🗑️', dwell: 4.5 },
  ask:     { station: null,      anim: 'hand',    icon: '❓', kind: 'wait', priority: true },
  wait:    { station: null,      anim: 'hand',    icon: '✋', kind: 'wait', priority: true },
  fail:    { station: null,      anim: 'sweat',   icon: '💦', kind: 'fail', priority: true, dwell: 1.8 },
  stop:    { station: 'coffee',  anim: 'coffee',  icon: '☕', rest: 9 },
  idle:    { station: 'coffee',  anim: 'coffee',  icon: '☕', rest: 5 },
  interrupt: { station: 'desk',  anim: 'think',   icon: '✋', rest: 6, dwell: 2 },
  deploy:  { station: 'server',  anim: 'celebrate', icon: '🚀', dwell: 2.4 },
  commit:  { station: 'desk',    anim: 'tidy',    icon: '🖨️', dwell: 2 },      // a commit: the desk gets tidied
  push:    { station: null,      anim: 'celebrate', icon: '🚀', dwell: 2 },
  cired:   { station: null,      anim: 'sweat',   icon: '🚨', kind: 'fail', priority: true, dwell: 2.4 },
  cigreen: { station: null,      anim: 'celebrate', icon: '✅', dwell: 2 },
  release: { station: null,      anim: 'celebrate', icon: '🏷️', dwell: 2 },   // a version tag or a release (people/photobooth.js)
  // a test run: watch it at the test board (life/tests.js), then a cheer or a puzzled look
  test:    { station: 'tests',   anim: 'think',   icon: '🧪', dwell: 1.6 },
  testok:  { station: 'tests',   anim: 'celebrate', icon: '✅', dwell: 2.2 },
  testfail: { station: 'tests',  anim: 'sweat',   icon: '❌', kind: 'fail', dwell: 2.6 },
  start:   { icon: '🚪' }, end: { icon: '👋' }, substart: { icon: '👥' }, substop: { icon: '📋' },
};
export const ANIM_AT = { dining: 'eat', desk: 'type', server: 'console', library: 'read', globe: 'globe', board: 'board', coffee: 'coffee', director: 'think', brief: 'board', wc: 'idle', tests: 'think', post: 'idle' };
// A session's state, translated when read: STATUS_LABEL[s.status] keeps working for every caller.
const translated = (keys, prefix) => Object.defineProperties({}, Object.fromEntries(keys.map((k) => [k, { enumerable: true, get: () => tr(`${prefix}.${k}`) }])));
// Where each station is, in words (the coffee corner is the dining room on the company floor).
let STATION_LABEL;
export const STATUS_LABEL = translated(['work', 'wait', 'rest'], 'events.status');
// Streamer mode: the event types whose label is replaced by a generic phrase (events.generic.<type>).
const GENERIC = new Set(['prompt', 'read', 'grep', 'glob', 'skill', 'edit', 'write', 'bash', 'web', 'fetch', 'mcp', 'wait', 'fail', 'deploy', 'test']);
export const lbl = (e) => (state.streamer && GENERIC.has(e.type) ? tr(`events.generic.${e.type}`) : e.label || '');
const V = (key, vars) => tr(`events.verb.${key}`, vars);
export function verb(e) {
  const label = lbl(e);
  switch (e.type) {
    case 'prompt': return V('prompt', { label });
    case 'read': return V('read', { label });
    case 'grep': return V('grep', { label });
    case 'glob': return V('glob', { label });
    case 'skill': return V('skill', { label });
    case 'edit': return V('edit', { label });
    case 'write': return V('write', { label });
    case 'plan': return V('plan', { label });
    case 'bash': return label;
    case 'web': return V('web', { label });
    case 'fetch': return V('fetch', { label });
    case 'mcp': return V('mcp', { label });
    case 'agent': return e.desc ? V('agentDesc', { label, desc: e.desc }) : V('agent', { label });
    case 'compact': return V('compact');
    case 'ask': return V('ask');
    case 'wait': return V('wait', { label });
    case 'fail': return V('fail', { label });
    case 'stop': return label ? V('stopNamed', { label }) : V('stop');
    case 'interrupt': return V('interrupt');
    case 'idle': return V('idle');
    case 'deploy': return V('deploy', { label });
    case 'commit': return state.streamer ? V('commitHidden') : V('commit', { label });
    case 'push': return V('push', { target: state.streamer ? 'git' : label });
    case 'release': return V('release', { tag: label });
    case 'cired': return V('ciRed', { label: label || V('ciRedDefault') });
    case 'cigreen': return V('ciGreen', { label: label || V('ciGreenDefault') });
    case 'test': return V('test', { label });
    case 'testok': return V('testok', { label });
    case 'testfail': return V('testfail', { label });
    case 'start': return V('start');
    case 'end': return V('end');
    case 'substart': return V('substart', { label });
    case 'substop': return V('substop', { label });
    default: return V('use', { label });
  }
}
export function bubbleText(e) {
  const label = lbl(e), B = (key, vars) => tr(`events.bubble.${key}`, vars);
  switch (e.type) {
    case 'wait': return B('wait', { label });
    case 'ask': return B('ask');
    case 'fail': return B('fail', { label });
    case 'stop': return B('stop');
    case 'interrupt': return B('interrupt');
    case 'idle': return B('idle');
    case 'compact': return B('compact');
    case 'agent': return B('agent', { label });
    case 'deploy': return B('deploy', { label });
    case 'plan': return B('plan');
    case 'testok': return B('testok');
    case 'testfail': return B('testfail');
    default: return state.streamer ? cap(verb(e)) : label || verb(e);
  }
}

const OMP_SAFE_SUBJECT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const OMP_SECRET_SUBJECT = /(?:^|[._-])(?:env|secret|token|key|cred|passwd|password|auth|private|id_rsa|id_ed25519)(?:$|[._-])/i;
const OMP_BUBBLE_ICON = {
  read: 'read',
  edit: 'edit',
  cmd: 'bash',
  test: 'test',
  web: 'web',
  processing: 'other',
  waiting: 'wait',
  idle: 'idle',
  unknown: 'other',
};
const OMP_CATEGORY_MAP = { read: 'read', edit: 'edit', cmd: 'cmd', test: 'test', web: 'web', other: 'processing' };
const ompDetailAllowed = () => {
  if (state.ompActivityDetail !== undefined) return state.ompActivityDetail === true;
  try { return localStorage.getItem('office-omp-detail') !== 'off'; } catch { return true; }
};

export function ompBubbleView(s, { fallbackText = '' } = {}) {
  if (!s || typeof s !== 'object') {
    return { type: 'other', text: fallbackText, kind: '', summaryKind: 'unknown' };
  }
  const fresh = s.lifecycle !== 'ended' && s.persistedOnly !== true && s.connection === 'connected' && s.eventGap !== true;
  if (!fresh) {
    return { type: 'other', text: fallbackText, kind: '', summaryKind: 'unknown' };
  }
  const waiting = s.activity === 'waiting';
  if (waiting) {
    const waitKey = s.waitReasons?.includes('input') ? 'waitingInput' : 'waitingApproval';
    return {
      type: 'wait',
      text: tr(`events.ompBubble.${waitKey}`),
      kind: 'wait',
      summaryKind: 'waiting',
    };
  }
  if (s.activity === 'idle') {
    return {
      type: 'idle',
      text: tr('events.ompBubble.idle'),
      kind: 'rest',
      summaryKind: 'idle',
    };
  }
  if (s.activity === 'active') {
    const sum = s.activitySummary && typeof s.activitySummary === 'object' ? s.activitySummary : null;
    const rawKind = sum && typeof sum.kind === 'string' && Object.hasOwn(OMP_BUBBLE_ICON, sum.kind) &&
      sum.kind !== 'idle' && sum.kind !== 'unknown'
      ? sum.kind
      : (OMP_CATEGORY_MAP[s.toolCategories?.[0]] || 'processing');
    const canDetail = !state.streamer && !replay.on && state.isLocal !== false && ompDetailAllowed() &&
      (sum?.source === 'managedRpc' || sum?.source === 'externalController') &&
      (rawKind === 'read' || rawKind === 'edit' || rawKind === 'test') &&
      typeof sum?.safeSubject === 'string' && OMP_SAFE_SUBJECT.test(sum.safeSubject) &&
      !OMP_SECRET_SUBJECT.test(sum.safeSubject);
    const text = canDetail
      ? tr(`events.ompBubble.${rawKind}Subject`, { subject: sum.safeSubject })
      : tr(`events.ompBubble.${rawKind}`);
    return {
      type: OMP_BUBBLE_ICON[rawKind] || 'other',
      text,
      kind: '',
      summaryKind: rawKind,
    };
  }
  return { type: 'other', text: fallbackText, kind: '', summaryKind: 'unknown' };
}
export function setup() {
  // On the company floor the director brings each new task to the desk (no trip to the board), and a boss briefs its
  // subagents at the meeting-room screen.
  if (PRO) { Object.assign(ACT.prompt, { station: 'desk', anim: 'think', dwell: 2.6 }); Object.assign(ACT.agent, { station: 'brief', anim: 'board' }); }
  STATION_LABEL = translated(['dining', 'board', 'library', 'desk', 'server', 'globe', 'meeting', 'director', 'wc', 'tests', 'post'], 'events.station');
  Object.defineProperties(STATION_LABEL, {
    coffee: { enumerable: true, get: () => tr(PRO ? 'events.station.dining' : 'events.station.coffee') },
    brief: { enumerable: true, get: () => tr('events.station.meeting') },
  });
  // Streamer mode: any label that could carry a command, path, prompt or URL becomes a generic phrase.
  state.streamer = false;
  // Zone names over the office show only while you point at their furniture, unless you ask for them always.
  state.zonesOn = false;
  try { state.zonesOn = localStorage.getItem('office-zones') === 'on'; } catch { /* storage blocked */ }
  try { state.streamer = localStorage.getItem('office-stream') === 'on'; } catch { /* storage blocked */ }
}
