const store = new Map();

export function saveTokens(userId, tokens) {
  store.set(userId, tokens);
}

export function getTokens(userId) {
  return store.get(userId);
}

export function clearTokens(userId) {
  store.delete(userId);
}
