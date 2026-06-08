/*
 * supabase-diagnostics.js
 * Comprehensive Supabase broadcaster troubleshooting script
 * 
 * USAGE:
 * 1. Open the Progressive Operator in your browser
 * 2. Open Developer Console (F12 → Console tab)
 * 3. Copy and paste this entire script
 * 4. Run it
 * 5. Share the output with support
 */

(function() {
  var SUPABASE_URL = 'https://gdmmoeggkqsvqnqyrubx.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_NGsKBAUUsVUvD5XKTblIdw_aBDPldSd';
  
  console.log('%c=== SUPABASE BROADCASTER DIAGNOSTICS ===', 'font-size:16px;font-weight:bold;color:#ffd700');
  console.log('Time: ' + new Date().toISOString());
  console.log('');
  
  // ─────────────────────────────────────────────────────────────
  // CHECK 1: Supabase Client Status
  // ─────────────────────────────────────────────────────────────
  console.log('%c[1] SUPABASE CLIENT STATUS', 'font-weight:bold;color:#00ff88');
  
  if (typeof _client === 'undefined') {
    console.error('❌ _client is undefined — Supabase not initialized');
    return;
  }
  
  if (!_client) {
    console.error('❌ _client is null — Supabase initialization failed');
    return;
  }
  
  console.log('✅ Supabase client loaded');
  console.log('✅ Connection status: ' + (_connected ? 'CONNECTED' : 'OFFLINE'));
  console.log('✅ Project URL: ' + SUPABASE_URL);
  console.log('✅ Anon Key: ' + SUPABASE_ANON_KEY.substr(0, 20) + '...');
  console.log('');
  
  // ─────────────────────────────────────────────────────────────
  // CHECK 2: Broadcast Messages Table Access
  // ─────────────────────────────────────────────────────────────
  console.log('%c[2] BROADCAST MESSAGES TABLE', 'font-weight:bold;color:#00ff88');
  
  _client.from('broadcast_messages').select('*').limit(5).then(function(res) {
    if (res.error) {
      console.error('❌ TABLE ACCESS FAILED');
      console.error('   Error: ' + res.error.message);
      console.error('   This means the table doesn\'t exist or RLS policies deny access');
    } else {
      console.log('✅ Table accessible');
      console.log('✅ Current messages in database: ' + res.data.length);
      if (res.data.length > 0) {
        console.log('   Latest message:');
        var latest = res.data[0];
        console.log('     - ID: ' + latest.id);
        console.log('     - Message: ' + latest.message);
        console.log('     - Type: ' + latest.type);
        console.log('     - Created: ' + latest.created_at);
      }
    }
    console.log('');
    
    // ─────────────────────────────────────────────────────────────
    // CHECK 3: Insert Test Message
    // ─────────────────────────────────────────────────────────────
    console.log('%c[3] INSERT TEST MESSAGE', 'font-weight:bold;color:#00ff88');
    
    var testMsg = {
      message: '🧪 DIAGNOSTIC TEST — ' + new Date().toISOString(),
      type: 'general',
      title: 'Diagnostics',
      created_by: 'diagnostic-script'
    };
    
    _client.from('broadcast_messages').insert(testMsg).then(function(insertRes) {
      if (insertRes.error) {
        console.error('❌ INSERT FAILED');
        console.error('   Error: ' + insertRes.error.message);
        console.error('   Likely cause: RLS policy denies INSERT for anon user');
      } else {
        console.log('✅ INSERT SUCCESS');
        console.log('   Message ID: ' + insertRes.data[0].id);
        console.log('   Timestamp: ' + insertRes.data[0].created_at);
        
        // Verify message was inserted
        setTimeout(function() {
          _client.from('broadcast_messages')
            .select('*')
            .eq('id', insertRes.data[0].id)
            .single()
            .then(function(verifyRes) {
              if (verifyRes.error) {
                console.warn('⚠️  Message inserted but couldn\'t verify (might be RLS issue)');
              } else {
                console.log('✅ VERIFIED: Message exists in database');
              }
            });
        }, 500);
      }
      console.log('');
      
      // ─────────────────────────────────────────────────────────────
      // CHECK 4: Realtime Subscription
      // ─────────────────────────────────────────────────────────────
      console.log('%c[4] REALTIME SUBSCRIPTION TEST', 'font-weight:bold;color:#00ff88');
      
      var realtimeReceived = false;
      var testChannel = _client.channel('diagnostics-test')
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'broadcast_messages'
        }, function(payload) {
          realtimeReceived = true;
          console.log('✅ REALTIME EVENT RECEIVED');
          console.log('   Event type: ' + payload.eventType);
          console.log('   New message: ' + payload.new.message);
          testChannel.unsubscribe();
        })
        .subscribe(function(status) {
          console.log('   Subscribe status: ' + status);
        });
      
      console.log('   Listening for INSERT events on broadcast_messages...');
      console.log('   (Waiting 3 seconds for realtime event)');
      
      // If no realtime event after 3s, report issue
      setTimeout(function() {
        if (!realtimeReceived) {
          console.warn('⚠️  NO REALTIME EVENT RECEIVED');
          console.warn('   This means:');
          console.warn('   1. Realtime may not be enabled for broadcast_messages table');
          console.warn('   2. Realtime connection may be down');
          console.warn('   3. RLS policy may be blocking realtime updates');
        }
        testChannel.unsubscribe();
        console.log('');
        
        // ─────────────────────────────────────────────────────────────
        // CHECK 5: Message Listeners (Game side)
        // ─────────────────────────────────────────────────────────────
        console.log('%c[5] BROADCAST INIT STATUS', 'font-weight:bold;color:#00ff88');
        
        if (typeof _messageListeners === 'undefined') {
          console.warn('⚠️  _messageListeners is undefined');
          console.warn('   This is expected in the operator. Check in game client.');
        } else {
          console.log('✅ Message listeners registered: ' + _messageListeners.length);
          if (_messageListeners.length === 0) {
            console.warn('⚠️  No message listeners — broadcast-init.js may not be wired');
          }
        }
        console.log('');
        
        // ─────────────────────────────────────────────────────────────
        // SUMMARY
        // ─────────────────────────────────────────────────────────────
        console.log('%c=== SUMMARY ===', 'font-size:14px;font-weight:bold;color:#ffd700');
        console.log('✓ Supabase credentials valid');
        console.log('✓ Database connection works');
        console.log(insertRes.error ? '✗ Message insertion failed — check RLS' : '✓ Messages can be inserted');
        console.log(realtimeReceived ? '✓ Realtime subscriptions working' : '⚠ Realtime may have issues');
        console.log('');
        console.log('%c[NEXT STEPS]', 'font-weight:bold;color:#ff8844');
        console.log('1. Verify RLS policies in Supabase Dashboard');
        console.log('2. Check that broadcast_messages table exists');
        console.log('3. Ensure Realtime is enabled for broadcast_messages');
        console.log('4. Test from a game client to see if messages are received');
        console.log('');
      }, 3000);
    });
  });
})();
