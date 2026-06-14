# Progressive Operator — Phase Plan
## Repo: progressive_operator
## Source of truth: zip archives. GitHub is behind.

---

## Current Version: v3.21 (cache: prog-op-v3.21)

---

## Repo Overview
WAP Progressive Jackpot operator controller PWA. PIN-protected. Manages the wide-area progressive pot, monitors connected players, force-arms jackpots, broadcasts messages.

---

## Phase History

### v2.4 — Foundation
- Splash + PIN + username
- Dashboard: pot value, contrib rate, hit count, connected devices, armed status
- Settings: seed, ceiling, contrib rate, trigger odds
- History: hit history + operator audit log
- Force tab: arm jackpot, test contribution
- Messages: broadcast to all players
- 15 bugs fixed (BUG-01 through BUG-16)

### v3.8 — WABC Removal + Player Tracking
- All WABC code removed from Settings tab
- presence filter excludes wabc_operator and floor_operator
- Player active/inactive tracking fixed (updateLastSpin() added)
- Splash version corrected to v3.8
- Cache bust: prog-op-v3.8

---

## Pending
- [ ] Connected players showing correctly with multiple game clients
- [ ] Force jackpot end-to-end test with v5.51 armAndClaim fix
- [ ] progressive_hits history verified writing from games
- [ ] Broadcast messages verified received by game clients

---

## Rules
- ES5 only
- All logic inline in index.html — progressive.js in repo is dead code
- Cache bust on every single build

### v3.10 — SDK Cleanup + Splash Fix (CORRUPTED — rebuilt from source)
- File was corrupted during duplicate splash removal — entire HTML embedded in killSplash
- Rebuilt from original v2.7 source and reapplied all changes cleanly
- killSplash fixed to remove splash from DOM (Samsung Browser fix)
- splashError() added — stops loading bar, shows red error + RETRY button
- All setTimeout(initSupabase) retry loops replaced with splashError()
- SDK cleanup added — clears stale window.supabase before each retry
- Cache bust: prog-op-v3.10

### v3.11 — WABC Section Fully Removed
- WABC Settings section was still present after rebuild (renderBallCaller, _renderBallGrid)
- Removed: renderBallCaller(), _renderBallGrid(), issueNewBallCall()
- Removed: resetBallPos(), forceLocalBall(), restoreWideBall(), loadBallCallState()
- Removed: _ballCallState var, _ballCallerChannel subscription, loadBallCallState() call in showTab
- Progressive Operator now has zero WABC code — WABC tool handles everything
- Cache bust: prog-op-v3.11

---

## Current Version: v3.11 (cache: prog-op-v3.11)

## Pending
- [ ] Verify WABC section gone on device
- [ ] Connected players showing correctly
- [ ] Force jackpot end-to-end test
- [ ] progressive_hits records writing correctly

### v3.12 — CRITICAL: Legacy JWT Anon Key Fix
- Same fix — sb_publishable_ broken for Realtime WebSocket
- Cache bust: prog-op-v3.12

### v3.13 — Bug A: Player Count Exclusion Fix
- _syncPresence/_updatePresenceCounts/connected-list filters now also exclude
  'wabc_operator' and 'floor_operator' (previously only excluded 'operator').
  WABC and/or Floor Manager being open no longer inflate Progressive
  Operator's connected-player count.
- Cache bust: prog-op-v3.13

### v3.14 — Fixed Missing _gameName() Function
- _gameName() was called in 6 places (Realtime notification toasts, hit
  history, presence player list) but NEVER DEFINED — every
  progressive_commands/progressive_hits Realtime event threw
  "ReferenceError: _gameName is not defined", crashing those callbacks.
- Added _gameName() + PROG_GAME_TITLES lookup table (matches
  progressive.js in game repos).
- SEPARATE DATABASE ISSUE FOUND (not fixable from this repo): the
  progressive_hit RPC function does not exist in Supabase at all
  ("Could not find the function public.progressive_hit(reset_to) in the
  schema cache"). This is the root cause of the pot never resetting after
  jackpot wins. SQL to create it provided to Sasha for Supabase SQL Editor.
- Cache bust: prog-op-v3.14

### Service Worker + Supabase Client Hardening (this batch)
- service-worker.js fetch handler rewritten with proper guards:
  - Non-GET requests (POST/PATCH/PUT/DELETE) are no longer intercepted at
    all -> eliminates "cache.put: Request method X is unsupported" errors
    on every Supabase RPC/insert/update.
  - ANY supabase.co request is passed straight to network, never cached ->
    eliminates risk of stale cached API responses masking live DB changes,
    and removes these requests from the JS/HTML cache-refresh branch.
  - 206 Partial Content responses (audio/video range requests) are no
    longer passed to cache.put -> eliminates "Partial response (206)
    unsupported" errors.
- createClient() calls now pass { auth: { persistSession:false,
  detectSessionInUrl:false, storage: <in-memory no-op> } } — avoids
  Supabase client touching localStorage at all, which browsers with
  Tracking Prevention (Safari ITP, Samsung Browser) were silently
  blocking ("Tracking Prevention blocked access to storage for
  ...supabase-js...") and which also triggered "Multiple GoTrueClient
  instances" warnings.
These changes target the console error noise seen across every tool in
this session's logs and may also help Realtime stability (all channels
share one client/connection). 0-players root cause still unconfirmed —
retest after this deploy with game + operator tool open simultaneously.

KNOWN OPEN ISSUE (not yet investigated): both StrayPups games appear to be
broadcasting DIFFERENT ball-call sequences again (regression) — possible
WABC/local-vs-wide-area switching issue. To be investigated next session.


### v3.16 — Hit Stats Cards, Hit Breakdown, Presence Retry Fix
- New dashboard stat cards: "Since Last Hit" and "Avg Time Between Hits"
  (computed from loaded _hits array).
- New "Hit Breakdown" section: counts of Force Jackpot / Corporal Stripes /
  Lazy-T (and Other) from the last 50 hits.
- PRESENCE FIX (root cause of "Connected: 0" since early builds): same
  one-shot-subscribe bug as the games — operator's own presence subscribe
  never retried on CHANNEL_ERROR/TIMED_OUT/CLOSED. Now retries with
  exponential backoff (2s->30s cap).
- NOTE: progressive_operator/progressive.js is a STALE UNUSED FILE (not
  referenced by index.html) — candidate for removal, pending confirmation.
- Cache bust: prog-op-v3.16

### v3.17 — Removed Hit Breakdown Section
Per Sasha: Corporal Stripes isn't a Progressive-jackpot concept, so
categorizing hits by Force Jackpot/Corporal Stripes/Lazy-T on this
dashboard didn't make sense. Removed the "Hit Breakdown" section entirely.
"Since Last Hit" and "Avg Time Between Hits" cards (v3.16) are kept.
Cache bust: prog-op-v3.17

### v3.18 — Presence Heartbeat (zombie-channel fix)
Same hypothesis as the games: a zombie presence channel
(silent socket reconnect with no CHANNEL_ERROR/CLOSED) could leave this
tool unable to see other presences with no visible error. Added a 60s
heartbeat: fully removeChannel + recreate the presence channel on a fixed
interval.
Cache bust: prog-op-v3.18

### REVERT — Presence Heartbeat removed (caused console flood + lockup)
v3.18/v1.16/v1.7's 60s heartbeat caused console flooding and a system
lockup, most likely from racing with the existing error-retry logic and/or
hitting free-tier Realtime rate limits via frequent channel churn.
REVERTED ENTIRELY — back to one-shot subscribe + error-triggered retry.
"0 players with active games" remains OPEN.
Cache bust: see service-worker.js

### v3.20 — Presence & Render Bug Fixes (6 bugs)
**Presence double-render (root cause of `--` connected count):**
- `_syncPresence()` called `_updatePresenceCounts()` (which itself calls
  `renderTab()` + writes count to DOM), then immediately called `renderTab()`
  again — nuking the count DOM writes before they painted. Removed the
  redundant trailing `renderTab()` from `_syncPresence()`.
- `renderDashboard()` hardcoded `--` for `#dash-conn`. Now inlines
  `_presenceCount` so the count is correct on first paint every render.

**Armed status not reflected on re-render:**
- `renderDashboard()` always rendered the Force JP stat card as "READY"
  regardless of `_forceIsArmed`. Now inlines the correct text + color from
  state, consistent with how all other stat cards work.

**`INACTIVE_MS` shadowed inside `renderDashboard()`:**
- Local `var INACTIVE_MS = 60000` inside `renderDashboard()` silently
  shadowed the global. Identical value for now, but would break silently
  if the global threshold is ever tuned. Removed the local re-declaration.

**`forceHit()` double-write on Force tab label:**
- Set `.textContent = '&#9889; ARMED'` (renders as literal entity text)
  then immediately overwrote with `.innerHTML = '&#9889; ARMED'`. Removed
  the redundant `textContent` line; `innerHTML` is the correct setter here.

**`resetPlayerRegistry()` didn't re-render after clearing maps:**
- After resetting `_playerIdMap` and `_nextPlayerId`, the dashboard player
  table still showed stale "Player N" labels until the next presence event.
  Added `if (_activeTab === 'dashboard') renderTab()` for immediate feedback.

Cache bust: prog-op-v3.20

### v3.21 — CRITICAL: Presence State Never Populated on Subscribe (root cause of 0 players)
The operator was calling `setTimeout(_updatePresenceCounts, 500)` in the
SUBSCRIBED callback. `_updatePresenceCounts()` counts entries already in
`_presenceState` — but `_presenceState` is only populated by `_syncPresence()`,
which is only called from presence events (`sync`/`join`/`leave`).

On Supabase free-tier, the `sync` event fires when the operator first joins
the presence channel and sees existing members. But if the Realtime tenant
was cold-starting or the event was delayed/dropped, `_presenceState` stayed
`{}` forever — so `_updatePresenceCounts()` always counted 0 regardless of
how many games were actually connected.

**Fixes:**
- SUBSCRIBED callback now calls `_syncPresence()` (which reads
  `presenceCh.presenceState()` and rebuilds `_presenceState`) instead of
  `_updatePresenceCounts()` (which only counts an already-stale cache).
- Added a second `setTimeout(_syncPresence, 2000)` pass to cover the
  free-tier cold-start window where the first sync may arrive late.
- `startInactiveTimer()` now polls `_syncPresence()` every 3 seconds
  instead of `_updatePresenceCounts()`, ensuring `_presenceState` is
  always rebuilt from live channel state on every tick — not just when
  presence events happen to fire.

This is the actual root cause of the "0 CONNECTED DEVICES" bug shown in
the screenshots, distinct from the double-render bug fixed in v3.20.
Cache bust: prog-op-v3.21

---

## Current Version: v3.21 (cache: prog-op-v3.21)

## Pending
- [ ] Connected players showing correctly — VERIFY after v3.21 deploy
- [ ] Force jackpot end-to-end test
- [ ] progressive_hits records writing correctly from games
- [ ] Broadcast messages verified received by game clients
