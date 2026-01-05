const globalKey = "__sigil_prophecy_store__";

function getStore() {
  if (!globalThis[globalKey]) {
    globalThis[globalKey] = new Map();
  }
  return globalThis[globalKey];
}

export function saveSigil(id, entry) {
  const store = getStore();
  store.set(id, entry);
}

export function loadSigil(id) {
  const store = getStore();
  return store.get(id);
}
