# Progressive Operator — Phase Plan
## Repo: progressive_operator
## Source of truth: zip archives. GitHub is behind.

---

## Current Version: v3.8 (cache: prog-op-v3.8)

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

