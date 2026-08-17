const storageState = new Map<string, string>()
const storage: Storage = {
  get length() {
    return storageState.size
  },
  clear: () => storageState.clear(),
  getItem: (key) => storageState.get(key) ?? null,
  key: (index) => Array.from(storageState.keys())[index] ?? null,
  removeItem: (key) => storageState.delete(key),
  setItem: (key, value) => storageState.set(key, String(value)),
}

Object.defineProperty(window, 'localStorage', { configurable: true, value: storage })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
