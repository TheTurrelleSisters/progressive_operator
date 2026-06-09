/* ================================================================
   progressive.js — Gold Coins Casino Progressive Operator v2.1
   Supabase connection + all operator actions.
   Splash dismisses ONLY after a confirmed database connection.
   ================================================================ */

var SUPABASE_URL     = 'https://gdmmoeggkqsvqnqyrubx.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_NGsKBAUUsVUvD5XKTblIdw_aBDPldSd';

/* ── BUG FIX: Unique channel suffix so multiple operator tabs don't collide ── */
var _CHAN_SUFFIX = Math.random().toString(36).slice(2, 8);

var _sb   = null;   // supabase client
var _armed = false; // jackpot arm state

/* ── Splash / connection gate ─────────────────────────────────── */

function _splashStatus(msg) {
  var el = document.getElementById('loading-text');
  if (el) el.textContent = msg;
}

function _dismissSplash() {
  var splash = document.getElementById('splash');
  var lock   = document.getElementById('lock-screen');
  if (!splash) return;
  _splashStatus('Connected ✓');
  splash.classList.add('fade-out');
  setTimeout(function() {
    splash.style.display = 'none';
    if (lock) lock.classList.add('show');
  }, 850);
}

function _splashError(msg) {
  _splashStatus(msg || 'Connection failed — retrying…');
}

/* ── Badge helper ── */
function _setBadge(ok) {
  var el = document.getElementById('conn-badge');
  if (!el) return;
  el.className = ok ? 'ok' : 'err';
  el.textContent = ok ? 'LIVE' : 'OFFLINE';
}

/* ── Load Supabase SDK, then connect ── */
(function init() {
  _splashStatus('Loading database SDK…');
  var s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.0/dist/umd/supabase.min.js?v=' + Date.now();

  s.onerror = function() {
    _splashError('SDK load failed — check connection');
    /* Retry after 4s */
    setTimeout(init, 4000);
  };

  s.onload = function() {
    _splashStatus('Connecting to database…');
    try {
      _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

      /* Verify connection with a real DB read */
      _sb.from('progressive').select('value,seed,armed').eq('id', 1).single()
        .then(function(r) {
          if (r.error) {
            _splashError('DB error: ' + r.error.message);
            _setBadge(false);
            /* Retry after 5s */
            setTimeout(function() { _retryConnect(); }, 5000);
            return;
          }

          /* ── Connected! ── */
          _setBadge(true);
          _updatePotDisplay(r.data.value, r.data.seed);
          if (r.data.armed) _setArmed(true);

          /* Now it's safe to dismiss the splash */
          _dismissSplash();

          /* Subscribe to live updates */
          _sb.channel('op-prog-' + _CHAN_SUFFIX)
            .on('postgres_changes', {
              event: 'UPDATE', schema: 'public', table: 'progressive', filter: 'id=eq.1'
            }, function(p) {
              if (p.new) {
                _updatePotDisplay(p.new.value, p.new.seed);
                _setArmed(!!p.new.armed);
              }
            })
            .subscribe(function(status) {
              _setBadge(status === 'SUBSCRIBED');
            });
        })
        .catch(function(err) {
          _splashError('Connection error — retrying…');
          setTimeout(function() { _retryConnect(); }, 5000);
        });

    } catch(e) {
      _splashError('Init error: ' + e.message);
      setTimeout(init, 4000);
    }
  };

  document.head.appendChild(s);
}());

function _retryConnect() {
  if (!_sb) {
    _splashError('Client not initialized — reloading…');
    setTimeout(function() { window.location.reload(); }, 3000);
    return;
  }
  _splashStatus('Retrying connection…');
  _sb.from('progressive').select('value,seed,armed').eq('id', 1).single()
    .then(function(r) {
      if (r.error) {
        _splashError('Still offline — retrying…');
        setTimeout(_retryConnect, 5000);
        return;
      }
      _setBadge(true);
      _updatePotDisplay(r.data.value, r.data.seed);
      if (r.data.armed) _setArmed(true);
      _dismissSplash();

      /* Re-subscribe to live updates after reconnect */
      _sb.channel('op-prog-' + _CHAN_SUFFIX)
        .on('postgres_changes', {
          event: 'UPDATE', schema: 'public', table: 'progressive', filter: 'id=eq.1'
        }, function(p) {
          if (p.new) {
            _updatePotDisplay(p.new.value, p.new.seed);
            _setArmed(!!p.new.armed);
          }
        })
        .subscribe(function(status) {
          _setBadge(status === 'SUBSCRIBED');
        });
    })
    .catch(function() {
      _splashError('Still offline — retrying…');
      setTimeout(_retryConnect, 5000);
    });
}

/* ── Display helpers ── */

function _updatePotDisplay(val, seed) {
  var v = Number(val || 0).toFixed(2);
  var s = Number(seed || 0).toFixed(2);
  var potVal  = document.getElementById('pot-val');
  var ctrlPot = document.getElementById('ctrl-pot');
  var potSeed = document.getElementById('pot-seed');
  if (potVal)  potVal.textContent  = '$' + v;
  if (ctrlPot) ctrlPot.textContent = '$' + v;
  if (potSeed) potSeed.textContent = '$' + s;

  var upd = document.getElementById('pot-updated');
  if (upd) {
    var now = new Date();
    upd.textContent = 'Updated ' + now.toLocaleTimeString();
  }
  /* Sync seed input if user hasn't edited it */
  var inp = document.getElementById('inp-seed');
  if (inp && document.activeElement !== inp) inp.value = s;
}

function _setArmed(armed) {
  _armed = armed;
  var banner = document.getElementById('armed-banner');
  if (banner) banner.classList.toggle('show', armed);
}

function _toast(msg) {
  var el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('on');
  setTimeout(function() { el.classList.remove('on'); }, 2500);
}

/* ── Operator actions (exposed on window so index.html stubs call them) ── */

window._op_saveSeed = function() {
  if (!_sb) return _toast('Not connected');
  var val = parseFloat(document.getElementById('inp-seed').value);
  if (isNaN(val) || val < 0) return _toast('Invalid seed value');
  _sb.from('progressive').update({ seed: val }).eq('id', 1)
    .then(function(r) {
      if (r.error) _toast('Error: ' + r.error.message);
      else _toast('Seed saved: $' + val.toFixed(2));
    });
};

window._op_arm = function() {
  if (!_sb) return _toast('Not connected');
  if (_armed) return _toast('Already armed');
  if (!confirm('ARM the jackpot? Next eligible spin will trigger a payout.')) return;
  _sb.from('progressive').update({ armed: true }).eq('id', 1)
    .then(function(r) {
      if (r.error) _toast('Error: ' + r.error.message);
      else { _setArmed(true); _toast('Jackpot ARMED'); }
    });
};

window._op_disarm = function() {
  if (!_sb) return _toast('Not connected');
  _sb.from('progressive').update({ armed: false }).eq('id', 1)
    .then(function(r) {
      if (r.error) _toast('Error: ' + r.error.message);
      else { _setArmed(false); _toast('Jackpot disarmed'); }
    });
};

window._op_setPot = function() {
  if (!_sb) return _toast('Not connected');
  var val = parseFloat(document.getElementById('inp-override').value);
  if (isNaN(val) || val < 0) return _toast('Enter a valid amount');
  _sb.from('progressive').update({ value: val }).eq('id', 1)
    .then(function(r) {
      if (r.error) _toast('Error: ' + r.error.message);
      else _toast('Pot set to $' + val.toFixed(2));
    });
};

window._op_trigger = function() {
  if (!_sb) return _toast('Not connected');
  var potEl = document.getElementById('pot-val');
  var amt = potEl ? parseFloat(potEl.textContent.replace('$','')) : 0;
  if (isNaN(amt) || amt <= 0) return _toast('Invalid pot amount');
  var seed = parseFloat(document.getElementById('inp-seed').value) || 500;
  var confirmed = window.confirm('TRIGGER a jackpot hit of $' + amt.toFixed(2) + '?');
  if (!confirmed) return;

  /* Step 1: insert hit record */
  _sb.from('progressive_hits').insert({ amount: amt, game: 'OPERATOR MANUAL', ts: new Date().toISOString() })
    .then(function(r) {
      if (r.error) {
        _toast('Hit insert error: ' + r.error.message);
        return null; /* signal failure to next .then() */
      }
      /* Step 2: reset pot */
      return _sb.from('progressive').update({ value: seed, armed: false }).eq('id', 1);
    })
    .then(function(r) {
      if (r === null) return; /* insert failed, already toasted */
      if (r && r.error) _toast('Reset error: ' + r.error.message);
      else _toast('Jackpot triggered! Pot reset to $' + seed.toFixed(2));
    })
    .catch(function(err) {
      _toast('Trigger error: ' + (err.message || 'unknown'));
    });
};

window._op_sendMsg = function() {
  if (!_sb) return _toast('Not connected');
  var msg  = (document.getElementById('msg-text').value || '').trim();
  var type = document.getElementById('msg-type').value || 'general';
  if (!msg) return _toast('Enter a message first');
  _sb.from('broadcast_messages').insert({ message: msg, type: type, ts: new Date().toISOString() })
    .then(function(r) {
      if (r.error) _toast('Error: ' + r.error.message);
      else {
        _toast('Message broadcast!');
        document.getElementById('msg-text').value = '';
      }
    });
};

window._op_loadHist = function() {
  if (!_sb) return;
  var list = document.getElementById('history-list');
  if (!list) return;
  list.innerHTML = '<div style="color:var(--dim);font-size:11px;text-align:center;padding:20px">Loading…</div>';
  _sb.from('progressive_hits').select('*').order('ts', { ascending: false }).limit(20)
    .then(function(r) {
      if (r.error) {
        list.innerHTML = '<div style="color:#ff4444;font-size:11px;text-align:center;padding:20px">Error loading history: ' + r.error.message + '</div>';
        return;
      }
      if (!r.data || !r.data.length) {
        list.innerHTML = '<div style="color:var(--dim);font-size:11px;text-align:center;padding:20px">No hits recorded yet</div>';
        return;
      }
      list.innerHTML = r.data.map(function(h) {
        var d = h.ts ? new Date(h.ts).toLocaleString() : '—';
        return '<div class="hit-row">' +
          '<div class="hit-game">' + (h.game || 'Unknown') + '</div>' +
          '<div class="hit-amt">$' + Number(h.amount || 0).toFixed(2) + '</div>' +
          '<div class="hit-meta">' + d + '</div>' +
          '</div>';
      }).join('');
    })
    .catch(function(err) {
      list.innerHTML = '<div style="color:#ff4444;font-size:11px;text-align:center;padding:20px">Error: ' + (err.message || 'unknown') + '</div>';
    });
};

window._op_loadStats = function() {
  if (!_sb) return;
  _sb.from('progressive_hits').select('amount')
    .then(function(r) {
      if (r.error || !r.data) return;
      var hits  = r.data.length;
      var total = r.data.reduce(function(a, h) { return a + Number(h.amount || 0); }, 0);
      var avg   = hits ? total / hits : 0;
      var max   = hits ? Math.max.apply(null, r.data.map(function(h) { return Number(h.amount || 0); })) : 0;
      var se = document.getElementById('stat-hits');  if(se) se.textContent = hits;
      var st = document.getElementById('stat-total'); if(st) st.textContent = '$' + total.toFixed(0);
      var sa = document.getElementById('stat-avg');   if(sa) sa.textContent = '$' + avg.toFixed(0);
      var sm = document.getElementById('stat-max');   if(sm) sm.textContent = '$' + max.toFixed(0);
    });
};
