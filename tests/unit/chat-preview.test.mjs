import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Evaluate the actual preview boundary, without importing Three.js or starting the app.
const source = fs.readFileSync(new URL('../../src/office/ui/group-chat-view.js', import.meta.url), 'utf8');
const start = source.indexOf('let peekTimer = 0;');
const end = source.indexOf('\nonChat(', start);
assert.ok(start >= 0 && end > start, 'preview declaration boundary exists');

function previewFixture({ drawer = false, open = false, photo = false } = {}) {
  const nodes = new Map(), timers = [], cancelled = [];
  const chat = { open, unread: 7 };
  const node = (tag, className, text) => ({
    tag, className, text, children: [], hidden: false, classes: new Set(),
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener() {},
    get classList() { return { add: (c) => this.classes.add(c), remove: (c) => this.classes.delete(c) }; },
  });
  const dependencies = {
    chat, photoOn: () => photo,
    document: {
      querySelector: (selector) => { assert.equal(selector, '.drawer:not([hidden])'); return drawer ? {} : null; },
      body: { append: (n) => nodes.set(n.id, n) },
    },
    $: (id) => nodes.get(id), el: node, mask: (s) => s, tr: (key) => key,
    groupAvatar: () => node('span'), toggle() {},
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; },
    clearTimeout: (id) => cancelled.push(id),
  };
  const peek = vm.runInNewContext(source.slice(start, end) + '\n;peek', dependencies, { timeout: 1000 });
  return { peek, nodes, timers, cancelled, chat };
}

const message = { kind: 'text', from: 'reception', name: 'Reception', text: 'Synthetic notification' };

test('actual preview is suppressed while a drawer is open, without changing unread state', () => {
  const f = previewFixture({ drawer: true });
  f.peek(message);
  assert.equal(f.nodes.size, 0);
  assert.equal(f.timers.length, 0);
  assert.equal(f.chat.unread, 7, 'presentation must not consume unread messages');
});

test('actual preview remains available without drawers and keeps its fade lifecycle', () => {
  const f = previewFixture();
  f.peek(message);
  const p = f.nodes.get('zc-peek');
  assert.ok(p);
  assert.equal(p.hidden, false);
  assert.equal(f.timers[0].delay, 4200);
  f.timers[0].fn();
  assert.equal(p.classes.has('is-out'), true);
  assert.equal(f.timers[1].delay, 300);
  f.timers[1].fn();
  assert.equal(p.hidden, true);
  assert.equal(f.chat.unread, 7);
});

test('existing chat-open, self, system and photo suppression stays intact', () => {
  for (const [opts, input] of [[{ open: true }, message], [{ photo: true }, message],
    [{}, { ...message, from: 'me' }], [{}, { ...message, kind: 'sys' }]]) {
    const f = previewFixture(opts);
    f.peek(input);
    assert.equal(f.nodes.size, 0);
    assert.equal(f.timers.length, 0);
  }
});
