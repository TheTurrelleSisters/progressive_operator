# The Turrelle Sisters — Project Phase Plan

> **Single source of truth.** All repos under [TheTurrelleSisters](https://github.com/TheTurrelleSisters) are tracked here.  
> Update this file with every meaningful change before committing code.  
> **Source of truth for all files = zip archives / local copies. GitHub is behind and should not be trusted.**

---

## Repos at a Glance

| Repo | Purpose | Live URL | Status |
|------|---------|----------|--------|
| `progressive_operator` | PWA operator controller | https://theturrellesisters.github.io/progressive_operator/ | 🔧 Deploy pending |
| `TSBIGMUNNY` | Turrelle Sisters Big Munny (slot game) | — | 🔧 Active |
| `straypups_big_munny_5d` | StrayPups $5 bingo game | — | 🔧 Active |
| `straypups_big_munny_v5_27_PWA` | StrayPups PWA build | — | 🔧 Active |
| `turrelle_gold_coins_casino` | Casino lobby (GitHub Pages) | https://theturrellesisters.github.io/turrelle_gold_coins_casino/ | 🌐 Live |

> **Note:** `progressive.js` and `splash.html` in `progressive_operator` repo are dead code — all logic is inline in `index.html` v2.4.

---

## Supabase

**Project:** `gdmmoeggkqsvqnqyrubx.supabase.co`

| Table | Key Columns |
|-------|-------------|
| `progressive` | `id, value, seed, ceiling, contrib_rate, hit_count, updated_at, trigger_odds, armed` |
| `progressive_hits` | `id, game_id, denom, amount, pattern, balls, bet, created_at` |
| `progressive_commands` | `id, command, status, armed_at, winner_session, winner_game, winner_amt, won_at, created_by` |
| `broadcast_messages` | `id, message, type, created_at, created_by` |

**RPCs required:** `arm_force_jackpot()`, `progressive_contribute({ add_amount: number })`  
⚠️ Confirm both RPCs exist in Supabase dashboard before deploying.

---

## Phase History

### Phase 1 — Foundation ✅
- Casino lobby deployed to GitHub Pages
- Progressive jackpot logic scaffolded across game repos
- PWA manifest + service worker added to `progressive_operator`
- Initial splash + PIN screen built

---

### Phase 2 — Advanced Operator Controller ✅ (local — deploy pending)

**v2.4 `index.html` features:**
- Splash screen: gear SVG + animated progress bar, dismissed only after Supabase connects
- PIN screen: username field + 4-digit PIN → `★ Operator: [name]` in header
- **DASHBOARD** — pot value, must-hit cap, contrib rate, hit count, connected devices, armed status, last hit
- **SETTINGS** — Seed, Must-Hit Ceiling, Contribution Rate, Random Trigger Odds, Save, Danger Zone (reset/custom)
- **HISTORY** — Hit History table + in-memory Operator Audit Log
- **FORCE** — Arm jackpot, +$50 test contribution, Refresh
- **MSG** — Broadcast message to all players (type + textarea), Sent Messages list with delete
- Supabase Realtime: pot updates, hit inserts, presence tracking (device count + inactive 60s badge)
- Player ID auto-assignment from presence session keys

### Phase 2 Bug Tracker — All Fixed ✅

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| BUG-01 | CRITICAL | `#lock-screen` started `display:flex` — overlaid splash on load | ✅ Fixed |
| BUG-15 | CRITICAL | Both `#splash` and `#lock-screen` had `z-index:9999` — lock screen won; splash never visible | ✅ Fixed |
| BUG-02 | HIGH | `setTimeout(killSplash, 4000)` fired unconditionally — dismissed splash before DB connected | ✅ Fixed (removed) |
| BUG-03 | HIGH | `pkEnter()` showed app before `initSupabase()` completed — blank app while DB loaded | ✅ Fixed (app shown inside init callback) |
| BUG-04 | MEDIUM | `s.onerror = setOffline` — `setOffline` called `renderTab()` with `_client = null` | ✅ Fixed (null guard) |
| BUG-05 | MEDIUM | `fetchRow` error path called `cb()` — caused false connected state | ✅ Fixed (error calls `setOffline`, not `cb`) |
| BUG-06 | MEDIUM | `subscribeCommands` INSERT only fired on `status === 'armed'` — fragile RPC assumption | ✅ Fixed (also checks `command === 'force_jackpot'`) |
| BUG-09 | MEDIUM | `showTab('messages')` didn't `fetchMessages()` first — stale message list | ✅ Fixed |
| BUG-11 | MEDIUM | `winner_session` / `session_key` on `progressive_hits` — schema confirmed: these columns do NOT exist on that table | ✅ Fixed (replaced with `_gameName()`) |
| BUG-16 | MEDIUM | `_forceIsArmed` local state not synced from `progressive.armed` DB column on load/reconnect — could show wrong armed state | ✅ Fixed (synced in `fetchRow` and realtime UPDATE) |
| BUG-07 | LOW | `cancelForce()` had no error check — UI updated even if DB update failed | ✅ Fixed |
| BUG-08 | LOW | `addTestContrib` toast fires before realtime confirms pot update | ✅ Acceptable (realtime handles it) |
| BUG-10 | LOW | `showTab('history')` didn't `fetchHits()` first | ✅ Fixed |
| BUG-12 | LOW | `_fmtMoney(NaN)` returned `"$NaN.undefined"` | ✅ Fixed (NaN guard returns `$0.00`) |
| BUG-13 | LOW | `toast()` used `textContent` — HTML entity emojis rendered as raw text `&#9889;` | ✅ Fixed (`innerHTML`) |
| BUG-14 | LOW | `renderMessages()` used undefined CSS classes `prop-row` / `prop-name` | ✅ Fixed |

### Phase 2 Deploy Checklist
- [ ] Confirm RPCs `arm_force_jackpot()` and `progressive_contribute()` exist in Supabase
- [x] ~~Confirm whether `winner_session` column exists on `progressive_hits`~~ — confirmed NOT present, fixed
- [ ] Push `index.html` (v2.4, ~50KB) to `progressive_operator` repo root
- [ ] Delete `progressive.js` and `splash.html` from repo (dead code)

---

## Phase 3 — Game Integration Verification 📋 Planned

### Goals
- Verify realtime pot updates appear live in all 3 games
- Verify `progressive_commands` arm/force flow works end-to-end with game clients
- Verify presence tracking shows accurate connected device count
- Verify broadcast messages display correctly in game UIs
- Audit `game_id` values sent by each game — confirm they match `_gameName()` map:
  - `straypups_1d` → StrayPups $1
  - `straypups_5d` → StrayPups $5
  - `turrelle` → Turrelle Sisters

---

## Phase 4 — Casino Lobby Sync 📋 Planned

### Goals
- `turrelle_gold_coins_casino` shows live jackpot value from `progressive` table
- PWA install / offline behaviour verified across iOS and Android

---

## How to Use This Document

1. **Before starting work** — check the current phase, pick up an open task.
2. **While working** — update task status to 🔄 In Progress.
3. **On completion** — mark ✅ Done, add a brief note.
4. **New bugs found** — add a row to the Bug Tracker in the relevant phase.
5. **New phase needed** — append a new Phase section. Never delete history.

---

*Last updated: 2026-06-09 — Phase 2 bug fixes complete (17 bugs fixed, schema confirmed)*
