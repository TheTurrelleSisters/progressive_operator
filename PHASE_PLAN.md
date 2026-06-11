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
