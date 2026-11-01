// Opaque, snapshot-scoped cursors. No paths, transcript text or durable content cache.
import { createHash } from 'node:crypto';

export const CONVERSATION_LIMIT = 4096;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const emptyConversationPage = (incomplete = true) => ({ items: [], nextCursor: null, incomplete });

export function conversationPage(items, { id, childId = null, limit = 120, before = null, incomplete = false } = {}) {
  if (!Array.isArray(items)) return emptyConversationPage();
  const size = Number.isSafeInteger(limit) ? Math.min(120, Math.max(0, limit)) : 120;
  if (!size) return emptyConversationPage(incomplete);
  const bounded = items.slice(-CONVERSATION_LIMIT), scope = hash([id, childId, bounded]);
  let end = bounded.length;
  if (before !== null) {
    if (typeof before !== 'string' || before.length > 256 || !/^[A-Za-z0-9_-]+$/.test(before)) return emptyConversationPage();
    try {
      const cursor = JSON.parse(Buffer.from(before, 'base64url').toString('utf8'));
      if (!Array.isArray(cursor) || cursor.length !== 3 || cursor[0] !== 1 || cursor[1] !== scope ||
        !Number.isSafeInteger(cursor[2]) || cursor[2] < 1 || cursor[2] > bounded.length) return emptyConversationPage();
      end = cursor[2];
    } catch { return emptyConversationPage(); }
  }
  const start = Math.max(0, end - size);
  return { items: bounded.slice(start, end),
    nextCursor: start ? Buffer.from(JSON.stringify([1, scope, start])).toString('base64url') : null,
    incomplete: incomplete || items.length > CONVERSATION_LIMIT };
}
