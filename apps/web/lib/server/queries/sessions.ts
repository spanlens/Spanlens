// Sessions list is fetched entirely client-side (useSessions). The default
// 30-day window makes the `from` bound dynamic, so a server prefetch key would
// never match the client's first query. Intentionally no prefetch spec here.
export {}
