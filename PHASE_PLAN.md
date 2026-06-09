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

---

## Phase 5 — Turrelle Sisters Big Munny: Bingo Conversion 📋 Planned

> **Owner Decision — 2026-06-09**
> Convert `TSBIGMUNNY` from a Class III 5-reel video slot to a Class II bingo machine.
> All win outcomes will be determined by bingo patterns, not reel RNG.
> Tier Bonuses (Red Spin T1–T4), Pick & Choose, and Hold & Spin are fully retired.
> The game requires a complete redesign of math, UI, and codebase.

---

### 5.1 — What Gets Retired Completely

| Component | Current | Decision |
|-----------|---------|----------|
| Red Spin Bonus (T1–T4) | Bingo-driven reel bonus sequence | ❌ Removed — replaced by bingo pattern payouts |
| Pick & Choose | 5× Lipstick P&C trigger | ❌ Removed — no equivalent in bingo model |
| Hold & Spin | Already removed v8.0.0 | ❌ Confirmed gone |
| Tier jackpots (MINI/MINOR/MAJOR/GRAND via RS) | Tier-entry jackpot checks | ❌ Removed — jackpot is bingo-determined only |
| 5-reel 3-row 20-payline evaluator | `evaluateLine()`, `PAYLINES`, `PAY_TABLE` | ❌ Retired |
| Virtual stop table / reel strips | `VSTOP_TABLE`, `STRIPS[]` | ❌ Retired |
| Wild multiplier system | Josie ×2, Sasha ×1, additive | ❌ Retired |
| `bonuses.js` | RS tier logic | ❌ Retired |
| `paytable.js` | 20-line pay table | ❌ Retired |
| `state.js` | Slot state manager | ❌ Retire or rewrite for bingo state |
| `ui.js` | 5-reel canvas renderer | ❌ Retire or rewrite for bingo card + reel strip |
| Denomination system | 1¢–50¢ locked CPL | 🔄 Redesign — bingo uses flat bet per card |
| Letter bonus (B/O/N/U/S) | Cherry-style letter evaluation | ❌ Retired — no letters in bingo model |

---

### 5.2 — What Carries Over

| Component | Keep | Notes |
|-----------|------|-------|
| `progressive.js` | ✅ | v1.4 — identical to StrayPups, drop in |
| `broadcast-init.js` | ✅ | Identical across all games |
| Supabase integration | ✅ | Same DB, same RPCs, same presence |
| Server ball call | ✅ | `get_or_create_ball_call` / `upsert_ball_call` RPCs already in DB |
| Player registry | ✅ | `register_player` RPC already in DB |
| Progressive jackpot meter UI | ✅ | Same `prog-meter` HTML structure |
| Jackpot celebration overlay | ✅ | `force-win-cel`, `fw-video`, `fw-amt` — same videos, same dismiss flow |
| Character assets | ✅ | Josie, Sasha, Maxine, Scott, Sisters — used in celebration + reel symbols |
| `assets/videos/` | ✅ | `josie_dance.mp4`, `sasha_dance.mp4`, `sasha_alt.mp4` |
| Audio assets | ✅ | `ring1.mp3`, `red_spin_music.mp3`, `credits_addup.wav`, `splash_welcome.wav` |
| Operator PIN + username | ✅ | Same flow as StrayPups |
| `tools/` folder | ✅ | Move to separate tools repo — not shipped in live game |

---

### 5.3 — New Architecture (Bingo Model)

The converted game follows the exact same Class II bingo architecture as StrayPups, adapted for the Turrelle Sisters theme and symbols.

**Core flow (identical to StrayPups):**
1. Player presses SPIN → ball call fetched from DB (local fallback if offline)
2. New bingo card generated (same `genBingoCard()` logic)
3. First 40 balls evaluate all patterns → determine win outcomes
4. Balls 41–75 are entertainment only (continued daubing, no new pattern eval)
5. Cover All in balls 41–75 → penny award + new sequence
6. Reel strip shows forced symbol combo matching the winning pattern
7. Multiple patterns → Red Spin bonus sequence (patterns cycle as Red Spins)
8. Progressive jackpot → Cover All in ≤25 balls → all patterns fire + pot awarded

**What replaces the slot features:**

| Old (slot) | New (bingo) |
|------------|-------------|
| 20-payline evaluator | Bingo pattern checker (`checkPatterns()`) |
| Reel strips / virtual stops | Forced reel result per winning pattern (`REEL_SYMS`) |
| Red Spin T1–T4 tier bonus | Red Spin = multiple bingo patterns each paying separately |
| Pick & Choose | *(no equivalent — retired)* |
| Wild multiplier | *(no equivalent — bingo pays are fixed per pattern)* |
| MINI/MINOR/MAJOR/GRAND tier JPs | Single shared progressive jackpot (Cover All ≤25 balls) |

---

### 5.4 — Turrelle-Specific Bingo Pattern Design

The Turrelle Sisters game needs its own pattern set distinct from StrayPups. Patterns should reflect the game's personality — character names, casino references, feminine themes.

**Suggested pattern naming approach:**

| Pattern | Cells | Name idea |
|---------|-------|-----------|
| Center row | [10,11,12,13,14] | Sisters Row |
| Center column | [2,7,12,17,22] | Gold Column |
| Main diagonal | [0,6,12,18,24] | Turrelle Cross |
| Anti-diagonal | [4,8,12,16,20] | Sasha's Slash |
| 4 corners | [0,4,20,24] | Diamond Corners |
| Letter T | [0,1,2,3,4,2,7,12,17,22] | The T |
| Letter S | various | Sasha S |
| Cover All | all 25 | Grand Jackpot |

> ⚠️ **Owner must approve final pattern set and pay table before Phase 5.2 begins.**

---

### 5.5 — Reel Symbol Set

The Turrelle Sisters bingo game reuses the character and symbol assets already in the repo. The reel strip shows 3 symbols per spin (same 3-reel, 3-window mechanic as StrayPups).

**Proposed symbol IDs:**

| ID | Symbol | Asset | Notes |
|----|--------|-------|-------|
| 0 | Sisters | `sisters.png` | Highest — progressive jackpot symbol |
| 1 | Josie | `josie.png` | High pay |
| 2 | Sasha | `sasha.png` | High pay |
| 3 | Seven | `seven.svg` (existing) | Mid pay |
| 4 | Triple Bar | `triple_bar.svg` (existing) | Mid pay |
| 5 | Single Bar | `single_bar.svg` (existing) | Low pay |
| 6 | Blank | *(none)* | Empty reel slot |
| 7 | Turrelle Progressive | *(new SVG — TBD)* | Progressive jackpot symbol |

> ⚠️ **Owner to provide or approve the progressive jackpot symbol SVG before Phase 5.3 begins.**

---

### 5.6 — New File Structure

```
TSBIGMUNNY/
├── index.html              ← Full rewrite
├── css/styles.css          ← Full rewrite (bingo layout)
├── js/
│   ├── config.js           ← NEW: BINGO_PATTERNS, REEL_SYMS, STRIPS, pay table
│   ├── game.js             ← NEW: bingo engine (based on StrayPups js/game.js)
│   ├── progressive.js      ← CARRY OVER: v1.4 unchanged
│   ├── operator.js         ← CARRY OVER or light rewrite
│   └── broadcast-init.js   ← CARRY OVER unchanged
├── progressive.js          ← CARRY OVER: root copy (same as js/)
├── broadcast-init.js       ← CARRY OVER
├── service-worker.js       ← NEW: updated file list + new cache version
├── manifest.json           ← UPDATE: name, short_name
└── assets/                 ← Largely carry over, remove slot-specific items
    ├── symbols/            ← UPDATE: keep bars/7, add Turrelle progressive SVG
    │                          REMOVE: letter_b/n/o/s/u.svg (slot-only)
    │                          REMOVE: jp_grand/major/mini/minor.svg (slot-only)
    │                          REMOVE: lipstick.svg, diamond.svg (slot-only)
    ├── icons/              ← CARRY OVER
    ├── videos/             ← CARRY OVER
    └── audio/              ← CARRY OVER (rename to match StrayPups flat structure)

RETIRED files (do not carry into new build):
  audio.js, bonuses.js, cashout.js, paytable.js, state.js, ui.js
  assets/cherry_DEAD.svg
  tools/ (move to separate tools repo)
```

---

### 5.7 — Phase 5 Task Checklist

**Pre-work (owner decisions needed first):**
- [ ] Owner approves final bingo pattern set and names
- [ ] Owner approves pay table (credits per pattern per bet level)
- [ ] Owner approves denominations (flat bet per card — e.g. $0.25/$0.50/$1.00/$5.00)
- [ ] Owner provides or approves Turrelle progressive symbol SVG
- [ ] Owner confirms `game_id` for Turrelle bingo game (`turrelle_bingo`?)

**Phase 5.1 — Config (`js/config.js`):**
- [ ] Define `BINGO_PATTERNS` array with Turrelle pattern set
- [ ] Define `REEL_SYMS` combos for each pattern
- [ ] Define `VSTOP_TABLE` and `STRIPS` for 3-reel display
- [ ] Define `DENOM` and bet structure
- [ ] Define `PAY` table per pattern per bet level

**Phase 5.2 — Game engine (`js/game.js`):**
- [ ] Port StrayPups `js/game.js` v5.30 as base
- [ ] Replace StrayPups-specific references with Turrelle references
- [ ] Replace `scott_full.png` reference with Turrelle character
- [ ] Update `PROG_GAME_ID = 'turrelle_bingo'`
- [ ] Update localStorage keys (`tsbm_bal`, `tsbm_cpl`)
- [ ] Update `_gameName()` map in progressive operator controller

**Phase 5.3 — HTML + CSS (`index.html`, `css/styles.css`):**
- [ ] Full layout redesign — Turrelle Sisters theme, branding, colors
- [ ] Bingo card + ball strip layout (same structure as StrayPups)
- [ ] 3-reel strip (same structure as StrayPups)
- [ ] Progressive meter, win display, pattern name display
- [ ] Jackpot overlay (`force-win-cel`) wired to Turrelle celebration videos

**Phase 5.4 — Integration + Testing:**
- [ ] Supabase ball call working (`turrelle_bingo` game_id row in `ball_call` table)
- [ ] Player registration working
- [ ] Progressive contributions flowing correctly
- [ ] Force jackpot from operator controller triggers correctly
- [ ] All bingo patterns firing and paying correctly
- [ ] Cover All in ≤25 balls fires progressive jackpot
- [ ] Offline fallback working

**Phase 5.5 — Operator Controller Update:**
- [ ] Add `turrelle_bingo` to `_gameName()` map in `progressive_operator/index.html`
- [ ] Confirm presence tracking shows Turrelle players correctly
- [ ] Confirm hit history shows Turrelle game title and patterns

**Phase 5.6 — Deploy:**
- [ ] Bump service worker cache version
- [ ] Add `turrelle_bingo` seed row to `ball_call` table in Supabase
- [ ] Update Gold Coins Casino lobby with Turrelle bingo game link
- [ ] Update `PHASE_PLAN.md` with final version number

---

*Last updated: 2026-06-09 — Phase 5 (Turrelle Bingo Conversion) added*
