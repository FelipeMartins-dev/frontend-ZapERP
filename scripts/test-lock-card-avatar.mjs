/**
 * Trava de avatar no card — não alternar URLs no mesmo conversa_id.
 * Run: node --import ./scripts/vite-env-shim.mjs scripts/test-lock-card-avatar.mjs
 */

import { lockCardAvatarUrl, isHttpAvatarUrl } from "../src/chats/chatListDisplay.js"

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

assert(isHttpAvatarUrl("https://cdn/a.jpg") === true, "http ok")
assert(isHttpAvatarUrl("") === false, "empty")

let locked = { identity: null, url: null }
locked = lockCardAvatarUrl(locked, "conv:1", "https://cdn/atual.jpg")
assert(locked.url === "https://cdn/atual.jpg", "primeira url")

locked = lockCardAvatarUrl(locked, "conv:1", "https://cdn/antiga.jpg")
assert(locked.url === "https://cdn/atual.jpg", "mantém atual — ignora antiga")

locked = lockCardAvatarUrl(locked, "conv:1", null)
assert(locked.url === "https://cdn/atual.jpg", "mantém se incoming null")

locked = lockCardAvatarUrl(locked, "conv:2", "https://cdn/outro.jpg")
assert(locked.url === "https://cdn/outro.jpg", "troca só se mudar conversa")

console.log("ok: lockCardAvatarUrl (anti-pulo no card)")
