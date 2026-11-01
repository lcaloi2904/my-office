// The live connection: sessions, desks, teams, events.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { state } from '../core/state.js';
import { $, el, replay, short } from '../core/env.js';
import { scene } from '../scene/renderer.js';
import { CHAIR_IDLE, DESKS, PODS, UNITS, chairs, unitOfDesk } from '../world/desks.js';
import { canvasTex } from '../scene/blocks.js';
import { DEPTS } from '../world/layout.js';
import { DEPT_SIGNS } from '../world/pro/wing.js';
import { ACTOR_BUDGET, CHILD_ACTOR_BUDGET, PALETTE, actorCount, actorIdentity, addWorker, agentOf, childActorKey, childObservation, dn, dropSub, freeActor, hash, leaving, observeActor, sessions, spawnSub, subs, workers } from '../people/workers.js';
import { queueUi } from '../ui/activity.js';
import { closeSession } from '../ui/session-drawer.js';
import { t as tr } from '../../i18n/index.js';

export let TOKEN;
export function setConn(on) { const c = $('conn'); c.dataset.state = on ? 'on' : 'off'; c.lastElementChild.textContent = tr(on ? 'activity.live.on' : 'activity.live.off'); }
/* Teams: each project (its git repository, else its folder) has an area of its own: half a pod on the open floor, a
   department room on the headquarters' wing, a row in the small office. A session sits in its project's area (the
   server's desk number is ignored); a project with more people than desks there takes the other half of the pod, or
   the nearest free area. Areas are remembered on this device, so a project comes back to the same desks tomorrow; an
   area someone else remembers is the last one handed to a newcomer. Only when every area is taken do projects share. */
const deskOf = new Map(), rowTeam = new Map();
export const projOf = (s) => {
  if (s?.projectKey) return s.projectKey;
  const kind = agentOf(s);
  return kind === 'claude' && s?.dir
    ? JSON.stringify(['unverified-project', kind, 'legacy-local-dir', s.dir])
    : JSON.stringify(['unverified-project', kind, 'session', s?.sessionKey || s?.id]);
};
const projectLabel = (s) => s?.git?.repo || String(s?.dir || '').split(/[\\/]/).filter(Boolean).pop() || (agentOf(s) === 'omp' ? s?.name : '') || tr('activity.live.otherProject');
// partners sit face to face across a pod's screen (back-left, then front-right…): one faces the camera, the other's
// screens do; a room fills its first pod before the second
const SEAT_ORDER = [0, 3, 1, 2, 4, 7, 5, 6];
const AREAS_KEY = 'office-areas';
/** the area a project last had on this device (people/farewell.js), or -1 */
export const areaOf = (proj) => { const u = homes[proj]?.[0]; return u != null && u < UNITS.length ? u : -1; };
export { projOf };
let homes = {};   // project -> [area, …] it had, latest first (localStorage)
try { homes = JSON.parse(localStorage.getItem(AREAS_KEY) || '{}') || {}; } catch { /* storage blocked */ }
function remember(proj, u) {
  if (replay.on) return;
  homes[proj] = [u, ...(homes[proj] || []).filter((x) => x !== u)].slice(0, 3);
  const keep = Object.keys(homes).slice(-24);   // (the 24 projects seen last)
  homes = Object.fromEntries(keep.map((k) => [k, homes[k]]));
  try { localStorage.setItem(AREAS_KEY, JSON.stringify(homes)); } catch { /* storage blocked */ }
}
const near = (a, b) => { const A = UNITS[a], B = UNITS[b]; return A.pod != null && B.pod != null ? Math.abs(A.pod - B.pod) * 2 + (A.side === B.side ? 0 : 1) : Math.abs(a - b); };
function proDesk(s) {
  if (deskOf.has(s.id)) return deskOf.get(s.id);
  const used = new Set(deskOf.values()), proj = projOf(s);
  const order = (u) => (UNITS[u].desks.length > 4 ? SEAT_ORDER.slice(0, UNITS[u].desks.length) : UNITS[u].desks.map((_, k) => k));
  const free = (u) => order(u).map((k) => UNITS[u].desks[k]).filter((d) => !used.has(d));
  const empty = (u) => free(u).length === UNITS[u].desks.length;
  const all = UNITS.map((_, u) => u), mine = all.filter((u) => rowTeam.get(u) === proj);
  const claim = (u) => { rowTeam.set(u, proj); remember(proj, u); return free(u)[0]; };
  let d = -1;
  const room = mine.find((u) => free(u).length);   // 1. its area, a desk free
  if (room != null) d = free(room)[0];
  if (d < 0) { const u = (homes[proj] || []).find((x) => x < UNITS.length && empty(x)); if (u != null) d = claim(u); }   // 2. where it sat before
  if (d < 0) {   // 3. a free area: next to its own, else one nobody calls home
    const claimed = new Set(Object.entries(homes).filter(([p]) => p !== proj).flatMap(([, us]) => us));
    const pick = all.filter(empty).sort((a, b) => (mine.length ? Math.min(...mine.map((m) => near(a, m))) - Math.min(...mine.map((m) => near(b, m))) : 0) || (claimed.has(a) - claimed.has(b)) || a - b)[0];
    if (pick != null) d = claim(pick);
  }
  if (d < 0) { let best = -1, most = 0; for (const u of all) if (free(u).length > most) { most = free(u).length; best = u; } if (best >= 0) d = free(best)[0]; }   // 4. every area taken: share
  deskOf.set(s.id, d);
  return d;
}
export function freeDesk(id) {
  if (!deskOf.has(id)) return;
  const d = deskOf.get(id); deskOf.delete(id);
  if (d >= 0 && ![...deskOf.values()].some((x) => x >= 0 && unitOfDesk[x] === unitOfDesk[d])) rowTeam.delete(unitOfDesk[d]);
}
export let teamTags;
export function updateTeamTags() {
  const here = teamTags.map((_, u) => [...sessions.values()].filter((s) => s.desk >= 0 && unitOfDesk[s.desk] === u));
  const nameOf = (u) => rowTeam.get(u) || [...new Set(here[u].map(projOf))][0] || '';
  teamTags.forEach((tg, u) => {
    // both halves of a pod with one project: one chip for the pod (on the first half), both carpets
    const twin = UNITS[u].pod != null ? u ^ 1 : -1, joined = twin >= 0 && here[twin].length && nameOf(twin) === nameOf(u);
    const people = joined ? [...here[u], ...here[twin]] : here[u];
    const projs = [...new Set(people.map(projOf))], project = nameOf(u), name = projectLabel(people.find((s) => projOf(s) === project) || people[0]), chip = here[u].length && !(joined && twin < u);
    const key = here[u].length ? `${project}|${name}|${projs.length}|${people.length}|${chip}` : '';
    if (key === tg.key) return; tg.key = key; tg.o.visible = !!chip; if (tg.rug) tg.rug.visible = !!here[u].length;
    const dept = UNITS[u].dept; if (dept >= 0) DEPT_SIGNS[dept]?.(here[u].length ? name : '');
    if (!here[u].length) return;
    const colour = PALETTE[hash(project) % PALETTE.length];
    tg.rug?.material.color.set(colour);
    if (joined && twin < u) return;
    if (joined) tg.o.position.x = (DESKS[UNITS[u].desks[0]].x + DESKS[UNITS[twin].desks[0]].x) / 2 + 1.72 * Math.sign(DESKS[UNITS[twin].desks[0]].x - DESKS[UNITS[u].desks[0]].x);
    else if (UNITS[u].pod != null) tg.o.position.x = PODS[UNITS[u].pod][0] + 1.72 * UNITS[u].side;
    tg.txt.textContent = tr('activity.live.team', { name, more: projs.length > 1 ? ` +${projs.length - 1}` : '', n: people.length });
    tg.dot.style.background = colour;
    tg.o.element.title = projs.length > 1 ? tr('activity.live.teamShared', { name, others: [...new Set(people.filter((s) => projOf(s) !== project).map(projectLabel))].join(', ') }) : tr('activity.live.teamTitle', { name });
  });
}
// Root actors take priority. The list model stays lossless; only the render projection is bounded.
export function reconcileActors(walkInId = null) {
  const roots = [];
  for (const s of sessions.values()) {
    roots.push(s);
    if (roots.length === ACTOR_BUDGET) break;
  }
  const rootIds = new Set(roots.map((s) => s.id));
  const wanted = new Map();
  let room = ACTOR_BUDGET - roots.length;
  for (const s of sessions.values()) {
    const children = s.subs || [], rendered = rootIds.has(s.id), rootKey = actorIdentity(s);
    const visible = rendered ? children.slice(0, Math.min(CHILD_ACTOR_BUDGET, room)) : [];
    room -= visible.length;
    s.actorOverflow = { root: !rendered, children: children.length - visible.length };
    if (!rendered) { freeDesk(s.id); s.desk = -1; }
    s.flattened = children.some((x) => x.parentAgentKey && x.parentAgentKey !== rootKey);
    for (const child of visible) wanted.set(childActorKey(s, child), { s, child });
  }
  for (const [key, w] of subs) {
    if (!wanted.has(key) || !rootIds.has(w.parent?.id)) {
      if (rootIds.has(w.parent?.id) && agentOf(sessions.get(w.parent?.id)) === 'claude' && !replay.on) dropSub(key);
      else { subs.delete(key); freeActor(w); }
    }
  }
  for (const [id, w] of workers) if (!rootIds.has(id)) { workers.delete(id); freeActor(w); freeDesk(id); }
  // A reconnect or a full scene must not retain an old walk-out alongside its replacement.
  const needed = roots.length + wanted.size;
  for (const w of [...leaving]) {
    if ((!w.sub && sessions.has(w.id)) || (w.sub && !sessions.has(w.parent?.id)) || actorCount() > ACTOR_BUDGET || needed + leaving.size > ACTOR_BUDGET) freeActor(w);
  }
  for (const s of roots) {
    s.desk = proDesk(s);
    let w = workers.get(s.id);
    if (!w) {
      w = addWorker(s, s.id === walkInId && agentOf(s) === 'claude' && state.connectedOnce);
    }
    if (!w) continue;
    w.setName(short(dn(s), 26)); w.setAgent(agentOf(s)); w.setAcct(agentOf(s) === 'claude' ? s.acct : '');
    w.setStuck(agentOf(s) === 'claude' ? s.stuck : null);
    w.setTeam((s.subs || []).length);
    observeActor(w, s);
  }
  for (const [key, { s, child }] of wanted) {
    const parent = workers.get(s.id);
    if (!parent) continue;
    const w = subs.get(key) || spawnSub(parent, child.id, child.type, true, child);
    if (w) {
      w.desc = child.desc || ''; w.parentAgentKey = child.parentAgentKey; w.rootSessionKey = child.rootSessionKey; w.relationKind = child.relationKind;
      observeActor(w, childObservation(s, child));
    }
  }
}
export function upsertSession(s, walkIn = true) {
  if (!s || typeof s.id !== 'string') return;
  const previous = sessions.get(s.id), had = !!previous;
  if (previous && projOf(previous) !== projOf(s)) {
    freeDesk(s.id);
    if (previous.desk >= 0) chairs[previous.desk].color.set(CHAIR_IDLE);
    for (const [key, child] of subs) if (child.parent?.id === s.id) { subs.delete(key); freeActor(child); }
    const w = workers.get(s.id);
    if (w) { workers.delete(s.id); freeActor(w); }
  }
  s.desk = deskOf.get(s.id) ?? -1;
  sessions.set(s.id, s);
  reconcileActors(walkIn && !had ? s.id : null);
  queueUi();
}
export function removeSession(id) {
  const s = sessions.get(id); sessions.delete(id); freeDesk(id);
  for (const [key, w] of subs) if (w.parent?.id === id) { subs.delete(key); freeActor(w); }
  for (const w of [...leaving]) if (w.id === id || w.parent?.id === id) freeActor(w);
  const w = workers.get(id);
  if (w) { workers.delete(id); freeActor(w); }
  if (s && s.desk >= 0) chairs[s.desk].color.set(CHAIR_IDLE);
  if (state.selectedId === id) closeSession();
  reconcileActors();
  queueUi();
}

/* each area's carpet: a border in the project's colour round its desks, on the pod's grey tiles (none for a
   department room, which has its own door plaque) */
let rugTex;
function areaRug(u) {
  if (u.dept >= 0) return null;
  rugTex ||= canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 2; g.strokeRect(15, 15, w - 30, h - 30);
  });
  const xs = u.desks.map((d) => DESKS[d].x), zs = u.desks.map((d) => DESKS[d].z);
  const x0 = Math.min(...xs) - 0.82, x1 = Math.max(...xs) + 0.82, z0 = Math.min(...zs) - 0.62, z1 = Math.max(...zs) + 0.62;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: rugTex, transparent: true, depthWrite: false, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 }));
  m.position.set((x0 + x1) / 2, 0.012, (z0 + z1) / 2); m.visible = false; m.receiveShadow = true; m.userData.dynamic = true; scene.add(m);
  return m;
}

export function setup() {
  /* ---------- live connection ---------- */
  TOKEN = new URLSearchParams(location.search).get('k') || '';
  state.connectedOnce = false;
  // a name chip over each team's pod (a department room: over the gap between its two pods): "Team website-ielts · 3"
  teamTags = UNITS.map((u) => {
    const t = el('div', 'team-tag'); const dot = el('i'), txt = el('span'); t.append(dot, txt);
    const o = new CSS2DObject(t);
    if (u.dept >= 0) o.position.set(DEPTS[u.dept].cx, 1.5, DEPTS[u.dept].cz);
    else if (u.pod != null) o.position.set(PODS[u.pod][0] + 1.72 * u.side, 1.3, PODS[u.pod][1]);
    else o.position.set(Math.max(...u.desks.map((d) => DESKS[d].x)) + 1.05, 1.3, DESKS[u.desks[0]].z);   // (the small office: at the end of the row)
    o.visible = false; scene.add(o);
    return { o, dot, txt, key: '', rug: areaRug(u) };
  });
}
