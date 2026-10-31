// Injected wrapper for the existing Claude store. No new hook, scanner or lifecycle owner.
export function createClaudeAdapter({ listSessions, resolveSession, publicSession, readLog }) {
  if (![listSessions, resolveSession, publicSession, readLog].every((f) => typeof f === 'function'))
    throw new TypeError('Claude adapter requires injected store and reader callbacks');
  return {
    kind: 'claude',
    list: () => listSessions().map(publicSession),
    project: publicSession,
    resolve: (id) => resolveSession(id),
    readConversation: (session, n, childId) => readLog(session, n, childId),
    start() {}, dispose() {},
  };
}
