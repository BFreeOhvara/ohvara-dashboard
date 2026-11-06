// P855: a read that came back null (migration 231 not applied: the function or table 404s) or failed is not asked again
// by the clock, on remount or on a timer; the pages keep their sample rota and the backend is not called every ~40 s.
// A real answer (rows) is stale after 30 s as before. A page reload asks once more.
export const askAgainUnlessMissing = (every = false) => ({
  retry: false,
  retryOnMount: false,
  staleTime: q => (q.state.data === null || q.state.status === 'error' ? Infinity : 30e3),
  ...(every ? { refetchInterval: q => (q.state.data === null || q.state.status === 'error' ? false : every) } : {}),
})
