/*
 * progressive.js — Virtual Progressive Controller
 * Stray-Pup LLC / The Turrelle Sisters LLC
 * v1.3 — Multi-user safe. Channel dedup, contribution batching, robust reconnect.
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
 */

var SUPABASE_URL      = 'https://gdmmoeggkqsvqnqyrubx.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_NGsKBAUUsVUvD5XKTblIdw_aBDPldSd';

/* Per-game identity — set via inline script BEFORE this file loads */
var PROG_GAME_ID = (typeof PROG_GAME_ID !== 'undefined') ? PROG_GAME_ID : 'unknown';
var PROG_DENOM   = (typeof PROG_DENOM   !== 'undefined') ? PROG_DENOM   : 1.00;

var Progressive = (function () {

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
     SDK LOADER
     ═══════════════════════════════════════════════════════════════ */
  function _loadSDK(cb) {
    if (typeof window !== 'undefined' && window.supabase) { cb(); return; }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
    s.onload  = cb;
    s.onerror = function () { console.warn('[Progressive] SDK load failed — offline.'); };
    document.head.appendChild(s);
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
     ═══════════════════════════════════════════════════════════════ */
  var _messageListeners  = [];
  var _lastSeenMessageId = 0;
  var _SEEN_KEY          = 'prog_last_msg_' + PROG_GAME_ID;

  function _loadLastSeen() {
    try { var v = localStorage.getItem(_SEEN_KEY); if (v) _lastSeenMessageId = parseInt(v, 10) || 0; } catch(e) {}
  }
  function _saveLastSeen(id) {
    _lastSeenMessageId = id;
    try { localStorage.setItem(_SEEN_KEY, String(id)); } catch(e) {}
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
