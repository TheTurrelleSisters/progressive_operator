/*
 * progressive.js — Virtual Progressive Controller
 * Stray-Pup LLC / The Turrelle Sisters LLC
 * v1.10 — Three operator-reported issues resolved (see below).
 * ES5 only. No arrow functions. No const/let. No backticks.
 *
 * MULTI-USER FIXES v1.3:
 *  1. Channel name collision — prog-value, prog-hits-notify, broadcast-messages were
 *     shared flat names. Supabase Realtime drops duplicate channel subscriptions from
 *     the same client, so the second machine to connect silently loses its subscription.
 *     Fix: all channels now include _sessionKey suffix so each client is unique.
 *  2. prog-commands channel was already partially session-keyed but only used 4 chars —
 *     extended to full key for uniqueness.
 *  3. Contribution flush: concurrent flushes from multiple tabs on the same browser
 *     (or slow connections) could double-contribute. Added in-flight guard.
 *  4. Presence channel 'presence-lobby' is intentionally shared (same name required
 *     for all users to see each other) — left unchanged. This was NOT a bug.
 *  5. Reconnect: no retry logic on dropped WebSocket. Added exponential-backoff
 *     re-subscribe when the realtime connection drops.
 *  6. Edge Functions unhealthy in Supabase: this is almost always caused by too many
 *     simultaneous Realtime channel subscriptions. Fixed by consolidating the 4 separate
 *     postgres_changes subscriptions into a single channel with multiple listeners.
 *     Each Supabase Realtime channel opens a WebSocket multiplexed slot; too many from
 *     the same project hammers the Edge Function router.
 *
 * FIXES v1.10:
 *  FIX-A: Progressive display format confirmed as $x,xxx.xx — no change needed,
 *     _fmtMoney() already produces this format correctly.
 *
 *  FIX-B: Jackpot triggers are determined on each individual player terminal.
 *     _shouldRandomTrigger() runs locally per spin. No change needed for correctness,
 *     but added a safety guard: if PROG_GAME_ID is still 'unknown' at init time
 *     (i.e. the inline script that sets it hadn't run yet), we now warn loudly in
 *     the console so operators can catch misconfigured game terminals early.
 *
 *  FIX-C: Players missing past broadcast messages.
 *     ROOT CAUSE: _SEEN_KEY was built as 'prog_last_msg_' + PROG_GAME_ID at module
 *     parse time, before any inline script could set PROG_GAME_ID. When PROG_GAME_ID
 *     was still 'unknown' the key became 'prog_last_msg_unknown', which is SHARED
 *     across every terminal on the same browser. One terminal marking a message
 *     as seen would silently suppress it on all others.
 *     FIX: Defer _SEEN_KEY construction until _checkUnreadMessages() is called,
 *     after init() has run and PROG_GAME_ID is confirmed set.
 *     SECONDARY FIX: Added _MAX_REPLAY_HOURS (default 24h). On each page load,
 *     if the stored last-seen ID is older than MAX_REPLAY_HOURS, we reset it to 0
 *     so players who were offline for a long session don't permanently miss messages.
 *     This uses a companion localStorage key that stores the timestamp of the last
 *     seen message.
 */

var SUPABASE_URL      = 'https://gdmmoeggkqsvqnqyrubx.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_NGsKBAUUsVUvD5XKTblIdw_aBDPldSd';

/* Per-game identity — set via inline script BEFORE this file loads */
var PROG_GAME_ID = (typeof PROG_GAME_ID !== 'undefined') ? PROG_GAME_ID : 'unknown';
var PROG_DENOM   = (typeof PROG_DENOM   !== 'undefined') ? PROG_DENOM   : 1.00;

var Progressive = (function () {

  /* ── FIX-1: Preload the Supabase SDK immediately when this script loads.
     By the time init() is called the script will already be cached/parsed,
     cutting connect latency by 1-3 seconds. ── */
  (function _preloadSDK() {
    if (typeof window !== 'undefined' && !window.supabase) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      s.async = true;
      document.head.appendChild(s);
    }
  }());

  /* ── Private state ── */
  var _client           = null;
  var _connected        = false;
  var _localValue       = 500.00;
  var _seed             = 500.00;
  var _ceiling          = 9999.00;
  var _contribRate      = 0.02;
  var _triggerOdds      = 500;     /* FIX: 1-in-N base odds for random trigger */
  var _pendingAdd       = 0;
  var _flushTimer       = null;
  var _flushInFlight    = false;   /* FIX-3: guard against concurrent flushes */
  var _valueListeners   = [];
  var _presenceChannel  = null;
  var _presenceCount    = 0;
  var _presenceListeners= [];
  var _sessionKey       = 'sess_' + Math.random().toString(36).substr(2, 9);
  var _mainChannel      = null;    /* FIX-6: single consolidated channel */
  var _reconnectDelay   = 2000;    /* FIX-5: reconnect backoff ms */
  var _reconnectTimer   = null;

  /* ── Force jackpot state ── */
  var _forceArmed       = false;
  var _forceCommandId   = null;
  var _forceClaimed     = false;
  var _onForceWin       = null;
  var _onForceNotify    = null;
  var _justWon          = false;

  /* ═══════════════════════════════════════════════════════════════
     SDK LOADER — waits for the preloaded script to be ready
     ═══════════════════════════════════════════════════════════════ */
  function _loadSDK(cb) {
    if (typeof window !== 'undefined' && window.supabase) { cb(); return; }
    /* SDK preload is in-flight; poll until it lands (max ~5s) */
    var attempts = 0;
    var poll = setInterval(function() {
      attempts++;
      if (window.supabase) { clearInterval(poll); cb(); return; }
      if (attempts >= 50) {
        clearInterval(poll);
        /* Last-resort: inject a fresh tag */
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
        s.onload  = cb;
        s.onerror = function () { console.warn('[Progressive] SDK load failed — offline.'); };
        document.head.appendChild(s);
      }
    }, 100);
  }

  /* ═══════════════════════════════════════════════════════════════
     NOTIFY HELPERS
     ═══════════════════════════════════════════════════════════════ */
  function _notifyValue() {
    for (var i = 0; i < _valueListeners.length; i++) {
      try { _valueListeners[i](_localValue); } catch (e) {}
    }
  }
  function _notifyPresence() {
    for (var i = 0; i < _presenceListeners.length; i++) {
      try { _presenceListeners[i](_presenceCount); } catch (e) {}
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     DB FETCH
     ═══════════════════════════════════════════════════════════════ */
  function _fetchRow(cb) {
    _client.from('progressive').select('*').eq('id', 1).single().then(function (res) {
      if (res.error) { console.warn('[Progressive] fetchRow:', res.error.message); if (cb) cb(); return; }
      var d = res.data;
      _localValue  = parseFloat(d.value)        || _seed;
      _seed        = parseFloat(d.seed)         || _seed;
      _ceiling     = parseFloat(d.ceiling)      || _ceiling;
      _contribRate = parseFloat(d.contrib_rate) || _contribRate;
      if (d.trigger_odds != null) _triggerOdds = parseFloat(d.trigger_odds) || _triggerOdds;
      _notifyValue();
      if (cb) cb();
    });
  }

  function _checkArmedCommand() {
    _client.from('progressive_commands')
      .select('*').eq('status', 'armed').limit(1).then(function (res) {
        if (res.error) {
          console.warn('[Progressive] commands table error:', res.error.message);
          return;
        }
        if (!res.data || !res.data.length) return;
        _forceArmed     = true;
        _forceCommandId = res.data[0].id;
        console.log('[Progressive] Force jackpot ARMED on load — fires on next spin!');
      });
  }

  /* ═══════════════════════════════════════════════════════════════
     REALTIME — CONSOLIDATED SINGLE CHANNEL (FIX-1, FIX-6)
     
     Previously 4 separate channels:
       'prog-hits-notify'       — shared name, any 2nd subscriber silently dropped
       'prog-value'             — shared name, same issue
       'prog-commands-XXXX'     — partially keyed (4 chars), collision probable
       'broadcast-messages'     — shared name, same issue
     
     Now: ONE channel per session, unique name, with all 4 postgres_changes
     listeners attached. This:
       - Eliminates duplicate-subscription drops (each session has a unique name)
       - Reduces WebSocket slots from 4 → 1 per game client (fixes Edge Function load)
       - Simplifies reconnect logic (one channel to reopen)
     ═══════════════════════════════════════════════════════════════ */
  function _subscribeMain() {
    /* FIX-1: unique channel name per session eliminates silent subscriber drops */
    var chName = 'prog-main-' + _sessionKey;
    _mainChannel = _client.channel(chName)

      /* Progressive value updates */
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'progressive', filter: 'id=eq.1'
      }, function (p) {
        if (!p.new) return;
        _localValue  = parseFloat(p.new.value)        || _localValue;
        _seed        = parseFloat(p.new.seed)         || _seed;
        _ceiling     = parseFloat(p.new.ceiling)      || _ceiling;
        _contribRate = parseFloat(p.new.contrib_rate) || _contribRate;
        if (p.new.trigger_odds != null) _triggerOdds = parseFloat(p.new.trigger_odds) || _triggerOdds;
        _notifyValue();
      })

      /* Force jackpot commands — INSERT (arm) */
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'progressive_commands'
      }, function (p) {
        if (!p.new || p.new.command !== 'force_jackpot' || p.new.status !== 'armed') return;
        _forceArmed     = true;
        _forceCommandId = p.new.id;
        _forceClaimed   = false;
        console.log('[Progressive] FORCE JACKPOT ARMED — fires on next spin!');
      })

      /* Force jackpot commands — UPDATE (claimed by winner) */
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'progressive_commands'
      }, function (p) {
        if (!p.new || p.new.command !== 'force_jackpot') return;
        if (p.new.status === 'won') {
          if (p.new.winner_session === _sessionKey) return; /* we handled it in _claimForceWin */
          _forceArmed     = false;
          _forceCommandId = null;
          if (_onForceNotify) {
            _onForceNotify(
              parseFloat(p.new.winner_amt) || 0,
              p.new.winner_game || 'another game'
            );
          }
        }
      })

      /* Progressive hits — ATTITUDE CHECK on non-winner devices */
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'progressive_hits'
      }, function (p) {
        if (!p.new || _justWon) return;
        if (_onForceNotify) {
          _onForceNotify(
            parseFloat(p.new.amount) || 0,
            p.new.game_id || 'another game'
          );
        }
      })

      /* Broadcast messages */
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'broadcast_messages'
      }, function (p) {
        if (!p.new) return;
        _notifyMessage(p.new);
      })

      .subscribe(function (status, err) {
        if (status === 'SUBSCRIBED') {
          /* FIX-5: reset backoff on successful connect */
          _reconnectDelay = 2000;
          if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
          console.log('[Progressive] Realtime connected (' + _sessionKey + ')');
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn('[Progressive] Realtime ' + status + ' — reconnecting in ' + (_reconnectDelay/1000) + 's');
          _scheduleReconnect();
        }
      });
  }

  /* FIX-5: Exponential backoff reconnect */
  function _scheduleReconnect() {
    if (_reconnectTimer) return; /* already pending */
    var delay = _reconnectDelay;
    _reconnectDelay = Math.min(_reconnectDelay * 2, 30000); /* cap at 30s */
    _reconnectTimer = setTimeout(function () {
      _reconnectTimer = null;
      if (!_client) return;
      /* Remove old channel and reopen */
      if (_mainChannel) {
        try { _client.removeChannel(_mainChannel); } catch(e) {}
        _mainChannel = null;
      }
      _subscribeMain();
    }, delay);
  }

  /* ═══════════════════════════════════════════════════════════════
     PRESENCE — intentionally shared channel name (all users must
     join the SAME channel to see each other's presence)
     ═══════════════════════════════════════════════════════════════ */
  function _subscribePresence() {
    _presenceChannel = _client.channel('presence-lobby', {
      config: { presence: { key: _sessionKey } }
    });
    _presenceChannel
      .on('presence', { event: 'sync' }, function () {
        _presenceCount = Object.keys(_presenceChannel.presenceState()).length;
        _notifyPresence();
      })
      .on('presence', { event: 'join' }, function () {
        _presenceCount = Object.keys(_presenceChannel.presenceState()).length;
        _notifyPresence();
      })
      .on('presence', { event: 'leave' }, function () {
        _presenceCount = Object.keys(_presenceChannel.presenceState()).length;
        _notifyPresence();
      })
      .subscribe(function (status) {
        if (status === 'SUBSCRIBED') {
          _presenceChannel.track({
            gameId:   PROG_GAME_ID,
            denom:    PROG_DENOM,
            joinedAt: new Date().toISOString(),
            lastSpin: null
          });
        }
      });
  }

  /* ═══════════════════════════════════════════════════════════════
     CONTRIBUTION FLUSH — FIX-3: in-flight guard prevents double-send
     ═══════════════════════════════════════════════════════════════ */
  function _scheduleFlush() {
    if (_flushTimer) return;
    _flushTimer = setTimeout(function () {
      _flushTimer = null;
      if (_pendingAdd <= 0 || !_client || _flushInFlight) return;
      var toAdd   = parseFloat(_pendingAdd.toFixed(4));
      _pendingAdd = 0;
      _flushInFlight = true;
      _client.rpc('progressive_contribute', { add_amount: toAdd }).then(function (res) {
        _flushInFlight = false;
        if (res.error) {
          console.warn('[Progressive] contribute error:', res.error.message);
          /* Put amount back so it retries on next flush */
          _pendingAdd += toAdd;
          _scheduleFlush();
        }
      });
    }, 5000);
  }

  /* ═══════════════════════════════════════════════════════════════
     FORCE WIN CLAIM — atomic, race-condition safe
     ═══════════════════════════════════════════════════════════════ */
  function _claimForceWin(onClaimed) {
    if (!_forceCommandId || _forceClaimed) { onClaimed(false); return; }
    _forceClaimed = true;
    var hitAmt = parseFloat(_localValue.toFixed(2));

    _client.from('progressive_commands')
      .update({
        status:         'won',
        winner_session: _sessionKey,
        winner_game:    PROG_GAME_ID,
        winner_amt:     hitAmt,
        won_at:         new Date().toISOString()
      })
      .eq('id', _forceCommandId)
      .eq('status', 'armed')
      .select()
      .then(function (res) {
        if (res.error || !res.data || !res.data.length) {
          _forceClaimed = false;
          onClaimed(false);
          return;
        }
        _justWon = true; setTimeout(function(){ _justWon = false; }, 5000);
        _localValue = _seed;
        _notifyValue();
        _forceArmed = false;
        _client.rpc('progressive_hit', { reset_to: _seed });
        _client.from('progressive_hits').insert({
          game_id: PROG_GAME_ID, denom: PROG_DENOM,
          amount: hitAmt, pattern: 'Force Jackpot', balls: 0, bet: 0
        });
        onClaimed(true, hitAmt);
      });
  }

  /* ═══════════════════════════════════════════════════════════════
     PUBLIC API
     ═══════════════════════════════════════════════════════════════ */

  function init(onReady) {
    /* FIX-B: warn loudly when PROG_GAME_ID wasn't set before this script loaded */
    if (PROG_GAME_ID === 'unknown') {
      console.warn('[Progressive] WARNING: PROG_GAME_ID is "unknown". ' +
        'Make sure the inline <script> that sets PROG_GAME_ID runs BEFORE ' +
        'progressive.js loads. Message tracking and jackpot records will ' +
        'collide across terminals until this is fixed.');
    }
    _loadSDK(function () {
      try {
        _client    = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        _connected = true;
        _fetchRow(function () {
          _subscribeMain();      /* FIX-1/6: single consolidated channel */
          _subscribePresence();  /* presence stays on shared channel — correct */
          _checkArmedCommand();
          _checkUnreadMessages();
          /* Re-fetch config every 60s */
          setInterval(function() { _fetchRow(null); }, 60000);
          if (onReady) onReady();
        });
      } catch (e) {
        console.warn('[Progressive] init failed:', e);
        if (onReady) onReady();
      }
    });
  }

  function contribute(betAmt) {
    if (!betAmt || betAmt <= 0) return false;
    var addition = betAmt * _contribRate;
    _localValue  = _localValue + addition;
    if (_localValue > _ceiling) _localValue = _ceiling;
    _notifyValue();
    if (_connected && _client) {
      _pendingAdd += addition;
      _scheduleFlush();
    }
    /* FIX: random trigger — check after contributing this spin */
    /* Update lastSpin timestamp so operator can track active/inactive */
    _updateLastSpin();
    if (_shouldRandomTrigger()) return 'random';
    return _forceArmed;
  }

  function _updateLastSpin() {
    if (!_presenceChannel) return;
    try {
      _presenceChannel.track({
        gameId:   PROG_GAME_ID,
        denom:    PROG_DENOM,
        joinedAt: new Date().toISOString(),
        lastSpin: new Date().toISOString()
      });
    } catch(e) {}
  }

  /* ═══════════════════════════════════════════════════════════════
     RANDOM TRIGGER
     Base odds: 1-in-_triggerOdds per spin.
     Scale: as pot rises from seed → ceiling, chance increases
     linearly so that at cap the trigger is guaranteed (prob = 1).
     Formula: chance = (1/_triggerOdds) + (1 - 1/_triggerOdds)
                       * ((value - seed) / (ceiling - seed))
     ═══════════════════════════════════════════════════════════════ */
  function _shouldRandomTrigger() {
    if (_justWon || _forceArmed) return false;  /* avoid double-fire */
    var range = _ceiling - _seed;
    if (range <= 0) return false;
    var base    = 1 / Math.max(_triggerOdds, 1);
    var growth  = Math.max(0, Math.min(1, (_localValue - _seed) / range));
    var chance  = base + (1 - base) * growth;
    return Math.random() < chance;
  }

  function claimForce(onResult) { _claimForceWin(onResult); }

  function hit(info) {
    var hitAmt  = parseFloat(_localValue.toFixed(2));
    _localValue = _seed;
    _notifyValue();
    _justWon = true;
    setTimeout(function() { _justWon = false; }, 5000);
    if (_connected && _client) {
      var rec = {
        game_id: PROG_GAME_ID, denom: PROG_DENOM, amount: hitAmt,
        pattern: (info && info.pattern) ? info.pattern : 'Progressive Jackpot',
        balls:   (info && info.balls)   ? info.balls   : 0,
        bet:     (info && info.bet)     ? info.bet      : 0
      };
      _client.rpc('progressive_hit', { reset_to: _seed });
      _client.from('progressive_hits').insert(rec);
      setTimeout(function() { _fetchRow(null); }, 1000);
    }
    return hitAmt;
  }

  function mustHit()              { return _localValue >= _ceiling; }
  function getDisplay()           { return _fmtMoney(_localValue); }
  function getValue()             { return _localValue; }

  /* ── Currency formatter — produces $1,000.00 style ── */
  function _fmtMoney(n) {
    var parts = parseFloat(n).toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return '$' + parts[0] + '.' + parts[1];
  }
  function isConnected()          { return _connected; }
  function getPresenceCount()     { return _presenceCount; }
  function isForceArmed()         { return _forceArmed; }
  function getSessionKey()        { return _sessionKey; }

  /* ═══════════════════════════════════════════════════════════════
     BROADCAST MESSAGES
     FIX-C: _SEEN_KEY is now built lazily inside _loadLastSeen() so
     that PROG_GAME_ID is always fully resolved before use.  If the
     key was 'prog_last_msg_unknown' at module-parse time (because
     the inline script that sets PROG_GAME_ID hadn't run yet), all
     terminals on the same browser shared one localStorage slot —
     one terminal marking a message seen silently suppressed it on
     every other terminal.

     SECONDARY FIX: stale last-seen IDs are now expired after
     _MAX_REPLAY_HOURS (default 24 h).  Players who are offline for
     a full day will have their seen-pointer reset to 0 on next load
     so they don't permanently miss messages received while offline.
     ═══════════════════════════════════════════════════════════════ */
  var _MAX_REPLAY_HOURS  = 24;
  var _messageListeners  = [];
  var _lastSeenMessageId = 0;
  /* FIX-C: key is built lazily — never use PROG_GAME_ID at parse time */
  var _SEEN_KEY          = null;
  var _SEEN_TS_KEY       = null;

  function _buildSeenKey() {
    /* Called after init(), by which point PROG_GAME_ID is resolved. */
    if (!_SEEN_KEY) {
      _SEEN_KEY    = 'prog_last_msg_'    + PROG_GAME_ID;
      _SEEN_TS_KEY = 'prog_last_msg_ts_' + PROG_GAME_ID;
    }
  }

  function _loadLastSeen() {
    _buildSeenKey();
    try {
      /* Check whether the stored timestamp is too old */
      var tsRaw = localStorage.getItem(_SEEN_TS_KEY);
      if (tsRaw) {
        var ageHours = (Date.now() - parseInt(tsRaw, 10)) / 3600000;
        if (ageHours > _MAX_REPLAY_HOURS) {
          /* Expired — clear so player catches up on missed messages */
          localStorage.removeItem(_SEEN_KEY);
          localStorage.removeItem(_SEEN_TS_KEY);
          _lastSeenMessageId = 0;
          return;
        }
      }
      var v = localStorage.getItem(_SEEN_KEY);
      if (v) _lastSeenMessageId = parseInt(v, 10) || 0;
    } catch(e) {}
  }

  function _saveLastSeen(id) {
    _buildSeenKey();
    _lastSeenMessageId = id;
    try {
      localStorage.setItem(_SEEN_KEY, String(id));
      localStorage.setItem(_SEEN_TS_KEY, String(Date.now()));
    } catch(e) {}
  }

  function _notifyMessage(msg) {
    for (var i = 0; i < _messageListeners.length; i++) {
      try { _messageListeners[i](msg); } catch(e) {}
    }
    _saveLastSeen(msg.id);
  }

  function _checkUnreadMessages() {
    _loadLastSeen();
    _client.from('broadcast_messages')
      .select('*')
      .gt('id', _lastSeenMessageId)
      .order('id', { ascending: true })
      .then(function(res) {
        if (res.error || !res.data || !res.data.length) return;
        res.data.forEach(function(msg, i) {
          setTimeout(function() { _notifyMessage(msg); }, i * 4000);
        });
      });
  }

  function onMessage(fn)          { _messageListeners.push(fn); }
  function onChange(fn)           { _valueListeners.push(fn); fn(_localValue); }
  function onPresenceChange(fn)   { _presenceListeners.push(fn); fn(_presenceCount); }
  function onForceWin(fn)         { _onForceWin    = fn; }
  function onForceNotify(fn)      { _onForceNotify = fn; }

  return {
    init:             init,
    contribute:       contribute,
    claimForce:       claimForce,
    hit:              hit,
    mustHit:          mustHit,
    getDisplay:       getDisplay,
    getValue:         getValue,
    isConnected:      isConnected,
    isForceArmed:     isForceArmed,
    getTriggerOdds:   function() { return _triggerOdds; },
    getPresenceCount: getPresenceCount,
    getSessionKey:    getSessionKey,
    onChange:         onChange,
    onPresenceChange: onPresenceChange,
    onMessage:        onMessage,
    onForceWin:       onForceWin,
    onForceNotify:    onForceNotify
  };
}());
