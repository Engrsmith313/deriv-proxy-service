const WebSocket = require('ws');

// Test WebSocket connection
function testWebSocketConnection() {
  console.log('Testing WebSocket connection...');
  
  const ws = new WebSocket('ws://localhost:3000/ws');
  
  ws.on('open', function open() {
    console.log('✅ Connected to WebSocket server');
    
    // Send authentication message
    const authMessage = {
      type: 'auth',
      timestamp: Date.now(),
      data: {
        apiKey: 'your_secure_api_key_here' // Use your actual API key
      }
    };
    
    console.log('📤 Sending authentication message...');
    ws.send(JSON.stringify(authMessage));
  });
  
  ws.on('message', function message(data) {
    try {
      const msg = JSON.parse(data.toString());
      console.log('📥 Received message:', JSON.stringify(msg, null, 2));
      
      // Handle authentication response
      if (msg.type === 'auth_response') {
        if (msg.data.success) {
          console.log('✅ Authentication successful');
          
          // Subscribe to events
          const subscribeMessage = {
            type: 'subscribe',
            timestamp: Date.now(),
            data: {
              events: ['trade_results', 'trade_status']
            }
          };
          
          console.log('📤 Subscribing to events...');
          ws.send(JSON.stringify(subscribeMessage));
        } else {
          console.log('❌ Authentication failed:', msg.data.message);
        }
      }
      
      // Handle heartbeat
      if (msg.type === 'heartbeat') {
        console.log('💓 Heartbeat received');
      }
      
      // Handle trade results
      if (msg.type === 'trade_result') {
        console.log('🎯 Trade result received:', {
          contractId: msg.data.contractId,
          status: msg.data.status,
          profit: msg.data.profit
        });
      }
      
      // Handle trade status
      if (msg.type === 'trade_status') {
        console.log('📊 Trade status update:', {
          contractId: msg.data.contractId,
          status: msg.data.status,
          profit: msg.data.profit
        });
      }
      
    } catch (error) {
      console.error('❌ Error parsing message:', error);
    }
  });
  
  ws.on('error', function error(err) {
    console.error('❌ WebSocket error:', err.message);
  });
  
  ws.on('close', function close(code, reason) {
    console.log(`🔌 Connection closed: ${code} - ${reason}`);
  });
  
  // Keep connection alive for testing
  setTimeout(() => {
    console.log('🔌 Closing test connection...');
    ws.close();
  }, 30000); // Close after 30 seconds
}

// Test HTTP endpoints
async function testHttpEndpoints() {
  console.log('\nTesting HTTP endpoints...');
  
  try {
    // Test health endpoint
    const healthResponse = await fetch('http://localhost:3000/api/status/health');
    const healthData = await healthResponse.json();
    console.log('✅ Health endpoint:', healthData.success ? 'OK' : 'FAILED');
    
    // Test WebSocket status endpoint
    const wsStatusResponse = await fetch('http://localhost:3000/api/status/websocket');
    const wsStatusData = await wsStatusResponse.json();
    console.log('✅ WebSocket status endpoint:', wsStatusData.success ? 'OK' : 'FAILED');
    console.log('📊 WebSocket status:', {
      enabled: wsStatusData.data?.enabled,
      connectedClients: wsStatusData.data?.connectedClients,
      authenticatedClients: wsStatusData.data?.authenticatedClients
    });
    
  } catch (error) {
    console.error('❌ HTTP endpoint test failed:', error.message);
  }
}

// Main test function
async function runTests() {
  console.log('🚀 Starting WebSocket implementation tests...\n');
  
  // Test HTTP endpoints first
  await testHttpEndpoints();
  
  // Wait a bit then test WebSocket
  setTimeout(() => {
    testWebSocketConnection();
  }, 2000);
}

// Check if fetch is available (Node.js 18+)
if (typeof fetch === 'undefined') {
  console.log('⚠️  fetch not available, installing node-fetch for HTTP tests...');
  try {
    const fetch = require('node-fetch');
    global.fetch = fetch;
  } catch (error) {
    console.log('⚠️  node-fetch not installed, skipping HTTP tests');
    console.log('   Run: npm install node-fetch');
    // Just run WebSocket test
    setTimeout(testWebSocketConnection, 1000);
    return;
  }
}

runTests();
