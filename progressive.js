/*
 * progressive.js — Virtual Progressive Controller
 * Stray-Pup LLC / The Turrelle Sisters LLC
 * v1.0 | ES5 — no arrow functions, no const/let, no backticks
 *
 * Backend: Supabase (free tier, no credit card required)
 * One shared pot across all games on the same Supabase project.
 * See SUPABASE_SETUP.md for step-by-step setup.
 *
 * HOW TO USE — add before this script in each game's index.html:
 *   <script>
 *     var PROG_GAME_ID = 'straypups_5d';
 *     var PROG_DENOM   = 5.00;
 *   </script>
 */

/* ── SUPABASE CONFIG ─────────────────────────────────────────────────────
   1. supabase.com → New project (free, no card)
   2. Settings → API → copy Project URL + anon key
   3. Run SQL from SUPABASE_SETUP.md to create tables + RPC functions
   ────────────────────────────────────────────────────────────────────── */
var SUPABASE_URL      = 'https://gdmmoeggkqsvqnqyrubx.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_NGsKBAUUsVUvD5XKTblIdw_aBDPldSd';

var PROG_GAME_ID = (typeof PROG_GAME_ID !== 'undefined') ? PROG_GAME_ID : 'straypups';
var PROG_DENOM   = (typeof PROG_DENOM   !== 'undefined') ? PROG_DENOM   : 1.00;

var PROG_DEFAULTS = {
  seed:        500.00,
  ceiling:     9999.00,
  contribRate: 0.02
};

var Progressive = (function () {
  var _client      = null;
  var _channel     = null;
  var _localValue  = PROG_DEFAULTS.seed;
  var _seed        = PROG_DEFAULTS.seed;
  var _ceiling     = PROG_DEFAULTS.ceiling;
  var _contribRate = PROG_DEFAULTS.contribRate;
  var _connected   = false;
  var _listeners   = [];
  var _rowId       = 1;
  var _pendingAdd  = 0;
  var _flushTimer  = null;

  function _loadSDK(cb) {
    if (typeof window.supabase !== 'undefined') { cb(); return; }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
    s.onload  = cb;
    s.onerror = function () { console.warn('[Progressive] SDK load failed.'); };
    document.head.appendChild(s);
  }

  function _fetchRow(cb) {
    _client
      .from('progressive')
      .select('*')
      .eq('id', _rowId)
      .single()
      .then(function (res) {
        if (res.error) { console.warn('[Progressive] fetch error', res.error); return; }
        var d = res.data;
        _localValue  = d.value;
        _seed        = d.seed;
        _ceiling     = d.ceiling;
        _contribRate = d.contrib_rate;
        _notify();
        if (typeof cb === 'function') cb();
      });
  }

  function _subscribe() {
    _channel = _client
      .channel('progressive-row')
      .on('postgres_changes', {
        event:  'UPDATE',
        schema: 'public',
        table:  'progressive',
        filter: 'id=eq.' + _rowId
      }, function (payload) {
        var d = payload.new;
        if (!d) return;
        _localValue  = d.value;
        _seed        = d.seed;
        _ceiling     = d.ceiling;
        _contribRate = d.contrib_rate;
        _notify();
      })
      .subscribe();
  }

  function _scheduleFlush() {
    if (_flushTimer) return;
    _flushTimer = setTimeout(function () {
      _flushTimer = null;
      if (_pendingAdd <= 0 || !_client) return;
      var toAdd = _pendingAdd;
      _pendingAdd = 0;
      _client.rpc('progressive_contribute', { add_amount: toAdd })
        .then(function (res) {
          if (res.error) console.warn('[Progressive] contribute error', res.error);
        });
    }, 5000);
  }

  function _notify() {
    for (var i = 0; i < _listeners.length; i++) {
      try { _listeners[i](_localValue); } catch (e) {}
    }
  }

  function init(onReady) {
    _loadSDK(function () {
      try {
        _client    = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        _connected = true;
        _fetchRow(function () {
          _subscribe();
          _startPresence();
          if (typeof onReady === 'function') onReady();
        });
      } catch (e) {
        console.warn('[Progressive] init failed — local mode.', e);
        if (typeof onReady === 'function') onReady();
      }
    });
  }

  function contribute(betAmt) {
    var addition = betAmt * _contribRate;
    _localValue  = Math.min(_localValue + addition, _ceiling);
    _notify();
    if (_connected) { _pendingAdd += addition; _scheduleFlush(); }
  }

  function hit(info) {
    var hitAmt  = parseFloat(_localValue.toFixed(2));
    _localValue = _seed;
    _notify();
    if (_connected && _client) {
      var rec = {
        game_id: PROG_GAME_ID,
        denom:   PROG_DENOM,
        amount:  hitAmt,
        pattern: (info && info.pattern) ? info.pattern : 'Progressive Jackpot',
        balls:   (info && info.balls)   ? info.balls   : 0,
        bet:     (info && info.bet)     ? info.bet      : 0
      };
      _client.rpc('progressive_hit', { reset_to: _seed });
      _client.from('progressive_hits').insert(rec);
    }
    return hitAmt;
  }

  function mustHit()     { return _localValue >= _ceiling; }
  function getDisplay()  { return '$' + _localValue.toFixed(2); }
  function getValue()    { return _localValue; }
  function isConnected() { return _connected; }

  function onChange(fn) {
    _listeners.push(fn);
    fn(_localValue);
  }

  return {
    init: init, contribute: contribute, hit: hit,
    mustHit: mustHit, getDisplay: getDisplay,
    getValue: getValue, onChange: onChange, isConnected: isConnected,
    getPresenceCount: getPresenceCount, onPresenceChange: onPresenceChange
  };
}());
