// Ctrl+K on Windows, ⌘K on a Mac: the key that opens search in the agent shell.
export const isSearchKey = e => (e.ctrlKey || e.metaKey) && e.key?.toLowerCase() === 'k'
