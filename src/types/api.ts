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
