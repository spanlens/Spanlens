// No-op stub for @supabase/realtime-js used in the Edge Runtime middleware.
//
// The real package depends on `ws`, which references __dirname at module
// init time — undefined in Edge Runtime → ReferenceError on every request.
// Aliasing the entire package to `false` (empty object) makes
// `new RealtimeClient()` throw "RealtimeClient is not a constructor"
// because @supabase/supabase-js instantiates it unconditionally during
// client construction.
//
// This stub exposes the same shape the JS client expects, with all
// methods as no-ops. Middleware never uses Realtime subscriptions, so
// this is safe — and importantly, it has no __dirname / ws references.

export class RealtimeChannel {
  on() {
    return this
  }
  subscribe() {
    return this
  }
  unsubscribe() {
    return Promise.resolve('ok')
  }
  send() {
    return Promise.resolve('ok')
  }
  track() {
    return Promise.resolve('ok')
  }
  untrack() {
    return Promise.resolve('ok')
  }
}

export class RealtimePresence {}

export class RealtimeClient {
  constructor() {
    this.channels = []
    this.accessToken = null
  }
  channel() {
    return new RealtimeChannel()
  }
  removeChannel() {
    return Promise.resolve('ok')
  }
  removeAllChannels() {
    return Promise.resolve(['ok'])
  }
  getChannels() {
    return []
  }
  setAuth() {
    /* no-op */
  }
  connect() {
    /* no-op */
  }
  disconnect() {
    return { error: null, data: { connected: false } }
  }
  isConnected() {
    return false
  }
}

export default {
  RealtimeClient,
  RealtimeChannel,
  RealtimePresence,
}
