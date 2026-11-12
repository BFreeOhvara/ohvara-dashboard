// P972: a client with no chat yet still gets one ("Message the team about Ann"). It lives on this device until its
// first message, then shows in Messages like any other (front end first: the real write is the threads backend's).
const listeners = new Set()
let threads = []
export const subscribeLocal = f => { listeners.add(f); return () => { listeners.delete(f) } }
export const getLocal = () => threads
const setLocal = next => { threads = next; listeners.forEach(f => f()) }

// The chat about this client: theirs if there is one, else a new one on this device.
export function threadIdFor(list, c) {
  const have = list.find(t => t.client_id === c.id)
  if (have) return have.id
  const id = `new-${c.id}`
  if (!threads.some(t => t.id === id)) setLocal([...threads, { id, client_id: c.id, name: `${c.client_first_name} ${c.client_last_name}`, unread: 0, messages: [], local: true }])
  return id
}
export const sendLocal = (id, text, at) => setLocal(threads.map(t => (t.id === id ? { ...t, messages: [...t.messages, { id: `l${t.messages.length}-${text.length}`, from: 'me', text, at }] } : t)))

// "Today, 9:40 AM" → "9:40 AM"; drops the year.
export const shortAt = at => String(at || '').replace(/^Today, /, '').replace(/, \d{4}/, '')
