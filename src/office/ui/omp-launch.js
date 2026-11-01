// Phase 03 native Windows OMP launcher UI. No composer, approval or external TUI controls.
import { el, replay } from '../core/env.js';
import { state } from '../core/state.js';
import { TOKEN } from '../net/live.js';
import { t as tr } from '../../i18n/index.js';
import { toast } from './activity.js';

const q = () => TOKEN ? '?k=' + encodeURIComponent(TOKEN) : '';
const available = () => !replay.on && !!(state.omp?.on && state.omp.local) && state.isLocal;
const isId = (s) => typeof s === 'string' && /^omp:[0-9a-f]{64}$/.test(s);
let status = null, pendingStatus = null, dialog = null, launching = false;

export async function ompLaunchStatus({ refresh = false } = {}) {
  if (!available()) return { enabled: false, resumeAvailable: false };
  if (!refresh && status) return status;
  if (pendingStatus) return pendingStatus;
  pendingStatus = fetch('/api/omp/control/status' + q(), { cache: 'no-store' })
    .then(async (r) => {
      if (!r.ok) return { enabled: false };
      const d = await r.json();
      return d?.ok && d.enabled === true && Array.isArray(d.projects) && Array.isArray(d.profiles)
        ? { enabled: true, projects: d.projects.filter((p) => /^[\w.-]{1,64}$/.test(p.alias)),
          profiles: d.profiles.filter((p) => /^[\w.-]{1,64}$/.test(p.alias)),
          resumeAvailable: d.resumeAvailable === true } : { enabled: false };
    })
    .catch(() => ({ enabled: false }))
    .then((d) => { status = d; return d; })
    .finally(() => { pendingStatus = null; });
  return pendingStatus;
}

function field(label, items, name) {
  const wrap = el('label', 'omp-launch-field', tr(label)), select = el('select');
  select.name = name; select.required = true;
  for (const item of items) {
    const option = el('option', null, item.alias);
    option.value = item.alias; select.append(option);
  }
  wrap.append(select); return { wrap, select };
}

export async function openOmpLauncher({ candidateId = null } = {}) {
  if (!available() || launching || (candidateId != null && !isId(candidateId))) return;
  const d = await ompLaunchStatus({ refresh: true });
  if (!available() || !d.enabled || (candidateId && !d.resumeAvailable)) return;
  if (!dialog) {
    dialog = el('dialog', 'omp-dlg omp-launch-dlg');
    dialog.setAttribute('aria-labelledby', 'omp-launch-title');
    document.body.append(dialog);
  }
  const title = el('h2', null, tr(candidateId ? 'activity.omp.resume' : 'activity.omp.newSession'));
  title.id = 'omp-launch-title';
  const note = el('p', 'dr-note', tr(candidateId ? 'activity.omp.resumeNote' : 'activity.omp.newNote'));
  const form = el('form', 'omp-launch-form');
  const project = field('activity.omp.projectLabel', d.projects, 'projectAlias');
  const profile = field('activity.omp.profileLabel', d.profiles, 'profileAlias');
  const submit = el('button', 'btn btn--primary btn--sm', tr(candidateId ? 'activity.omp.resume' : 'activity.omp.create'));
  submit.type = 'submit';
  const close = el('button', 'btn btn--sm', tr('activity.omp.close'));
  close.type = 'button'; close.addEventListener('click', () => dialog.close());
  const msg = el('p', 'dr-note'); msg.setAttribute('role', 'status');
  form.append(project.wrap, profile.wrap, submit, close);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!available() || launching) return;
    launching = true; submit.disabled = true; close.disabled = true;
    try {
      const body = { mode: candidateId ? 'resume' : 'new', projectAlias: project.select.value, profileAlias: profile.select.value,
        ...(candidateId ? { candidateId } : {}) };
      const r = await fetch('/api/omp/control/launch' + q(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const reply = await r.json().catch(() => ({}));
      if (!available()) return;
      if (!r.ok || !reply.ok) {
        const errors = { LAUNCH_OWNER_UNVERIFIED: 'activity.omp.resumeUnavailable',
          LAUNCH_OWNER_CONFLICT: 'activity.omp.resumeUnavailable', LAUNCH_OWNER_UNKNOWN: 'activity.omp.resumeUnavailable',
          LAUNCH_WINDOWS_ONLY: 'activity.omp.launchUnavailable', LAUNCH_BUSY: 'activity.omp.launchBusy' };
        msg.textContent = tr(errors[reply.code] || 'activity.omp.launchFailed');
        return;
      }
      dialog.close();
      toast(tr(candidateId ? 'activity.omp.resumed' : 'activity.omp.created'));
    } catch {
      if (available()) msg.textContent = tr('activity.omp.launchFailed');
    } finally { launching = false; submit.disabled = !available(); close.disabled = false; }
  });
  dialog.replaceChildren(title, note, form, msg);
  dialog.showModal();
}

// Appends just the new/resume actions; existing Hide/Pin and Claude controls remain unchanged.
export function appendOmpLaunchActions(box, candidateId = null) {
  if (!available() || !box) return;
  const area = el('div', 'omp-launch-actions');
  box.append(area);
  void ompLaunchStatus().then((d) => {
    if (!available() || !area.isConnected || !d.enabled) return;
    const create = el('button', 'btn btn--sm', tr('activity.omp.newSession'));
    create.type = 'button';
    create.dataset.ompAction = 'new';
    create.addEventListener('click', () => { void openOmpLauncher(); });
    area.append(create);
    if (candidateId && isId(candidateId)) {
      const resume = el('button', 'btn btn--sm', tr('activity.omp.resume'));
      resume.type = 'button'; resume.dataset.ompAction = 'resume';
      resume.disabled = !d.resumeAvailable;
      resume.title = tr(d.resumeAvailable ? 'activity.omp.resumeNote' : 'activity.omp.resumeUnavailable');
      resume.addEventListener('click', () => { void openOmpLauncher({ candidateId }); });
      area.append(resume);
    }
  });
}

export function appendOmpResumeToRow(row, candidateId) {
  if (!available() || !isId(candidateId)) return;
  const resume = el('button', 'btn btn--sm omp-resume', tr('activity.omp.resume'));
  resume.type = 'button'; resume.hidden = true;
  row.append(resume);
  void ompLaunchStatus().then((d) => {
    if (!row.isConnected || !available() || !d.enabled) return;
    resume.hidden = false; resume.disabled = !d.resumeAvailable;
    resume.title = tr(d.resumeAvailable ? 'activity.omp.resumeNote' : 'activity.omp.resumeUnavailable');
  });
  resume.addEventListener('click', () => { void openOmpLauncher({ candidateId }); });
}

export function appendOmpNewToHistory(dialog) {
  if (!available() || !dialog) return;
  const button = el('button', 'btn btn--sm omp-launch-new', tr('activity.omp.newSession'));
  button.type = 'button'; button.hidden = true;
  dialog.append(button);
  void ompLaunchStatus({ refresh: true }).then((d) => {
    if (dialog.isConnected && available()) button.hidden = !d.enabled;
  });
  button.addEventListener('click', () => { void openOmpLauncher(); });
}

export function closeOmpLaunchOnReplay() { if (replay.on) dialog?.close(); }
