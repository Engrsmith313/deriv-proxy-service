// Deriv API Types

export interface DerivConfig {
  apiToken: string;
  appId: string;
  wsUrl: string;
  isDemo?: boolean;
}

export interface DerivMessage {
  msg_type: string;
  req_id?: number;
  [key: string]: any;
}

export interface DerivResponse {
  msg_type: string;
  req_id?: number;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  [key: string]: any;
}

export interface AuthorizeRequest extends DerivMessage {
  msg_type: 'authorize';
  authorize: string;
}

export interface AuthorizeResponse extends DerivResponse {
  msg_type: 'authorize';
  authorize?: {
    account_list: Account[];
    balance: number;
    country: string;
    currency: string;
    email: string;
    fullname: string;
    is_virtual: number;
    landing_company_name: string;
    loginid: string;
    scopes: string[];
  };
}

export interface Account {
  account_type: string;
  broker: string;
  created_at: number;
  currency: string;
  is_disabled: number;
  is_virtual: number;
  landing_company_name: string;
  loginid: string;
}

export interface BalanceRequest extends DerivMessage {
  msg_type: 'balance';
  balance: 1;
  subscribe?: 1;
}

export interface BalanceResponse extends DerivResponse {
  msg_type: 'balance';
  balance?: {
    balance: number;
    currency: string;
    id: string;
    loginid: string;
  };
}

export interface ContractRequest extends DerivMessage {
  msg_type: 'buy';
  buy: string;
  price: number;
  parameters?: {
    amount?: number;
    basis?: string;
    contract_type?: string;
    currency?: string;
    duration?: number;
    duration_unit?: string;
    symbol?: string;
  };
}

export interface ContractResponse extends DerivResponse {
  msg_type: 'buy';
  buy?: {
    balance_after: number;
    buy_price: number;
    contract_id: number;
    longcode: string;
    payout: number;
    purchase_time: number;
    shortcode: string;
    start_time: number;
    transaction_id: number;
  };
}

export interface PortfolioRequest extends DerivMessage {
  msg_type: 'portfolio';
  portfolio: 1;
}

export interface PortfolioResponse extends DerivResponse {
  msg_type: 'portfolio';
  portfolio?: {
    contracts: PortfolioContract[];
  };
}

export interface PortfolioContract {
  app_id: number;
  buy_price: number;
  contract_id: number;
  contract_type: string;
  currency: string;
  date_start: number;
  expiry_time: number;
  longcode: string;
  payout: number;
  purchase_time: number;
  shortcode: string;
  symbol: string;
  transaction_id: number;
}

export interface ProposalRequest extends DerivMessage {
  msg_type: 'proposal';
  proposal: 1;
  amount: number;
  basis: string;
  contract_type: string;
  currency: string;
  duration: number;
  duration_unit: string;
  symbol: string;
  subscribe?: 1;
}

export interface ProposalResponse extends DerivResponse {
  msg_type: 'proposal';
  proposal?: {
    ask_price: number;
    date_start: number;
    display_value: string;
    id: string;
    longcode: string;
    payout: number;
    spot: number;
    spot_time: number;
  };
}

export interface ProposalOpenContractRequest extends DerivMessage {
  msg_type: 'proposal_open_contract';
  proposal_open_contract: 1;
  contract_id: number;
  subscribe?: 1;
}

export interface ProposalOpenContractResponse extends DerivResponse {
  msg_type: 'proposal_open_contract';
  proposal_open_contract?: {
    account_id: number;
    barrier_count: number;
    bid_price: number;
    buy_price: number;
    contract_id: number;
    contract_type: string;
    currency: string;
    current_spot: number;
    current_spot_display_value: string;
    current_spot_time: number;
    date_expiry: number;
    date_settlement: number;
    date_start: number;
    display_name: string;
    entry_spot: number;
    entry_spot_display_value: string;
    exit_spot?: number;
    exit_spot_display_value?: string;
    exit_spot_time?: number;
    expiry_time: number;
    id: number;
    is_expired: number;
    is_forward_starting: number;
    is_intraday: number;
    is_path_dependent: number;
    is_settleable: number;
    is_sold: number;
    is_valid_to_sell: number;
    longcode: string;
    payout: number;
    profit: number;
    profit_percentage: number;
    purchase_time: number;
    shortcode: string;
    status: string;
    symbol: string;
    transaction_ids: {
      buy: number;
      sell?: number;
    };
    underlying: string;
    validation_error?: string;
  };
}

export interface ActiveTrade {
  contractId: number;
  symbol: string;
  contractType: string;
  stake: number;
  entryPrice: number;
  purchaseTime: number;
  expiryTime: number;
  payout: number;
  isMonitoring: boolean;
}
