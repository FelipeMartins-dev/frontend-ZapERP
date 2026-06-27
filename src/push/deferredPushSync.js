import { syncPushSubscriptionSilently } from "./webPushClient"

const MOBILE_PUSH_AFTER_LIST_DELAY_MS = 3500
const MOBILE_PUSH_ENTRY_MAX_WAIT_MS = 12000

let mobileEntryReady = false
let mobileEntryFallbackTimer = null
let readyCallbacks = new Set()
let pushSyncScheduled = false
let pushSyncRunning = false
let pushSyncQueued = false

function isMobileViewport() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  return window.matchMedia("(max-width: 640px)").matches
}

function scheduleIdle(callback, delayMs = 0) {
  if (typeof window === "undefined") return () => {}
  let cancelled = false
  let delayTimer = null
  let idleId = null
  let fallbackTimer = null

  const run = () => {
    if (cancelled) return
    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(
        () => {
          if (!cancelled) callback()
        },
        { timeout: 2500 }
      )
    } else {
      fallbackTimer = window.setTimeout(() => {
        if (!cancelled) callback()
      }, 0)
    }
  }

  delayTimer = window.setTimeout(run, Math.max(0, delayMs))

  return () => {
    cancelled = true
    if (delayTimer != null) window.clearTimeout(delayTimer)
    if (fallbackTimer != null) window.clearTimeout(fallbackTimer)
    if (idleId != null && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idleId)
    }
  }
}

function flushReadyCallbacks() {
  if (mobileEntryFallbackTimer != null) {
    window.clearTimeout(mobileEntryFallbackTimer)
    mobileEntryFallbackTimer = null
  }
  const callbacks = Array.from(readyCallbacks)
  readyCallbacks.clear()
  callbacks.forEach((callback) => callback())
}

export function markPushEntryReady() {
  if (!isMobileViewport()) return
  if (mobileEntryReady) return
  mobileEntryReady = true
  flushReadyCallbacks()
}

export function runAfterPushEntryReady(callback) {
  if (typeof window === "undefined") return () => {}
  const mobile = isMobileViewport()
  if (!mobile || mobileEntryReady) {
    return scheduleIdle(callback, mobile ? MOBILE_PUSH_AFTER_LIST_DELAY_MS : 0)
  }

  let cancelled = false
  let cancelIdle = null
  const wrapped = () => {
    if (!cancelled) {
      cancelIdle = scheduleIdle(callback, MOBILE_PUSH_AFTER_LIST_DELAY_MS)
    }
  }
  readyCallbacks.add(wrapped)

  if (mobileEntryFallbackTimer == null) {
    mobileEntryFallbackTimer = window.setTimeout(() => {
      mobileEntryReady = true
      flushReadyCallbacks()
    }, MOBILE_PUSH_ENTRY_MAX_WAIT_MS)
  }

  return () => {
    cancelled = true
    readyCallbacks.delete(wrapped)
    if (cancelIdle) cancelIdle()
  }
}

export function schedulePushSubscriptionSync() {
  if (pushSyncScheduled) {
    pushSyncQueued = true
    return
  }
  pushSyncScheduled = true

  runAfterPushEntryReady(() => {
    pushSyncScheduled = false
    if (pushSyncRunning) {
      pushSyncQueued = true
      return
    }

    pushSyncRunning = true
    syncPushSubscriptionSilently()
      .catch(() => {})
      .finally(() => {
        pushSyncRunning = false
        if (pushSyncQueued) {
          pushSyncQueued = false
          schedulePushSubscriptionSync()
        }
      })
  })
}
