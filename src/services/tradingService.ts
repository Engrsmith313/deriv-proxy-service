import { DerivApiService } from './derivApi';
import { WebSocketService } from './webSocketService';
import { MarketSelectionService, MarketSelectionResult } from './marketSelectionService';
import { TradeRequest, TradeResponse, BalanceResponse, PortfolioResponse, ContractDetailsResponse } from '../types/api';
import { ActiveTrade, TradeResultEvent, TradeStatusEvent } from '../types/deriv';
import { config } from '../config';
import logger from '../utils/logger';

export class TradingService {
  private derivApi: DerivApiService;
  private webSocketService: WebSocketService | null = null;
  private marketSelectionService: MarketSelectionService;
  private activeTrades = new Map<number, ActiveTrade>();
  private contractSubscriptions = new Set<number>();
  private portfolioSubscribed = false;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private riskManagement: {
    maxStakePerTrade: number;
    maxDailyLoss: number;
    maxConsecutiveLosses: number;
    stopLossEnabled: boolean;
    takeProfitEnabled: boolean;
  };

  constructor(derivApi: DerivApiService, webSocketService?: WebSocketService) {
    this.derivApi = derivApi;
    this.webSocketService = webSocketService || null;
    this.marketSelectionService = new MarketSelectionService(derivApi);
    this.riskManagement = {
      maxStakePerTrade: config.app.maxStake,
      maxDailyLoss: config.app.maxStake * 10, // 10x max stake as daily loss limit
      maxConsecutiveLosses: 5,
      stopLossEnabled: config.app.riskManagementEnabled,
      takeProfitEnabled: config.app.riskManagementEnabled
    };

    this.setupDerivApiEvents();
    this.startTradeMonitoring();
  }

  private setupDerivApiEvents(): void {
    this.derivApi.on('connected', () => {
      logger.info('Trading service: Deriv API connected');
    });

    this.derivApi.on('disconnected', () => {
      logger.warn('Trading service: Deriv API disconnected');
      this.portfolioSubscribed = false;
      this.contractSubscriptions.clear();
    });

    this.derivApi.on('authenticated', async () => {
      logger.info('Trading service: Deriv API authenticated');
      // Subscribe to portfolio updates for real-time trade monitoring
      await this.subscribeToPortfolioUpdates();
    });

    this.derivApi.on('error', (error) => {
      logger.error('Trading service: Deriv API error', error);
    });

    // Listen for portfolio updates
    this.derivApi.on('portfolio', (message) => {
      this.handlePortfolioUpdate(message);
    });

    // Listen for contract updates
    this.derivApi.on('proposal_open_contract', (message) => {
      this.handleContractUpdate(message);
    });
  }

  public async executeTrade(tradeRequest: TradeRequest): Promise<TradeResponse> {
    try {
      logger.info('Executing trade with comprehensive validation', {
        originalRequest: tradeRequest,
        minimumPayout: config.trading.minimumPayout,
        requireIdenticalPayouts: config.trading.requireIdenticalPayouts
      });

      // Step 1: Basic validation and contract type mapping
      const validationResult = this.validateAndMapTradeRequest(tradeRequest);
      if (!validationResult.success) {
        return validationResult;
      }

      const mappedRequest = validationResult.mappedRequest!;

      // Step 2: Risk management checks
      if (!this.validateTrade(mappedRequest.amount)) {
        return {
          success: false,
          error: `Trade rejected by risk management. Maximum stake per trade: $${this.riskManagement.maxStakePerTrade}`,
          message: 'Risk management validation failed',
          validationDetails: {
            stage: 'risk_management',
            maxStakePerTrade: this.riskManagement.maxStakePerTrade,
            requestedAmount: mappedRequest.amount
          }
        };
      }

      // Step 3: Connection check
      if (!this.derivApi.isConnectedAndAuthenticated()) {
        return {
          success: false,
          error: 'Not connected to Deriv API',
          message: 'Connection error',
          validationDetails: {
            stage: 'connection_check'
          }
        };
      }

      // Step 4: Balance check
      const balanceResponse = await this.derivApi.getBalance();
      const balance = balanceResponse?.balance?.balance || 0;
      if (balance < mappedRequest.amount) {
        return {
          success: false,
          error: 'Insufficient balance for this trade',
          message: `Current balance: $${balance}, Required: $${mappedRequest.amount}`,
          validationDetails: {
            stage: 'balance_check',
            currentBalance: balance,
            requiredAmount: mappedRequest.amount
          }
        };
      }

      // Step 5: Market selection and payout validation
      const marketSelection = await this.marketSelectionService.selectOptimalMarket(
        mappedRequest.amount,
        mappedRequest.duration,
        mappedRequest.durationUnit || 't'
      );

      if (!marketSelection.success || !marketSelection.selectedMarket) {
        return {
          success: false,
          error: marketSelection.error || 'No suitable market found',
          message: marketSelection.message,
          validationDetails: {
            stage: 'market_selection',
            availableMarkets: marketSelection.availableMarkets?.length || 0,
            selectionReason: marketSelection.selectionReason,
            minimumPayoutRequired: config.trading.minimumPayout,
            requireIdenticalPayouts: config.trading.requireIdenticalPayouts
          }
        };
      }

      // Step 6: Execute the trade with selected market
      const selectedMarket = marketSelection.selectedMarket;
      const tradeParams = {
        contractType: mappedRequest.contractType,
        symbol: selectedMarket.symbol,
        amount: mappedRequest.amount,
        duration: mappedRequest.duration,
        durationUnit: mappedRequest.durationUnit || 't'
      };

      logger.info('Executing trade with selected market', {
        selectedMarket: selectedMarket.symbol,
        displayName: selectedMarket.displayName,
        risePayoutPercentage: selectedMarket.risePayoutPercentage,
        fallPayoutPercentage: selectedMarket.fallPayoutPercentage,
        selectionReason: marketSelection.selectionReason,
        tradeParams
      });

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
          isMonitoring: true,
          status: 'open',
          balanceAfter: balanceAfter
        });

        // Subscribe to contract updates for real-time monitoring
        await this.subscribeToContractUpdates(contractId);

        logger.info('Trade executed successfully with market validation', {
          contractId,
          buyPrice,
          payout,
          balanceAfter,
          selectedMarket: selectedMarket.symbol,
          marketDisplayName: selectedMarket.displayName,
          payoutPercentages: {
            rise: selectedMarket.risePayoutPercentage,
            fall: selectedMarket.fallPayoutPercentage
          }
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
            startTime,
            // Enhanced market information
            selectedMarket: {
              symbol: selectedMarket.symbol,
              displayName: selectedMarket.displayName,
              risePayoutPercentage: selectedMarket.risePayoutPercentage,
              fallPayoutPercentage: selectedMarket.fallPayoutPercentage,
              averagePayoutPercentage: selectedMarket.averagePayoutPercentage,
              selectionReason: marketSelection.selectionReason
            },
            contractTypeMapping: {
              original: tradeRequest.contractType,
              mapped: mappedRequest.contractType
            }
          },
          message: `Trade executed successfully on ${selectedMarket.displayName} with ${selectedMarket.averagePayoutPercentage.toFixed(2)}% payout`,
          marketSelection: {
            selectedMarket: selectedMarket.symbol,
            selectionReason: marketSelection.selectionReason,
            totalMarketsAnalyzed: marketSelection.availableMarkets?.length || 0,
            payoutDetails: {
              rise: selectedMarket.risePayoutPercentage,
              fall: selectedMarket.fallPayoutPercentage,
              meetsMinimumPayout: selectedMarket.meetsMinimumPayout,
              hasIdenticalPayouts: selectedMarket.hasIdenticalPayouts
            }
          }
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

  private validateAndMapTradeRequest(tradeRequest: TradeRequest): {
    success: boolean;
    error?: string;
    message?: string;
    mappedRequest?: TradeRequest;
    validationDetails?: any;
  } {
    try {
      // Basic field validation
      if (!tradeRequest.symbol || typeof tradeRequest.symbol !== 'string') {
        return {
          success: false,
          error: 'Invalid symbol',
          message: 'Symbol is required and must be a string',
          validationDetails: { stage: 'basic_validation', field: 'symbol' }
        };
      }

      if (!tradeRequest.amount || typeof tradeRequest.amount !== 'number' || tradeRequest.amount <= 0) {
        return {
          success: false,
          error: 'Invalid amount',
          message: 'Amount is required and must be a positive number',
          validationDetails: { stage: 'basic_validation', field: 'amount' }
        };
      }

      if (!tradeRequest.contractType || typeof tradeRequest.contractType !== 'string') {
        return {
          success: false,
          error: 'Invalid contract type',
          message: 'Contract type is required and must be a string',
          validationDetails: { stage: 'basic_validation', field: 'contractType' }
        };
      }

      if (!tradeRequest.duration || typeof tradeRequest.duration !== 'number' || tradeRequest.duration <= 0) {
        return {
          success: false,
          error: 'Invalid duration',
          message: 'Duration is required and must be a positive number',
          validationDetails: { stage: 'basic_validation', field: 'duration' }
        };
      }

      // Contract type mapping and validation
      const originalContractType = tradeRequest.contractType.toUpperCase();
      const mappedContractType = config.trading.contractTypeMapping[originalContractType];

      if (!mappedContractType) {
        return {
          success: false,
          error: `Contract type ${originalContractType} is not supported`,
          message: `Only RISE/FALL (or CALL/PUT) contract types are allowed. Received: ${originalContractType}`,
          validationDetails: {
            stage: 'contract_type_validation',
            originalType: originalContractType,
            supportedTypes: Object.keys(config.trading.contractTypeMapping),
            contractTypeRestriction: 'Only Ups & Downs (RISE/FALL) contracts from Continuous Indices are allowed'
          }
        };
      }

      // Strict contract type enforcement
      if (!['RISE', 'FALL'].includes(mappedContractType)) {
        return {
          success: false,
          error: `Mapped contract type ${mappedContractType} is not allowed`,
          message: 'Only RISE and FALL contract types are permitted',
          validationDetails: {
            stage: 'contract_type_enforcement',
            originalType: originalContractType,
            mappedType: mappedContractType,
            allowedTypes: ['RISE', 'FALL']
          }
        };
      }

      // Market type validation - symbol will be replaced by market selection
      // but we validate the request structure here
      if (tradeRequest.symbol && !tradeRequest.symbol.match(/^(R_|1HZ|BOOM|CRASH|RD)/)) {
        logger.warn('Non-continuous indices symbol provided, will be replaced by market selection', {
          providedSymbol: tradeRequest.symbol
        });
      }

      // Create mapped request
      const mappedRequest: TradeRequest = {
        ...tradeRequest,
        contractType: mappedContractType,
        durationUnit: tradeRequest.durationUnit || 't' // Default to ticks
      };

      logger.info('Trade request validation and mapping successful', {
        original: {
          contractType: originalContractType,
          symbol: tradeRequest.symbol
        },
        mapped: {
          contractType: mappedContractType,
          symbol: mappedRequest.symbol
        },
        validationStage: 'complete'
      });

      return {
        success: true,
        mappedRequest,
        validationDetails: {
          stage: 'validation_complete',
          contractTypeMapping: {
            original: originalContractType,
            mapped: mappedContractType
          }
        }
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown validation error',
        message: 'Trade request validation failed',
        validationDetails: {
          stage: 'validation_error',
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }

  private validateTradeRequest(tradeRequest: TradeRequest): void {
    // Legacy method - kept for backward compatibility
    // New validation is handled by validateAndMapTradeRequest
    const result = this.validateAndMapTradeRequest(tradeRequest);
    if (!result.success) {
      throw new Error(result.error || 'Validation failed');
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

  // Market analysis endpoint
  public async analyzeMarkets(
    amount: number = 10,
    duration: number = 5,
    durationUnit: string = 't'
  ): Promise<{
    success: boolean;
    data?: any;
    error?: string;
    message: string;
  }> {
    try {
      logger.info('Starting market analysis', { amount, duration, durationUnit });

      if (!this.derivApi.isConnectedAndAuthenticated()) {
        return {
          success: false,
          error: 'Not connected to Deriv API',
          message: 'Connection error - cannot analyze markets'
        };
      }

      const marketSelection = await this.marketSelectionService.selectOptimalMarket(
        amount,
        duration,
        durationUnit
      );

      return {
        success: true,
        data: {
          marketAnalysis: {
            totalMarketsAnalyzed: marketSelection.availableMarkets?.length || 0,
            eligibleMarkets: marketSelection.availableMarkets?.filter(m => m.isEligible).length || 0,
            marketsAbove95Percent: marketSelection.availableMarkets?.filter(m => m.meetsMinimumPayout).length || 0,
            selectedMarket: marketSelection.selectedMarket,
            selectionReason: marketSelection.selectionReason,
            selectionSuccess: marketSelection.success
          },
          availableMarkets: marketSelection.availableMarkets?.map(market => ({
            symbol: market.symbol,
            displayName: market.displayName,
            risePayoutPercentage: Number(market.risePayoutPercentage.toFixed(2)),
            fallPayoutPercentage: Number(market.fallPayoutPercentage.toFixed(2)),
            averagePayoutPercentage: Number(market.averagePayoutPercentage.toFixed(2)),
            hasIdenticalPayouts: market.hasIdenticalPayouts,
            meetsMinimumPayout: market.meetsMinimumPayout,
            isEligible: market.isEligible,
            marketType: market.marketType,
            submarket: market.submarket
          })) || [],
          configuration: {
            minimumPayoutRequired: config.trading.minimumPayout,
            requireIdenticalPayouts: config.trading.requireIdenticalPayouts,
            allowedContractTypes: config.trading.allowedContractTypes,
            contractTypeMapping: config.trading.contractTypeMapping
          },
          analysisParameters: {
            amount,
            duration,
            durationUnit,
            timestamp: new Date().toISOString()
          }
        },
        message: marketSelection.success
          ? `Market analysis completed. Selected: ${marketSelection.selectedMarket?.displayName} with ${marketSelection.selectedMarket?.averagePayoutPercentage.toFixed(2)}% payout`
          : `Market analysis completed but no suitable market found: ${marketSelection.message}`
      };

    } catch (error) {
      logger.error('Error in market analysis:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Failed to analyze markets'
      };
    }
  }

  // Clear market cache
  public clearMarketCache(): void {
    this.marketSelectionService.clearCache();
    logger.info('Market cache cleared by request');
  }

  // WebSocket service integration
  public setWebSocketService(webSocketService: WebSocketService): void {
    this.webSocketService = webSocketService;
  }

  // Trade monitoring methods
  private startTradeMonitoring(): void {
    // Monitor trades every 30 seconds
    this.monitoringInterval = setInterval(() => {
      this.monitorActiveTrades();
    }, 30000);

    logger.info('Trade monitoring started');
  }

  private stopTradeMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    logger.info('Trade monitoring stopped');
  }

  private async subscribeToPortfolioUpdates(): Promise<void> {
    try {
      if (!this.portfolioSubscribed) {
        await this.derivApi.subscribeToPortfolio();
        this.portfolioSubscribed = true;
        logger.info('Subscribed to portfolio updates');
      }
    } catch (error) {
      logger.error('Failed to subscribe to portfolio updates:', error);
    }
  }

  private async subscribeToContractUpdates(contractId: number): Promise<void> {
    try {
      if (!this.contractSubscriptions.has(contractId)) {
        await this.derivApi.subscribeToContract(contractId);
        this.contractSubscriptions.add(contractId);
        logger.debug('Subscribed to contract updates', { contractId });
      }
    } catch (error) {
      logger.error('Failed to subscribe to contract updates:', error, { contractId });
    }
  }

  private handlePortfolioUpdate(message: any): void {
    if (message.portfolio && message.portfolio.contracts) {
      message.portfolio.contracts.forEach((contract: any) => {
        this.updateTradeFromPortfolio(contract);
      });
    }
  }

  private handleContractUpdate(message: any): void {
    if (message.proposal_open_contract) {
      this.updateTradeFromContract(message.proposal_open_contract);
    }
  }

  private updateTradeFromPortfolio(contract: any): void {
    const contractId = contract.contract_id;
    const activeTrade = this.activeTrades.get(contractId);

    if (activeTrade) {
      const wasOpen = activeTrade.status === 'open' || !activeTrade.status;

      // Update trade information
      activeTrade.currentSpot = contract.current_spot;
      activeTrade.profit = contract.profit;
      activeTrade.profitPercentage = contract.profit_percentage;
      activeTrade.entrySpot = contract.entry_spot;
      activeTrade.exitSpot = contract.exit_spot;

      // Determine status
      let newStatus: 'open' | 'won' | 'lost' | 'sold' = 'open';
      if (contract.is_sold) {
        newStatus = 'sold';
        activeTrade.sellTime = contract.sell_time * 1000;
      } else if (contract.is_expired) {
        newStatus = contract.profit > 0 ? 'won' : 'lost';
      }

      activeTrade.status = newStatus;

      // If status changed from open to closed, broadcast result
      if (wasOpen && newStatus !== 'open') {
        this.broadcastTradeResult(activeTrade);
        // Remove from active trades after broadcasting result
        setTimeout(() => {
          this.activeTrades.delete(contractId);
        }, 5000); // Keep for 5 seconds for any final updates
      } else if (newStatus === 'open') {
        // Broadcast status update for open trades
        this.broadcastTradeStatus(activeTrade);
      }
    }
  }

  private updateTradeFromContract(contract: any): void {
    const contractId = contract.contract_id;
    const activeTrade = this.activeTrades.get(contractId);

    if (activeTrade) {
      const wasOpen = activeTrade.status === 'open' || !activeTrade.status;

      // Update trade information
      activeTrade.currentSpot = contract.current_spot;
      activeTrade.profit = contract.profit;
      activeTrade.profitPercentage = contract.profit_percentage;
      activeTrade.entrySpot = contract.entry_spot;
      activeTrade.exitSpot = contract.exit_spot;

      // Determine status
      let newStatus: 'open' | 'won' | 'lost' | 'sold' = 'open';
      if (contract.is_sold) {
        newStatus = 'sold';
        activeTrade.sellTime = contract.sell_time * 1000;
      } else if (contract.is_expired) {
        newStatus = contract.profit > 0 ? 'won' : 'lost';
      }

      activeTrade.status = newStatus;

      // If status changed from open to closed, broadcast result
      if (wasOpen && newStatus !== 'open') {
        this.broadcastTradeResult(activeTrade);
        // Remove from active trades after broadcasting result
        setTimeout(() => {
          this.activeTrades.delete(contractId);
        }, 5000); // Keep for 5 seconds for any final updates
      } else if (newStatus === 'open') {
        // Broadcast status update for open trades
        this.broadcastTradeStatus(activeTrade);
      }
    }
  }

  private async monitorActiveTrades(): Promise<void> {
    const now = Date.now();
    const tradesToCheck: ActiveTrade[] = [];

    // Check for expired trades that haven't been updated
    this.activeTrades.forEach((trade) => {
      if (trade.expiryTime <= now && (!trade.status || trade.status === 'open')) {
        tradesToCheck.push(trade);
      }
    });

    // Get updated contract details for potentially expired trades
    for (const trade of tradesToCheck) {
      try {
        const contractDetails = await this.derivApi.getContractDetails(trade.contractId);
        if (contractDetails.proposal_open_contract) {
          this.updateTradeFromContract(contractDetails);
        }
      } catch (error) {
        logger.error('Error checking contract details:', error, { contractId: trade.contractId });
      }
    }
  }

  private broadcastTradeResult(trade: ActiveTrade): void {
    if (!this.webSocketService) return;

    const tradeResult: TradeResultEvent = {
      contractId: trade.contractId,
      symbol: trade.symbol,
      contractType: trade.contractType,
      stake: trade.stake,
      buyPrice: trade.entryPrice,
      payout: trade.payout,
      profit: trade.profit || 0,
      profitPercentage: trade.profitPercentage || 0,
      status: trade.status as 'won' | 'lost' | 'sold',
      entrySpot: trade.entrySpot || 0,
      exitSpot: trade.exitSpot,
      currentSpot: trade.currentSpot || 0,
      purchaseTime: trade.purchaseTime,
      expiryTime: trade.expiryTime,
      sellTime: trade.sellTime,
      longcode: '', // Will be populated from contract details
      shortcode: '', // Will be populated from contract details
      balanceAfter: trade.balanceAfter || 0
    };

    this.webSocketService.broadcastTradeResult(tradeResult);

    logger.info('Trade result broadcasted', {
      contractId: trade.contractId,
      status: trade.status,
      profit: trade.profit
    });
  }

  private broadcastTradeStatus(trade: ActiveTrade): void {
    if (!this.webSocketService) return;

    const tradeStatus: TradeStatusEvent = {
      contractId: trade.contractId,
      status: trade.status as 'open' | 'won' | 'lost' | 'sold',
      currentSpot: trade.currentSpot,
      profit: trade.profit,
      profitPercentage: trade.profitPercentage,
      timestamp: Date.now()
    };

    this.webSocketService.broadcastTradeStatus(tradeStatus);
  }

  // Cleanup method
  public async cleanup(): Promise<void> {
    this.stopTradeMonitoring();

    try {
      if (this.portfolioSubscribed) {
        await this.derivApi.unsubscribeFromPortfolio();
        this.portfolioSubscribed = false;
      }

      // Unsubscribe from all contract subscriptions
      if (this.contractSubscriptions.size > 0) {
        await this.derivApi.unsubscribeFromContract(0); // This will unsubscribe from all
        this.contractSubscriptions.clear();
      }
    } catch (error) {
      logger.error('Error during trading service cleanup:', error);
    }
  }
}
