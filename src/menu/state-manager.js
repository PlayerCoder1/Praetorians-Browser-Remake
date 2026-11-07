/* Small history-based screen state. No Babylon dependency. */
export function createScreenStore(start = 'main') {
  let screen = start;
  const history = [];
  const listeners = new Set();
  const emit = () => { for (const listener of listeners) listener(screen); };
  return {
    get current() { return screen; },
    get previous() { return history.at(-1) ?? 'main'; },
    go(next) { if (next === screen) return; history.push(screen); screen = next; emit(); },
    back() { screen = history.pop() ?? 'main'; emit(); },
    reset(next='main') { history.length=0; screen=next; emit(); },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}
