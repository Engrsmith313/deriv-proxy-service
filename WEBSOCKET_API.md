# WebSocket API Documentation

## Overview

The Deriv Proxy Service now includes WebSocket functionality that provides real-time trade execution results and status updates. This enables bidirectional communication between the service and n8n workflows, allowing n8n to receive immediate notifications when trades are executed, completed, or their status changes.

## WebSocket Endpoint

**URL**: `ws://localhost:3000/ws` (or your deployed URL)
**Protocol**: WebSocket (ws://) or Secure WebSocket (wss://)

## Authentication

WebSocket connections require API key authentication. After connecting, clients must send an authentication message:

```json
{
  "type": "auth",
  "timestamp": 1640995200000,
  "data": {
    "apiKey": "your_api_key_here"
  }
}
```

**Authentication Response**:
```json
{
  "type": "auth_response",
  "timestamp": 1640995200000,
  "data": {
    "success": true,
    "message": "Authentication successful",
    "clientId": "uuid-client-id"
  }
}
```

## Message Types

### Incoming Messages (Client to Server)

#### 1. Authentication
```json
{
  "type": "auth",
  "timestamp": 1640995200000,
  "data": {
    "apiKey": "your_api_key_here"
  }
}
```

#### 2. Subscribe to Events
```json
{
  "type": "subscribe",
  "timestamp": 1640995200000,
  "data": {
    "events": ["trade_results", "trade_status"]
  }
}
```

#### 3. Unsubscribe from Events
```json
{
  "type": "unsubscribe",
  "timestamp": 1640995200000,
  "data": {
    "events": ["trade_status"]
  }
}
```

### Outgoing Messages (Server to Client)

#### 1. Trade Result (Final Trade Outcome)
```json
{
  "type": "trade_result",
  "timestamp": 1640995200000,
  "data": {
    "contractId": 123456789,
    "symbol": "R_100",
    "contractType": "CALL",
    "stake": 10.00,
    "buyPrice": 10.00,
    "payout": 19.50,
    "profit": 9.50,
    "profitPercentage": 95.0,
    "status": "won",
    "entrySpot": 1234.56,
    "exitSpot": 1235.78,
    "currentSpot": 1235.78,
    "purchaseTime": 1640995200000,
    "expiryTime": 1640995215000,
    "sellTime": null,
    "longcode": "Win payout if Volatility 100 Index is strictly higher than entry spot at 15 seconds after contract start time.",
    "shortcode": "CALL_R_100_10.00_1640995215_S0P_0",
    "balanceAfter": 1009.50
  }
}
```

#### 2. Trade Status Update (Real-time Updates)
```json
{
  "type": "trade_status",
  "timestamp": 1640995200000,
  "data": {
    "contractId": 123456789,
    "status": "open",
    "currentSpot": 1234.78,
    "profit": -2.50,
    "profitPercentage": -25.0,
    "timestamp": 1640995205000
  }
}
```

#### 3. Error Messages
```json
{
  "type": "error",
  "timestamp": 1640995200000,
  "data": {
    "code": "AUTHENTICATION_FAILED",
    "message": "Invalid API key",
    "details": null
  }
}
```

#### 4. Heartbeat
```json
{
  "type": "heartbeat",
  "timestamp": 1640995200000,
  "data": {
    "serverTime": 1640995200000
  }
}
```

## Event Types

- **`trade_results`**: Final trade outcomes (won/lost/sold)
- **`trade_status`**: Real-time status updates for open trades

## Status Values

- **`open`**: Trade is active and running
- **`won`**: Trade finished successfully with profit
- **`lost`**: Trade finished with loss
- **`sold`**: Trade was sold before expiry

## Configuration

WebSocket settings can be configured via environment variables:

```env
WEBSOCKET_ENABLED=true
WEBSOCKET_PORT=3001
WEBSOCKET_HEARTBEAT_INTERVAL=30000
WEBSOCKET_CLIENT_TIMEOUT=60000
WEBSOCKET_MAX_CLIENTS=100
WEBSOCKET_REQUIRE_AUTH=true
```

## Connection Management

- **Heartbeat**: Server sends heartbeat every 30 seconds (configurable)
- **Timeout**: Clients are disconnected after 60 seconds of inactivity (configurable)
- **Max Clients**: Maximum 100 concurrent connections (configurable)
- **Reconnection**: Clients should implement automatic reconnection logic

## Error Codes

- **`AUTHENTICATION_FAILED`**: Invalid API key
- **`UNKNOWN_MESSAGE_TYPE`**: Unsupported message type
- **`INVALID_MESSAGE`**: Malformed JSON message
- **`CONNECTION_TIMEOUT`**: Client inactive for too long

## WebSocket Status Endpoint

Check WebSocket service status via HTTP:

**GET** `/api/status/websocket`

```json
{
  "success": true,
  "data": {
    "enabled": true,
    "connectedClients": 2,
    "authenticatedClients": 1,
    "clients": [
      {
        "id": "uuid-client-id",
        "isAuthenticated": true,
        "connectedAt": "2023-01-01T00:00:00.000Z",
        "subscriptions": ["trade_results", "trade_status"]
      }
    ]
  }
}
```
