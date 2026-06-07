/*
 * progressive.js — Virtual Progressive Controller
 * Stray-Pup LLC / The Turrelle Sisters LLC
 * v1.2 — Force jackpot, ATTITUDE CHECK, presence, clean rewrite
 * ES5 only. No arrow functions. No const/let. No backticks.
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
  var _pendingAdd       = 0;
  var _flushTimer       = null;
  var _valueListeners   = [];
  var _presenceChannel  = null;
  var _presenceCount    = 0;
  var _presenceListeners= [];
  var _sessionKey       = 'sess_' + Math.random().toString(36).substr(2, 9);

  /* ── Force jackpot state ── */
  var _forceArmed       = false;   // operator has armed a force jackpot
  var _forceCommandId   = null;    // ID of the armed command row
  var _forceClaimed     = false;   // this session has claimed the force win
  var _onForceWin       = null;    // callback: function(amt) — called on THIS device when it wins
  var _onForceNotify    = null;    // callback: function(amt, winnerGame) — ATTITUDE CHECK on others

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
      _notifyValue();
      if (cb) cb();
    });
  }

  /* Check if a force jackpot is already armed when we first connect */
  function _checkArmedCommand() {
    _client.from('progressive_commands')
      .select('*').eq('status', 'armed').limit(1).then(function (res) {
        if (res.error) {
          console.warn('[Progressive] commands table error:', res.error.message,
            '- Run SQL queries A-F from SUPABASE_SETUP.md to create it.');
          return;
        }
        if (!res.data || !res.data.length) return;
        _forceArmed     = true;
        _forceCommandId = res.data[0].id;
        console.log('[Progressive] Force jackpot ARMED on load — fires on next spin!');
      });
  }

  /* ═══════════════════════════════════════════════════════════════
     REALTIME: VALUE + COMMANDS
     ═══════════════════════════════════════════════════════════════ */
  /* Subscribe to hits — show ATTITUDE CHECK on non-winner devices */
  function _subscribeHits() {
    _client.channel('prog-hits-notify')
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'progressive_hits'
      }, function (p) {
        if (!p.new) return;
        /* Only show if WE didn't just win (check within 5s window) */
        if (_justWon) return;
        if (_onForceNotify) {
          _onForceNotify(
            parseFloat(p.new.amount) || 0,
            p.new.game_id || 'another game'
          );
        }
      })
      .subscribe();
  }

  var _justWon = false; /* Flag: set when THIS device wins, cleared after 5s */

  function _subscribeValue() {
    _client.channel('prog-value')
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'progressive', filter:'id=eq.1' },
        function (p) {
          if (!p.new) return;
          _localValue  = parseFloat(p.new.value)        || _localValue;
          _seed        = parseFloat(p.new.seed)         || _seed;
          _ceiling     = parseFloat(p.new.ceiling)      || _ceiling;
          _contribRate = parseFloat(p.new.contrib_rate) || _contribRate;
          _notifyValue();
        })
      .subscribe();
  }

  function _subscribeCommands() {
    _client.channel('prog-commands-' + _sessionKey.substr(0,4))
      /* New command inserted — arm fires */
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'progressive_commands' },
        function (p) {
          if (!p.new || p.new.command !== 'force_jackpot' || p.new.status !== 'armed') return;
          _forceArmed     = true;
          _forceCommandId = p.new.id;
          _forceClaimed   = false;
          console.log('[Progressive] FORCE JACKPOT ARMED — fires on next spin!');
        })
      /* Command updated — winner claimed */
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'progressive_commands' },
        function (p) {
          if (!p.new || p.new.command !== 'force_jackpot') return;
          if (p.new.status === 'won') {
            /* Was it us? */
            if (p.new.winner_session === _sessionKey) {
              /* We already handled this in _claimForceWin */
              return;
            }
            /* Someone else won — ATTITUDE CHECK */
            _forceArmed   = false;
            _forceCommandId = null;
            if (_onForceNotify) {
              _onForceNotify(parseFloat(p.new.winner_amt) || 0, p.new.winner_game || 'another game');
            }
          }
        })
      .subscribe();
  }

  /* ═══════════════════════════════════════════════════════════════
     PRESENCE
     ═══════════════════════════════════════════════════════════════ */
  function _subscribePresence() {
    _presenceChannel = _client.channel('presence-lobby', {
      config: { presence: { key: _sessionKey } }
    });
    _presenceChannel
      .on('presence', { event:'sync' }, function () {
        _presenceCount = Object.keys(_presenceChannel.presenceState()).length;
        _notifyPresence();
      })
      .on('presence', { event:'join' }, function () {
        _presenceCount = Object.keys(_presenceChannel.presenceState()).length;
        _notifyPresence();
      })
      .on('presence', { event:'leave' }, function () {
        _presenceCount = Object.keys(_presenceChannel.presenceState()).length;
        _notifyPresence();
      })
      .subscribe(function (status) {
        if (status === 'SUBSCRIBED') {
          _presenceChannel.track({
            gameId:   PROG_GAME_ID,
            denom:    PROG_DENOM,
            joinedAt: new Date().toISOString()
          });
        }
      });
  }

  /* ═══════════════════════════════════════════════════════════════
     CONTRIBUTION FLUSH
     ═══════════════════════════════════════════════════════════════ */
  function _scheduleFlush() {
    if (_flushTimer) return;
    _flushTimer = setTimeout(function () {
      _flushTimer = null;
      if (_pendingAdd <= 0 || !_client) return;
      var toAdd   = parseFloat(_pendingAdd.toFixed(4));
      _pendingAdd = 0;
      _client.rpc('progressive_contribute', { add_amount: toAdd }).then(function (res) {
        if (res.error) console.warn('[Progressive] contribute error:', res.error.message);
      });
    }, 5000);
  }

  /* ═══════════════════════════════════════════════════════════════
     FORCE WIN CLAIM — called by game engine when force is armed
     and a spin is initiated on this device
     ═══════════════════════════════════════════════════════════════ */
  function _claimForceWin(onClaimed) {
    if (!_forceCommandId || _forceClaimed) { onClaimed(false); return; }
    _forceClaimed = true;
    var hitAmt = parseFloat(_localValue.toFixed(2));

    /* Atomic claim: update only if still 'armed' */
    _client.from('progressive_commands')
      .update({
        status:         'won',
        winner_session: _sessionKey,
        winner_game:    PROG_GAME_ID,
        winner_amt:     hitAmt,
        won_at:         new Date().toISOString()
      })
      .eq('id', _forceCommandId)
      .eq('status', 'armed')   /* Only succeeds if still armed — race condition safe */
      .select()
      .then(function (res) {
        if (res.error || !res.data || !res.data.length) {
          /* Someone else got there first */
          _forceClaimed = false;
          onClaimed(false);
          return;
        }
        /* We won! Reset the pot */
        _justWon = true; setTimeout(function(){ _justWon=false; }, 5000);
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
          _subscribeValue();
          _subscribeCommands();
          _subscribeHits();
          _subscribePresence();
          _checkArmedCommand();
          _subscribeMessages();
          _checkUnreadMessages();
          /* Re-fetch config every 60s to pick up operator ceiling/seed changes */
          setInterval(function() { _fetchRow(null); }, 60000);
          if (onReady) onReady();
        });
      } catch (e) {
        console.warn('[Progressive] init failed:', e);
        if (onReady) onReady();
      }
    });
  }

  /*
   * contribute(betAmt)
   * Call on every spin start.
   * If a force jackpot is armed, returns true — game must trigger the jackpot win.
   * Game calls claimForce(callback) to atomically claim it.
   */
  function contribute(betAmt) {
    if (!betAmt || betAmt <= 0) return false;
    var addition = betAmt * _contribRate;
    /* Allow pot to grow freely — ceiling is a must-hit-by MAX, not a hard stop.
       Jackpot triggers via bingo pattern (Class II) at any time regardless of pot size. */
    _localValue  = _localValue + addition;
    /* Visual cap at ceiling for display — pot shows ceiling value when exceeded */
    if (_localValue > _ceiling) _localValue = _ceiling;
    _notifyValue();
    if (_connected && _client) {
      _pendingAdd += addition;
      _scheduleFlush();
    }
    return _forceArmed; /* true = this spin should be a force jackpot */
  }

  /*
   * claimForce(onResult)
   * Called by game engine when contribute() returns true.
   * onResult(didWin, amount) — if didWin=true, trigger jackpot.
   * If didWin=false, someone else got there first — spin normally.
   */
  function claimForce(onResult) {
    _claimForceWin(onResult);
  }

  /*
   * hit(info) — natural jackpot (bingo pattern / 5OAK)
   */
  function hit(info) {
    var hitAmt  = parseFloat(_localValue.toFixed(2));
    _localValue = _seed;
    _notifyValue();
    /* Suppress ATTITUDE CHECK on this device for 5 seconds */
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
      /* Re-fetch config after hit to ensure ceiling/seed are fresh */
      setTimeout(function() { _fetchRow(null); }, 1000);
    }
    return hitAmt;
  }

  function mustHit()              { return _localValue >= _ceiling; }
  function getDisplay()           { return '$' + _localValue.toFixed(2); }
  function getValue()             { return _localValue; }
  function isConnected()          { return _connected; }
  function getPresenceCount()     { return _presenceCount; }
  function isForceArmed()         { return _forceArmed; }
  function getSessionKey()        { return _sessionKey; }


  /* ═══════════════════════════════════════════════════════════════════
     BROADCAST MESSAGES
     Live players get notified instantly via Realtime.
     Offline players see unread messages on next game load.
     ═══════════════════════════════════════════════════════════════════ */
  var _messageListeners  = [];
  var _lastSeenMessageId = 0;
  var _SEEN_KEY          = 'prog_last_msg_' + PROG_GAME_ID;

  function _loadLastSeen() {
    try {
      var v = localStorage.getItem(_SEEN_KEY);
      if (v) _lastSeenMessageId = parseInt(v, 10) || 0;
    } catch(e) {}
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

  /* Subscribe to new messages in realtime */
  function _subscribeMessages() {
    _client.channel('broadcast-messages')
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'broadcast_messages'
      }, function(p) {
        if (!p.new) return;
        _notifyMessage(p.new);
      })
      .subscribe();
  }

  /* On load: fetch any messages player hasn't seen yet */
  function _checkUnreadMessages() {
    _loadLastSeen();
    _client.from('broadcast_messages')
      .select('*')
      .gt('id', _lastSeenMessageId)
      .order('id', { ascending: true })
      .then(function(res) {
        if (res.error || !res.data || !res.data.length) return;
        /* Show messages with a small delay between each */
        res.data.forEach(function(msg, i) {
          setTimeout(function() { _notifyMessage(msg); }, i * 4000);
        });
      });
  }

  /* PUBLIC: register callback for incoming messages */
  function onMessage(fn) { _messageListeners.push(fn); }

  function onChange(fn)           { _valueListeners.push(fn); fn(_localValue); }
  function onPresenceChange(fn)   { _presenceListeners.push(fn); fn(_presenceCount); }

  /* Register callbacks for force win events */
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
    getPresenceCount: getPresenceCount,
    getSessionKey:    getSessionKey,
    onChange:         onChange,
    onPresenceChange: onPresenceChange,
    onMessage:        onMessage,
    onForceWin:       onForceWin,
    onForceNotify:    onForceNotify
  };
}());
