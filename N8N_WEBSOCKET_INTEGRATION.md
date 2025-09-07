# n8n WebSocket Integration Guide

## Overview

This guide shows how to integrate n8n with the Deriv Proxy Service WebSocket API to receive real-time trade execution results and status updates.

## Integration Architecture

1. **Trade Execution**: n8n sends HTTP POST requests to execute trades (existing functionality)
2. **Real-time Updates**: n8n connects via WebSocket to receive trade results and status updates
3. **Bidirectional Communication**: Complete feedback loop for trade monitoring

## n8n WebSocket Node Configuration

### 1. WebSocket Connection Setup

Use the **WebSocket** node in n8n with the following configuration:

**Connection Settings:**
- **URL**: `ws://your-service-url/ws` (or `wss://` for secure connections)
- **Authentication**: None (handled via message)
- **Reconnect**: Enabled
- **Reconnect Interval**: 5000ms

### 2. Authentication Message

After connection, send authentication message using a **Function** node:

```javascript
// Authentication function
return {
  json: {
    type: "auth",
    timestamp: Date.now(),
    data: {
      apiKey: "your_api_key_here" // Use environment variable
    }
  }
};
```

### 3. Message Processing

Use a **Switch** node to handle different message types:

**Switch Conditions:**
- `{{ $json.type === "auth_response" }}`
- `{{ $json.type === "trade_result" }}`
- `{{ $json.type === "trade_status" }}`
- `{{ $json.type === "error" }}`
- `{{ $json.type === "heartbeat" }}`

## Example n8n Workflow

### Complete Trading Workflow with WebSocket

```json
{
  "name": "Deriv Trading with WebSocket",
  "nodes": [
    {
      "parameters": {
        "url": "ws://localhost:3000/ws",
        "options": {
          "reconnect": true,
          "reconnectInterval": 5000
        }
      },
      "name": "WebSocket",
      "type": "n8n-nodes-base.webSocket",
      "position": [200, 300]
    },
    {
      "parameters": {
        "functionCode": "// Send authentication after connection\nif ($input.first().json.type === 'connection') {\n  return {\n    json: {\n      type: 'auth',\n      timestamp: Date.now(),\n      data: {\n        apiKey: $env.API_KEY\n      }\n    }\n  };\n}\nreturn $input.all();"
      },
      "name": "Auth Handler",
      "type": "n8n-nodes-base.function",
      "position": [400, 300]
    },
    {
      "parameters": {
        "conditions": {
          "string": [
            {
              "value1": "={{ $json.type }}",
              "operation": "equal",
              "value2": "trade_result"
            }
          ]
        }
      },
      "name": "Trade Result Filter",
      "type": "n8n-nodes-base.switch",
      "position": [600, 200]
    },
    {
      "parameters": {
        "conditions": {
          "string": [
            {
              "value1": "={{ $json.type }}",
              "operation": "equal",
              "value2": "trade_status"
            }
          ]
        }
      },
      "name": "Trade Status Filter",
      "type": "n8n-nodes-base.switch",
      "position": [600, 400]
    }
  ],
  "connections": {
    "WebSocket": {
      "main": [
        [
          {
            "node": "Auth Handler",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Auth Handler": {
      "main": [
        [
          {
            "node": "Trade Result Filter",
            "type": "main",
            "index": 0
          },
          {
            "node": "Trade Status Filter",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  }
}
```

## Processing Trade Results

### Function Node for Trade Result Processing

```javascript
// Process trade result
const tradeResult = $json.data;

// Log the result
console.log(`Trade ${tradeResult.contractId} ${tradeResult.status}`);
console.log(`Profit: ${tradeResult.profit} (${tradeResult.profitPercentage}%)`);

// Prepare data for further processing
return {
  json: {
    contractId: tradeResult.contractId,
    symbol: tradeResult.symbol,
    status: tradeResult.status,
    profit: tradeResult.profit,
    profitPercentage: tradeResult.profitPercentage,
    stake: tradeResult.stake,
    payout: tradeResult.payout,
    timestamp: new Date().toISOString(),
    // Add any custom fields needed for your workflow
    isWin: tradeResult.status === 'won',
    isLoss: tradeResult.status === 'lost'
  }
};
```

## Telegram Notifications

### Enhanced Telegram Node for Trade Results

```javascript
// Function node to format Telegram message
const data = $json.data;
const status = data.status.toUpperCase();
const emoji = data.status === 'won' ? '✅' : data.status === 'lost' ? '❌' : '🔄';

const message = `${emoji} **TRADE ${status}**

📊 **Contract**: ${data.contractId}
💰 **Symbol**: ${data.symbol}
📈 **Type**: ${data.contractType}
💵 **Stake**: $${data.stake}
💸 **Payout**: $${data.payout}
📊 **Profit**: $${data.profit} (${data.profitPercentage}%)
⏰ **Duration**: ${Math.round((data.expiryTime - data.purchaseTime) / 1000)}s
🎯 **Entry**: ${data.entrySpot}
🏁 **Exit**: ${data.exitSpot}
💰 **Balance**: $${data.balanceAfter}

⏰ ${new Date().toLocaleString()}`;

return {
  json: {
    text: message,
    parse_mode: 'Markdown'
  }
};
```

## Error Handling

### WebSocket Error Handler

```javascript
// Function node for error handling
const error = $json.data;

console.error(`WebSocket Error: ${error.code} - ${error.message}`);

// Handle specific error types
switch (error.code) {
  case 'AUTHENTICATION_FAILED':
    // Trigger re-authentication
    return {
      json: {
        action: 'reauthenticate',
        error: error
      }
    };
  
  case 'CONNECTION_TIMEOUT':
    // Trigger reconnection
    return {
      json: {
        action: 'reconnect',
        error: error
      }
    };
  
  default:
    // Log and continue
    return {
      json: {
        action: 'log',
        error: error
      }
    };
}
```

## Best Practices

### 1. Connection Management
- Always implement reconnection logic
- Handle authentication failures gracefully
- Monitor connection status

### 2. Message Filtering
- Use Switch nodes to filter message types
- Process only relevant messages
- Implement proper error handling

### 3. Data Storage
- Store trade results in a database for analysis
- Keep track of active trades
- Implement proper logging

### 4. Rate Limiting
- Respect WebSocket connection limits
- Implement proper backoff strategies
- Monitor connection health

## Environment Variables

Set these in your n8n environment:

```env
API_KEY=your_secure_api_key_here
WEBSOCKET_URL=ws://your-service-url/ws
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id
```

## Testing

### WebSocket Connection Test

Use a simple WebSocket client to test the connection:

```javascript
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000/ws');

ws.on('open', function open() {
  console.log('Connected to WebSocket');
  
  // Send authentication
  ws.send(JSON.stringify({
    type: 'auth',
    timestamp: Date.now(),
    data: {
      apiKey: 'your_api_key_here'
    }
  }));
});

ws.on('message', function message(data) {
  const msg = JSON.parse(data);
  console.log('Received:', msg);
});

ws.on('error', function error(err) {
  console.error('WebSocket error:', err);
});
```

This integration provides complete real-time feedback for your trading operations, enabling more sophisticated trading strategies and better monitoring capabilities.
