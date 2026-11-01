// Phase 04 managed OMP interactive controls: composer, mode selection, queue display and abort.
// Isolated DOM module; never imports OMP runtime/server code or reuses Claude task/perm endpoints.
import { el, replay } from '../core/env.js';
import { state } from '../core/state.js';
import { TOKEN } from '../net/live.js';
import { sessions } from '../people/workers.js';
import { t as tr } from '../../i18n/index.js';
import { toast } from './activity.js';

const q = () => (TOKEN ? '?k=' + encodeURIComponent(TOKEN) : '');
const isOmpId = (id) => typeof id === 'string' && /^omp:[0-9a-f]{64}$/.test(id);
const newRequestId = () => {
  try {
    if (globalThis.crypto?.randomUUID) return 'omp-cmd-' + globalThis.crypto.randomUUID();
  } catch { /* fallback */ }
  return 'omp-cmd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
};

// Per-session composer drafts and explicit mode choice survive drawer re-renders without crossing sessions.
const drafts = new Map();
const selectedModes = new Map();
const inFlightBySession = new Map();
let abortArmSession = null, abortArmTimer = 0;

export function resetOmpControlsState() {
  drafts.clear();
  selectedModes.clear();
  inFlightBySession.clear();
  abortArmSession = null;
  clearTimeout(abortArmTimer);
}

export function ompComposerReason(s) {
  if (!s || s.agentKind !== 'omp' || !isOmpId(s.id)) return tr('drawer.unsupportedAgent');
  if (replay.on) return tr('drawer.ompControl.disabledReplay');
  if (!state.isLocal || !state.omp?.local) return tr('drawer.ompControl.disabledRemote');
  if (s.persistedOnly === true || s.lifecycle === 'historical') return tr('drawer.ompControl.disabledHistorical');
  if (s.lifecycle === 'ended') return tr('drawer.ompControl.disabledEnded');
  if (s.connection === 'disconnected' || s.connection === 'stale') return tr('drawer.ompControl.disabledDisconnected');
  const ctrl = s.control;
  if (!ctrl || ctrl.owner !== 'managed') return tr('drawer.ompControl.disabledObserverOnly');
  if (ctrl.state !== 'ready') return tr('drawer.ompControl.disabledReadOnly');
  if (!ctrl.canPrompt && !ctrl.canSteer && !ctrl.canFollowUp && !ctrl.canAbort) {
    return tr('drawer.ompControl.disabledFlagOff');
  }
  return null;
}

function commandErrorText(code) {
  const map = {
    COMMAND_DISABLED: 'drawer.ompControl.errDisabled',
    COMMAND_READ_ONLY: 'drawer.ompControl.errReadOnly',
    COMMAND_STALE_OWNER: 'drawer.ompControl.errStaleOwner',
    COMMAND_DISCONNECTED: 'drawer.ompControl.errDisconnected',
    COMMAND_SESSION_BUSY: 'drawer.ompControl.errSessionBusy',
    COMMAND_SESSION_IDLE: 'drawer.ompControl.errSessionIdle',
    COMMAND_NOTHING_TO_ABORT: 'drawer.ompControl.errNothingToAbort',
    COMMAND_TEXT_EMPTY: 'drawer.ompControl.errTextEmpty',
    COMMAND_TEXT_LIMIT: 'drawer.ompControl.errTextLimit',
    COMMAND_TEXT_INVALID: 'drawer.ompControl.errTextInvalid',
    COMMAND_RATE_LIMIT: 'drawer.ompControl.errRateLimit',
    COMMAND_BUSY: 'drawer.ompControl.errBusy',
    COMMAND_ACK_UNKNOWN: 'drawer.ompControl.errAckUnknown',
    COMMAND_STATE_UNKNOWN: 'drawer.ompControl.errStateUnknown',
    COMMAND_NOT_REMOVED: 'drawer.ompControl.errNotRemoved',
    agentLocalOnly: 'drawer.ompControl.disabledRemote',
  };
  return tr(map[code] || 'drawer.ompControl.errFailed');
}

function commandStatusText(cmd) {
  if (!cmd || !cmd.status) return '';
  const kindLabel = tr(`drawer.ompControl.kind.${cmd.kind}`) || cmd.kind;
  const statusLabel = tr(`drawer.ompControl.status.${cmd.status}`) || cmd.status;
  return `${kindLabel} · ${statusLabel}`;
}

export async function sendOmpCommand(sessionSnapshot, { kind, text, queue, requestId } = {}, onUpdate = () => {}) {
  if (replay.on || !state.isLocal || !sessionSnapshot || sessionSnapshot.agentKind !== 'omp') {
    return { ok: false, code: 'COMMAND_DISABLED' };
  }
  // Bind target at click time; switching drawer selection mid-flight never redirects the command.
  const targetId = sessionSnapshot.id;
  const runtimeInstanceId = sessionSnapshot.control?.runtimeInstanceId;
  const generation = sessionSnapshot.control?.generation;
  if (!isOmpId(targetId) || typeof runtimeInstanceId !== 'string' || !Number.isSafeInteger(generation)) {
    return { ok: false, code: 'COMMAND_STALE_OWNER' };
  }
  const reqId = requestId || newRequestId();
  const payload = {
    id: targetId,
    runtimeInstanceId,
    generation,
    requestId: reqId,
    kind,
    ...(text !== undefined ? { text } : {}),
    ...(queue !== undefined ? { queue } : {}),
  };

  inFlightBySession.set(targetId, { requestId: reqId, kind, status: 'pending' });
  onUpdate();
  try {
    const r = await fetch('/api/omp/control/command' + q(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await r.json().catch(() => ({ ok: false, code: 'COMMAND_FAILED' }));
    if (d.ok) {
      inFlightBySession.set(targetId, { requestId: reqId, kind, status: d.status || 'accepted' });
      if (kind === 'prompt' || kind === 'steer' || kind === 'followUp') {
        drafts.delete(targetId);
      }
    } else {
      const unknown = d.code === 'COMMAND_ACK_UNKNOWN' || d.status === 'unknown';
      inFlightBySession.set(targetId, {
        requestId: reqId,
        kind,
        status: unknown ? 'unknown' : 'failed',
        errorCode: d.code || 'COMMAND_FAILED',
      });
      toast(commandErrorText(d.code));
    }
    return d;
  } catch {
    inFlightBySession.set(targetId, {
      requestId: reqId,
      kind,
      status: 'unknown',
      errorCode: 'COMMAND_ACK_UNKNOWN',
    });
    toast(tr('drawer.ompControl.errAckUnknown'));
    return { ok: false, code: 'COMMAND_ACK_UNKNOWN', status: 'unknown' };
  } finally {
    onUpdate();
  }
}

export function appendOmpControlComposer(box, s, onRefresh = () => {}) {
  if (!box || !s || s.agentKind !== 'omp') return;
  if (!state.omp?.on && s.control?.owner !== 'managed') return;
  const wrap = el('section', 'omp-control-panel');
  wrap.dataset.ompSession = s.id;
  wrap.setAttribute('aria-label', tr('drawer.ompControl.title'));

  const reason = ompComposerReason(s);
  const ctrl = s.control || {};
  const canPrompt = !reason && ctrl.canPrompt === true;
  const canSteer = !reason && ctrl.canSteer === true;
  const canFollowUp = !reason && ctrl.canFollowUp === true;
  const canAbort = !reason && ctrl.canAbort === true;
  const canQueueRemove = !reason && ctrl.canQueueRemove === true;
  const localFlight = inFlightBySession.get(s.id);
  const serverLast = ctrl.lastCommand;
  const activeStatus = localFlight?.status === 'pending' ? localFlight : (serverLast || localFlight);

  // Status banner (distinguishes RPC ACK accepted vs running vs settled vs unknown)
  if (activeStatus) {
    const pill = el('div', 'omp-cmd-status');
    pill.dataset.status = activeStatus.status || 'unknown';
    pill.setAttribute('role', 'status');
    pill.textContent = commandStatusText(activeStatus);
    wrap.append(pill);
  }

  if (reason) {
    const note = el('p', 'dr-note omp-control-disabled-reason', reason);
    note.dataset.ompReason = 'disabled';
    wrap.append(note);
  }

  // Explicit mode selector: user chooses Prompt (when idle) vs Steer / Follow-up (when busy). No silent fallback.
  const currentMode = selectedModes.get(s.id) || (canPrompt ? 'prompt' : canSteer ? 'steer' : 'followUp');
  selectedModes.set(s.id, currentMode);

  const modeBar = el('div', 'omp-mode-bar');
  modeBar.setAttribute('role', 'group');
  modeBar.setAttribute('aria-label', tr('drawer.ompControl.modeLabel'));

  const modes = [
    ['prompt', tr('drawer.ompControl.modePrompt'), canPrompt, tr('drawer.ompControl.modePromptHint')],
    ['steer', tr('drawer.ompControl.modeSteer'), canSteer, tr('drawer.ompControl.modeSteerHint')],
    ['followUp', tr('drawer.ompControl.modeFollowUp'), canFollowUp, tr('drawer.ompControl.modeFollowUpHint')],
  ];
  for (const [modeKey, label, allowed, hint] of modes) {
    const b = el('button', 'btn btn--sm omp-mode-btn', label);
    b.type = 'button';
    b.dataset.ompMode = modeKey;
    b.setAttribute('aria-pressed', String(currentMode === modeKey));
    b.disabled = Boolean(reason) || localFlight?.status === 'pending';
    b.title = allowed ? hint : (reason || tr(modeKey === 'prompt' ? 'drawer.ompControl.errSessionBusy' : 'drawer.ompControl.errSessionIdle'));
    b.addEventListener('click', () => {
      selectedModes.set(s.id, modeKey);
      onRefresh();
    });
    modeBar.append(b);
  }
  wrap.append(modeBar);

  // Composer form
  const form = el('form', 'omp-composer-form');
  const input = el('textarea', 'omp-composer-input');
  input.rows = 2;
  input.maxLength = 8000;
  input.placeholder = reason || tr(`drawer.ompControl.placeholder.${currentMode}`);
  input.value = drafts.get(s.id) || '';
  input.disabled = Boolean(reason) || localFlight?.status === 'pending';
  input.setAttribute('aria-label', tr('drawer.ompControl.inputLabel'));
  input.addEventListener('input', () => {
    drafts.set(s.id, input.value);
  });

  const modeEligible = (currentMode === 'prompt' && canPrompt) ||
    (currentMode === 'steer' && canSteer) ||
    (currentMode === 'followUp' && canFollowUp);

  const actionsRow = el('div', 'omp-composer-actions');
  const sendBtn = el('button', 'btn btn--primary btn--sm omp-send-btn', tr(`drawer.ompControl.send.${currentMode}`));
  sendBtn.type = 'submit';
  sendBtn.dataset.ompSend = currentMode;
  sendBtn.disabled = Boolean(reason) || !modeEligible || localFlight?.status === 'pending';
  if (!modeEligible && !reason) {
    sendBtn.title = tr(currentMode === 'prompt' ? 'drawer.ompControl.errSessionBusy' : 'drawer.ompControl.errSessionIdle');
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const bound = sessions.get(s.id);
    if (!bound || bound.id !== s.id) return;
    const text = input.value;
    if (!text.trim()) {
      toast(tr('drawer.ompControl.errTextEmpty'));
      return;
    }
    sendBtn.disabled = true;
    await sendOmpCommand(bound, { kind: currentMode, text }, onRefresh);
  });

  actionsRow.append(sendBtn);

  // Abort button (two-step confirmation when busy, never kills process)
  const armed = abortArmSession === s.id;
  const abortBtn = el('button', 'btn btn--sm omp-abort-btn' + (armed ? ' btn--danger' : ''),
    tr(armed ? 'drawer.ompControl.abortConfirm' : 'drawer.ompControl.abort'));
  abortBtn.type = 'button';
  abortBtn.dataset.ompAbort = s.id;
  abortBtn.disabled = !canAbort || localFlight?.status === 'pending';
  abortBtn.title = canAbort ? tr('drawer.ompControl.abortHint') : (reason || tr('drawer.ompControl.errNothingToAbort'));
  abortBtn.addEventListener('click', async () => {
    const bound = sessions.get(s.id);
    if (!bound || !bound.control?.canAbort) return;
    if (abortArmSession !== s.id) {
      abortArmSession = s.id;
      clearTimeout(abortArmTimer);
      abortArmTimer = setTimeout(() => {
        if (abortArmSession === s.id) { abortArmSession = null; onRefresh(); }
      }, 4000);
      onRefresh();
      return;
    }
    abortArmSession = null;
    clearTimeout(abortArmTimer);
    abortBtn.disabled = true;
    await sendOmpCommand(bound, { kind: 'abort' }, onRefresh);
  });
  actionsRow.append(abortBtn);

  form.append(input, actionsRow);
  wrap.append(form);

  // Queued messages display (steering + followUp)
  const queued = ctrl.queued;
  if (queued && (queued.steering?.length || queued.followUp?.length)) {
    const qBox = el('div', 'omp-queue-list');
    qBox.setAttribute('aria-label', tr('drawer.ompControl.queueTitle'));
    const addChip = (text, qKind, idx) => {
      const row = el('div', 'omp-queue-chip');
      row.dataset.queueKind = qKind;
      const badge = el('span', 'omp-queue-badge', tr(qKind === 'steering' ? 'drawer.ompControl.modeSteer' : 'drawer.ompControl.modeFollowUp'));
      const body = el('span', 'omp-queue-text', text);
      row.append(badge, body);
      const lockedSteer = qKind === 'steering' && idx < (queued.liveSteered || 0);
      if (canQueueRemove && !lockedSteer) {
        const rm = el('button', 'btn btn--sm omp-queue-remove', tr('drawer.ompControl.queueRemove'));
        rm.type = 'button';
        rm.dataset.ompQueueRemove = qKind;
        rm.disabled = localFlight?.status === 'pending';
        rm.addEventListener('click', async () => {
          const bound = sessions.get(s.id);
          if (!bound) return;
          rm.disabled = true;
          await sendOmpCommand(bound, { kind: 'queueRemove', text, queue: qKind }, onRefresh);
        });
        row.append(rm);
      }
      qBox.append(row);
    };
    (queued.steering || []).forEach((t, idx) => addChip(t, 'steering', idx));
    (queued.followUp || []).forEach((t, idx) => addChip(t, 'followUp', idx));
    wrap.append(qBox);
  }

  box.append(wrap);
}
