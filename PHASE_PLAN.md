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
