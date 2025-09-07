// API Request/Response Types

export interface TradeRequest {
  symbol: string;
  amount: number;
  contractType: string;
  duration: number;
  durationUnit?: string;
  currency?: string;
}

export interface TradeResponse {
  success: boolean;
  data?: {
    contractId: number;
    buyPrice: number;
    payout: number;
    balanceAfter: number;
    transactionId: number;
    entryPrice?: number;
    longcode: string;
    shortcode: string;
    purchaseTime: number;
    startTime: number;
  };
  error?: string;
  message?: string;
}

export interface BalanceResponse {
  success: boolean;
  data?: {
    balance: number;
    currency: string;
    loginid: string;
  };
  error?: string;
}

export interface StatusResponse {
  success: boolean;
  data?: {
    connected: boolean;
    authenticated: boolean;
    lastActivity: string;
    uptime: number;
  };
  error?: string;
}

export interface PortfolioResponse {
  success: boolean;
  data?: {
    contracts: Array<{
      contractId: number;
      symbol: string;
      contractType: string;
      buyPrice: number;
      payout: number;
      purchaseTime: number;
      expiryTime: number;
      longcode: string;
      shortcode: string;
    }>;
    totalContracts: number;
  };
  error?: string;
}

export interface ContractDetailsResponse {
  success: boolean;
  data?: {
    contractId: number;
    symbol: string;
    contractType: string;
    buyPrice: number;
    payout: number;
    profit: number;
    profitPercentage: number;
    status: string;
    isExpired: boolean;
    isSold: boolean;
    entrySpot: number;
    exitSpot?: number;
    currentSpot: number;
    purchaseTime: number;
    expiryTime: number;
    longcode: string;
    shortcode: string;
  };
  error?: string;
}

export interface ApiError {
  success: false;
  error: string;
  code?: string;
  details?: any;
}

export interface ValidationError extends ApiError {
  validationErrors: Array<{
    field: string;
    message: string;
  }>;
}

// WebSocket Message Types
export interface WebSocketMessage {
  type: string;
  timestamp: number;
  data?: any;
}

export interface WebSocketAuthMessage extends WebSocketMessage {
  type: 'auth';
  data: {
    apiKey: string;
  };
}

export interface WebSocketAuthResponse extends WebSocketMessage {
  type: 'auth_response';
  data: {
    success: boolean;
    message: string;
    clientId?: string;
  };
}

export interface WebSocketTradeResultMessage extends WebSocketMessage {
  type: 'trade_result';
  data: {
    contractId: number;
    symbol: string;
    contractType: string;
    stake: number;
    buyPrice: number;
    payout: number;
    profit?: number;
    profitPercentage?: number;
    status: 'open' | 'won' | 'lost' | 'sold';
    entrySpot?: number;
    exitSpot?: number;
    currentSpot?: number;
    purchaseTime: number;
    expiryTime: number;
    sellTime?: number;
    longcode: string;
    shortcode: string;
    balanceAfter?: number;
  };
}

export interface WebSocketTradeStatusMessage extends WebSocketMessage {
  type: 'trade_status';
  data: {
    contractId: number;
    status: 'open' | 'won' | 'lost' | 'sold';
    currentSpot?: number;
    profit?: number;
    profitPercentage?: number;
  };
}

export interface WebSocketErrorMessage extends WebSocketMessage {
  type: 'error';
  data: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface WebSocketHeartbeatMessage extends WebSocketMessage {
  type: 'heartbeat';
  data: {
    serverTime: number;
  };
}

export interface WebSocketSubscriptionMessage extends WebSocketMessage {
  type: 'subscribe';
  data: {
    events: string[];
  };
}

export interface WebSocketUnsubscriptionMessage extends WebSocketMessage {
  type: 'unsubscribe';
  data: {
    events: string[];
  };
}

export type WebSocketIncomingMessage =
  | WebSocketAuthMessage
  | WebSocketSubscriptionMessage
  | WebSocketUnsubscriptionMessage;

export type WebSocketOutgoingMessage =
  | WebSocketAuthResponse
  | WebSocketTradeResultMessage
  | WebSocketTradeStatusMessage
  | WebSocketErrorMessage
  | WebSocketHeartbeatMessage;

// WebSocket Client Management
export interface WebSocketClient {
  id: string;
  socket: any; // WebSocket instance
  isAuthenticated: boolean;
  apiKey?: string;
  connectedAt: number;
  lastActivity: number;
  subscriptions: Set<string>;
}

export interface WebSocketServerConfig {
  port: number;
  heartbeatInterval: number;
  clientTimeout: number;
  maxClients: number;
  requireAuth: boolean;
}
