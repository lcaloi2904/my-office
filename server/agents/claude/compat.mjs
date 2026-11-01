// Injected wrapper for the existing Claude store. No new hook, scanner or lifecycle owner.
import { conversationPage, CONVERSATION_LIMIT, emptyConversationPage } from '../conversation.mjs';
export function createClaudeAdapter({ listSessions, resolveSession, publicSession, readLog, readLogEntries }) {
  if (![listSessions, resolveSession, publicSession, readLog].every((f) => typeof f === 'function'))
    throw new TypeError('Claude adapter requires injected store and reader callbacks');
  return {
    kind: 'claude',
    list: () => listSessions().map(publicSession),
    project: publicSession,
    resolve: (id) => resolveSession(id),
    readConversation: (session, n, childId) => readLog(session, n, childId),
    async readConversationPage(session, limit, childId = null, before = null) {
      try {
        const result = typeof readLogEntries === 'function' ? await readLogEntries(session, CONVERSATION_LIMIT + 1, childId)
          : { items: await readLog(session, CONVERSATION_LIMIT + 1, childId), incomplete: false };
        return conversationPage(result?.items, { id: session.id, childId, limit, before, incomplete: result?.incomplete === true });
      } catch { return emptyConversationPage(); }
    },
    start() {}, dispose() {},
  };
}
