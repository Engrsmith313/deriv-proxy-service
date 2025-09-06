import { DerivApiService } from './derivApi';
import { TradeRequest, TradeResponse, BalanceResponse, PortfolioResponse, ContractDetailsResponse } from '../types/api';
import { ActiveTrade } from '../types/deriv';
import { config } from '../config';
import logger from '../utils/logger';

export class TradingService {
  private derivApi: DerivApiService;
  private activeTrades = new Map<number, ActiveTrade>();
  private riskManagement: {
    maxStakePerTrade: number;
    maxDailyLoss: number;
    maxConsecutiveLosses: number;
    stopLossEnabled: boolean;
    takeProfitEnabled: boolean;
  };

  constructor(derivApi: DerivApiService) {
    this.derivApi = derivApi;
    this.riskManagement = {
      maxStakePerTrade: config.app.maxStake,
      maxDailyLoss: config.app.maxStake * 10, // 10x max stake as daily loss limit
      maxConsecutiveLosses: 5,
      stopLossEnabled: config.app.riskManagementEnabled,
      takeProfitEnabled: config.app.riskManagementEnabled
    };

    this.setupDerivApiEvents();
  }

  private setupDerivApiEvents(): void {
    this.derivApi.on('connected', () => {
      logger.info('Trading service: Deriv API connected');
    });

    this.derivApi.on('disconnected', () => {
      logger.warn('Trading service: Deriv API disconnected');
    });

    this.derivApi.on('authenticated', () => {
      logger.info('Trading service: Deriv API authenticated');
    });

    this.derivApi.on('error', (error) => {
      logger.error('Trading service: Deriv API error', error);
    });
  }

  public async executeTrade(tradeRequest: TradeRequest): Promise<TradeResponse> {
    try {
      logger.info('Executing trade', tradeRequest);

      // Validate trade request
      this.validateTradeRequest(tradeRequest);

      // Risk management checks
      if (!this.validateTrade(tradeRequest.amount)) {
        return {
          success: false,
          error: `Trade rejected by risk management. Maximum stake per trade: $${this.riskManagement.maxStakePerTrade}`,
          message: 'Risk management validation failed'
        };
      }

      if (!this.derivApi.isConnectedAndAuthenticated()) {
        return {
          success: false,
          error: 'Not connected to Deriv API',
          message: 'Connection error'
        };
      }

      // Check balance
      const balanceResponse = await this.derivApi.getBalance();
      const balance = balanceResponse?.balance?.balance || 0;
      if (balance < tradeRequest.amount) {
        return {
          success: false,
          error: 'Insufficient balance for this trade',
          message: `Current balance: $${balance}, Required: $${tradeRequest.amount}`
        };
      }

      // Execute the trade
      const tradeParams = {
        contractType: tradeRequest.contractType,
        symbol: tradeRequest.symbol,
        amount: tradeRequest.amount,
        duration: tradeRequest.duration,
        durationUnit: tradeRequest.durationUnit || 's'
      };

      const result = await this.derivApi.buyContract(tradeParams);

      if (result && result.buy) {
        const contractId = result.buy.contract_id;
        const buyPrice = result.buy.buy_price;
        const payout = result.buy.payout;
        const balanceAfter = result.buy.balance_after;
        const transactionId = result.buy.transaction_id;
        const longcode = result.buy.longcode;
        const shortcode = result.buy.shortcode;
        const purchaseTime = result.buy.purchase_time;
        const startTime = result.buy.start_time;

        // Store the trade for monitoring
        this.activeTrades.set(contractId, {
          contractId: contractId,
          symbol: tradeRequest.symbol,
          contractType: tradeRequest.contractType,
          stake: tradeRequest.amount,
          entryPrice: buyPrice,
          purchaseTime: purchaseTime * 1000, // Convert to milliseconds
          expiryTime: purchaseTime * 1000 + (tradeRequest.duration * 1000),
          payout: payout,
          isMonitoring: true
        });

        logger.info('Trade executed successfully', {
          contractId,
          buyPrice,
          payout,
          balanceAfter
        });

        return {
          success: true,
          data: {
            contractId,
            buyPrice,
            payout,
            balanceAfter,
            transactionId,
            longcode,
            shortcode,
            purchaseTime,
            startTime
          },
          message: 'Trade executed successfully'
        };
      } else {
        return {
          success: false,
          error: result.error?.message || 'Trade execution failed',
          message: 'Failed to execute trade'
        };
      }
    } catch (error) {
      logger.error('Error executing trade:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        message: 'Trade execution error'
      };
    }
  }

  public async getBalance(): Promise<BalanceResponse> {
    try {
      if (!this.derivApi.isConnectedAndAuthenticated()) {
        return {
          success: false,
          error: 'Not connected to Deriv API'
        };
      }

      const response = await this.derivApi.getBalance();
      
      if (response.balance) {
        return {
          success: true,
          data: {
            balance: response.balance.balance,
            currency: response.balance.currency,
            loginid: response.balance.loginid
          }
        };
      } else {
        return {
          success: false,
          error: response.error?.message || 'Failed to get balance'
        };
      }
    } catch (error) {
      logger.error('Error getting balance:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  public async getPortfolio(): Promise<PortfolioResponse> {
    try {
      if (!this.derivApi.isConnectedAndAuthenticated()) {
        return {
          success: false,
          error: 'Not connected to Deriv API'
        };
      }

      const response = await this.derivApi.getPortfolio();
      
      if (response.portfolio) {
        const contracts = response.portfolio.contracts.map(contract => ({
          contractId: contract.contract_id,
          symbol: contract.symbol,
          contractType: contract.contract_type,
          buyPrice: contract.buy_price,
          payout: contract.payout,
          purchaseTime: contract.purchase_time,
          expiryTime: contract.expiry_time,
          longcode: contract.longcode,
          shortcode: contract.shortcode
        }));

        return {
          success: true,
          data: {
            contracts,
            totalContracts: contracts.length
          }
        };
      } else {
        return {
          success: false,
          error: response.error?.message || 'Failed to get portfolio'
        };
      }
    } catch (error) {
      logger.error('Error getting portfolio:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  public async getContractDetails(contractId: number): Promise<ContractDetailsResponse> {
    try {
      if (!this.derivApi.isConnectedAndAuthenticated()) {
        return {
          success: false,
          error: 'Not connected to Deriv API'
        };
      }

      const response = await this.derivApi.getContractDetails(contractId);
      
      if (response.proposal_open_contract) {
        const contract = response.proposal_open_contract;
        return {
          success: true,
          data: {
            contractId: contract.contract_id,
            symbol: contract.symbol,
            contractType: contract.contract_type,
            buyPrice: contract.buy_price,
            payout: contract.payout,
            profit: contract.profit,
            profitPercentage: contract.profit_percentage,
            status: contract.status,
            isExpired: contract.is_expired === 1,
            isSold: contract.is_sold === 1,
            entrySpot: contract.entry_spot,
            exitSpot: contract.exit_spot,
            currentSpot: contract.current_spot,
            purchaseTime: contract.purchase_time,
            expiryTime: contract.expiry_time,
            longcode: contract.longcode,
            shortcode: contract.shortcode
          }
        };
      } else {
        return {
          success: false,
          error: response.error?.message || 'Failed to get contract details'
        };
      }
    } catch (error) {
      logger.error('Error getting contract details:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  private validateTradeRequest(tradeRequest: TradeRequest): void {
    if (!tradeRequest.symbol || typeof tradeRequest.symbol !== 'string') {
      throw new Error('Invalid symbol');
    }

    if (!tradeRequest.amount || typeof tradeRequest.amount !== 'number' || tradeRequest.amount <= 0) {
      throw new Error('Invalid amount');
    }

    if (!tradeRequest.contractType || typeof tradeRequest.contractType !== 'string') {
      throw new Error('Invalid contract type');
    }

    if (!tradeRequest.duration || typeof tradeRequest.duration !== 'number' || tradeRequest.duration <= 0) {
      throw new Error('Invalid duration');
    }

    // Check if contract type is allowed
    if (!config.trading.allowedContractTypes.includes(tradeRequest.contractType)) {
      throw new Error(`Contract type ${tradeRequest.contractType} is not allowed`);
    }
  }

  private validateTrade(amount: number): boolean {
    if (!this.riskManagement.stopLossEnabled) {
      return true;
    }

    // Check maximum stake per trade
    if (amount > this.riskManagement.maxStakePerTrade) {
      return false;
    }

    return true;
  }

  public isConnectedAndReady(): boolean {
    return this.derivApi.isConnectedAndAuthenticated();
  }

  public getConnectionStatus() {
    return this.derivApi.getConnectionStatus();
  }

  public getActiveTrades(): ActiveTrade[] {
    return Array.from(this.activeTrades.values());
  }
}
