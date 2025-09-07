import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { 
  DerivConfig, 
  DerivMessage, 
  DerivResponse, 
  AuthorizeRequest,
  AuthorizeResponse,
  BalanceRequest,
  BalanceResponse,
  ContractRequest,
  ContractResponse,
  PortfolioRequest,
  PortfolioResponse,
  ProposalRequest,
  ProposalResponse
} from '../types/deriv';
import logger from '../utils/logger';

export class DerivApiService extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: DerivConfig;
  private isConnected = false;
  private isAuthenticated = false;
  private requestId = 1;
  private pendingRequests = new Map<number, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timeout: NodeJS.Timeout;
  }>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second
  private lastActivity = new Date();

  constructor(config: DerivConfig) {
    super();
    this.config = config;
  }

  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const wsUrlWithAppId = `${this.config.wsUrl}?app_id=${this.config.appId}`;
        logger.info(`Connecting to Deriv API: ${wsUrlWithAppId}`);

        this.ws = new WebSocket(wsUrlWithAppId);

        this.ws.on('open', () => {
          logger.info('Connected to Deriv API');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.lastActivity = new Date();
          this.emit('connected');
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const message: DerivResponse = JSON.parse(data.toString());
            this.lastActivity = new Date();
            this.handleMessage(message);
          } catch (error) {
            logger.error('Error parsing message:', error);
          }
        });

        this.ws.on('close', (code: number, reason: string) => {
          logger.warn(`Deriv API connection closed: ${code} - ${reason}`);
          this.isConnected = false;
          this.isAuthenticated = false;
          this.emit('disconnected', { code, reason });
          this.handleReconnection();
        });

        this.ws.on('error', (error: Error) => {
          logger.error('Deriv API WebSocket error:', error);
          this.emit('error', error);
          reject(error);
        });

      } catch (error) {
        logger.error('Error creating WebSocket connection:', error);
        reject(error);
      }
    });
  }

  public async authenticate(): Promise<AuthorizeResponse> {
    if (!this.isConnected) {
      throw new Error('Not connected to Deriv API');
    }

    const request = {
      authorize: this.config.apiToken,
      req_id: this.requestId++
    };

    try {
      const response = await this.sendRequest<AuthorizeResponse>(request);
      
      if (response.error) {
        throw new Error(`Authentication failed: ${response.error.message}`);
      }

      this.isAuthenticated = true;
      logger.info('Successfully authenticated with Deriv API');
      this.emit('authenticated', response.authorize);
      
      return response;
    } catch (error) {
      logger.error('Authentication error:', error);
      throw error;
    }
  }

  public async getBalance(): Promise<BalanceResponse> {
    this.ensureAuthenticated();

    const request = {
      balance: 1,
      req_id: this.requestId++
    };

    return this.sendRequest<BalanceResponse>(request);
  }

  public async getPortfolio(): Promise<PortfolioResponse> {
    this.ensureAuthenticated();

    const request = {
      portfolio: 1,
      req_id: this.requestId++
    };

    return this.sendRequest<PortfolioResponse>(request);
  }

  public async getTicks(symbol: string): Promise<any> {
    this.ensureAuthenticated();

    const request = {
      ticks_history: symbol,
      adjust_start_time: 1,
      count: 1,
      end: 'latest',
      start: 1,
      style: 'ticks',
      req_id: this.requestId++
    };

    return this.sendRequest(request);
  }

  public async getContractDetails(contractId: number): Promise<any> {
    this.ensureAuthenticated();

    const request = {
      proposal_open_contract: 1,
      contract_id: contractId,
      req_id: this.requestId++
    };

    return this.sendRequest(request);
  }

  public async subscribeToContract(contractId: number): Promise<any> {
    this.ensureAuthenticated();

    const request = {
      proposal_open_contract: 1,
      contract_id: contractId,
      subscribe: 1,
      req_id: this.requestId++
    };

    return this.sendRequest(request);
  }

  public async unsubscribeFromContract(contractId: number): Promise<any> {
    this.ensureAuthenticated();

    const request = {
      forget_all: 'proposal_open_contract',
      req_id: this.requestId++
    };

    return this.sendRequest(request);
  }

  public async subscribeToPortfolio(): Promise<any> {
    this.ensureAuthenticated();

    const request = {
      portfolio: 1,
      subscribe: 1,
      req_id: this.requestId++
    };

    return this.sendRequest(request);
  }

  public async unsubscribeFromPortfolio(): Promise<any> {
    this.ensureAuthenticated();

    const request = {
      forget_all: 'portfolio',
      req_id: this.requestId++
    };

    return this.sendRequest(request);
  }

  public async buyContract(params: {
    contractType: string;
    symbol: string;
    amount: number;
    duration: number;
    durationUnit: string;
    basis?: string;
  }): Promise<ContractResponse> {
    this.ensureAuthenticated();

    // First get a proposal to get the contract ID
    const proposalRequest = {
      proposal: 1,
      amount: params.amount,
      basis: params.basis || 'stake',
      contract_type: params.contractType,
      currency: 'USD', // This should be dynamic based on account
      duration: params.duration,
      duration_unit: params.durationUnit,
      symbol: params.symbol,
      req_id: this.requestId++
    };

    const proposalResponse = await this.sendRequest<ProposalResponse>(proposalRequest);
    
    if (proposalResponse.error || !proposalResponse.proposal) {
      throw new Error(`Failed to get proposal: ${proposalResponse.error?.message || 'Unknown error'}`);
    }

    // Now buy the contract
    const buyRequest = {
      buy: proposalResponse.proposal.id,
      price: params.amount,
      req_id: this.requestId++
    };

    return this.sendRequest<ContractResponse>(buyRequest);
  }

  public sendRequest<T extends DerivResponse>(request: any): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected || !this.ws) {
        reject(new Error('Not connected to Deriv API'));
        return;
      }

      const reqId = request.req_id || this.requestId++;

      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error('Request timeout'));
      }, 30000); // 30 second timeout

      // Store the request
      this.pendingRequests.set(reqId, {
        resolve,
        reject,
        timeout
      });

      // Send the request
      try {
        this.ws.send(JSON.stringify(request));
        logger.debug(`Sent request: ${request.msg_type || 'unknown'}`, { reqId });
      } catch (error) {
        this.pendingRequests.delete(reqId);
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  private handleMessage(message: DerivResponse): void {
    logger.debug(`Received message: ${message.msg_type}`, { reqId: message.req_id });

    // Handle responses to specific requests
    if (message.req_id && this.pendingRequests.has(message.req_id)) {
      const pending = this.pendingRequests.get(message.req_id)!;
      this.pendingRequests.delete(message.req_id);
      clearTimeout(pending.timeout);

      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message);
      }
      return;
    }

    // Handle subscription messages and other events
    this.emit('message', message);
    this.emit(message.msg_type, message);
  }

  private handleReconnection(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff

    logger.info(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(async () => {
      try {
        await this.connect();
        if (this.config.apiToken) {
          await this.authenticate();
        }
      } catch (error) {
        logger.error('Reconnection failed:', error);
      }
    }, delay);
  }

  private ensureAuthenticated(): void {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated with Deriv API');
    }
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.isAuthenticated = false;
    
    // Clear all pending requests
    this.pendingRequests.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error('Connection closed'));
    });
    this.pendingRequests.clear();
  }

  public isConnectedAndAuthenticated(): boolean {
    return this.isConnected && this.isAuthenticated;
  }

  public getLastActivity(): Date {
    return this.lastActivity;
  }

  public getConnectionStatus(): { connected: boolean; authenticated: boolean; lastActivity: Date } {
    return {
      connected: this.isConnected,
      authenticated: this.isAuthenticated,
      lastActivity: this.lastActivity
    };
  }
}
