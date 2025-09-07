"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TradingService = void 0;
const marketSelectionService_1 = require("./marketSelectionService");
const config_1 = require("../config");
const logger_1 = __importDefault(require("../utils/logger"));
class TradingService {
    constructor(derivApi, webSocketService) {
        this.webSocketService = null;
        this.activeTrades = new Map();
        this.contractSubscriptions = new Set();
        this.portfolioSubscribed = false;
        this.monitoringInterval = null;
        this.derivApi = derivApi;
        this.webSocketService = webSocketService || null;
        this.marketSelectionService = new marketSelectionService_1.MarketSelectionService(derivApi);
        this.riskManagement = {
            maxStakePerTrade: config_1.config.app.maxStake,
            maxDailyLoss: config_1.config.app.maxStake * 10,
            maxConsecutiveLosses: 5,
            stopLossEnabled: config_1.config.app.riskManagementEnabled,
            takeProfitEnabled: config_1.config.app.riskManagementEnabled
        };
        this.setupDerivApiEvents();
        this.startTradeMonitoring();
    }
    setupDerivApiEvents() {
        this.derivApi.on('connected', () => {
            logger_1.default.info('Trading service: Deriv API connected');
        });
        this.derivApi.on('disconnected', () => {
            logger_1.default.warn('Trading service: Deriv API disconnected');
            this.portfolioSubscribed = false;
            this.contractSubscriptions.clear();
        });
        this.derivApi.on('authenticated', async () => {
            logger_1.default.info('Trading service: Deriv API authenticated');
            await this.subscribeToPortfolioUpdates();
        });
        this.derivApi.on('error', (error) => {
            logger_1.default.error('Trading service: Deriv API error', error);
        });
        this.derivApi.on('portfolio', (message) => {
            this.handlePortfolioUpdate(message);
        });
        this.derivApi.on('proposal_open_contract', (message) => {
            this.handleContractUpdate(message);
        });
    }
    async executeTrade(tradeRequest) {
        try {
            logger_1.default.info('Executing trade with comprehensive validation', {
                originalRequest: tradeRequest,
                minimumPayout: config_1.config.trading.minimumPayout,
                requireIdenticalPayouts: config_1.config.trading.requireIdenticalPayouts
            });
            const validationResult = this.validateAndMapTradeRequest(tradeRequest);
            if (!validationResult.success) {
                return validationResult;
            }
            const mappedRequest = validationResult.mappedRequest;
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
            const marketSelection = await this.marketSelectionService.selectOptimalMarket(mappedRequest.amount, mappedRequest.duration, mappedRequest.durationUnit || 't');
            if (!marketSelection.success || !marketSelection.selectedMarket) {
                return {
                    success: false,
                    error: marketSelection.error || 'No suitable market found',
                    message: marketSelection.message,
                    validationDetails: {
                        stage: 'market_selection',
                        availableMarkets: marketSelection.availableMarkets?.length || 0,
                        selectionReason: marketSelection.selectionReason,
                        minimumPayoutRequired: config_1.config.trading.minimumPayout,
                        requireIdenticalPayouts: config_1.config.trading.requireIdenticalPayouts
                    }
                };
            }
            const selectedMarket = marketSelection.selectedMarket;
            const tradeParams = {
                contractType: mappedRequest.contractType,
                symbol: selectedMarket.symbol,
                amount: mappedRequest.amount,
                duration: mappedRequest.duration,
                durationUnit: mappedRequest.durationUnit || 't'
            };
            logger_1.default.info('Executing trade with selected market', {
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
                this.activeTrades.set(contractId, {
                    contractId: contractId,
                    symbol: tradeRequest.symbol,
                    contractType: tradeRequest.contractType,
                    stake: tradeRequest.amount,
                    entryPrice: buyPrice,
                    purchaseTime: purchaseTime * 1000,
                    expiryTime: purchaseTime * 1000 + (tradeRequest.duration * 1000),
                    payout: payout,
                    isMonitoring: true,
                    status: 'open',
                    balanceAfter: balanceAfter
                });
                await this.subscribeToContractUpdates(contractId);
                logger_1.default.info('Trade executed successfully with market validation', {
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
            }
            else {
                return {
                    success: false,
                    error: result.error?.message || 'Trade execution failed',
                    message: 'Failed to execute trade'
                };
            }
        }
        catch (error) {
            logger_1.default.error('Error executing trade:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred',
                message: 'Trade execution error'
            };
        }
    }
    async getBalance() {
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
            }
            else {
                return {
                    success: false,
                    error: response.error?.message || 'Failed to get balance'
                };
            }
        }
        catch (error) {
            logger_1.default.error('Error getting balance:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    }
    async getPortfolio() {
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
            }
            else {
                return {
                    success: false,
                    error: response.error?.message || 'Failed to get portfolio'
                };
            }
        }
        catch (error) {
            logger_1.default.error('Error getting portfolio:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    }
    async getContractDetails(contractId) {
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
            }
            else {
                return {
                    success: false,
                    error: response.error?.message || 'Failed to get contract details'
                };
            }
        }
        catch (error) {
            logger_1.default.error('Error getting contract details:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    }
    validateAndMapTradeRequest(tradeRequest) {
        try {
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
            const originalContractType = tradeRequest.contractType.toUpperCase();
            const mappedContractType = config_1.config.trading.contractTypeMapping[originalContractType];
            if (!mappedContractType) {
                return {
                    success: false,
                    error: `Contract type ${originalContractType} is not supported`,
                    message: `Only RISE/FALL (or CALL/PUT) contract types are allowed. Received: ${originalContractType}`,
                    validationDetails: {
                        stage: 'contract_type_validation',
                        originalType: originalContractType,
                        supportedTypes: Object.keys(config_1.config.trading.contractTypeMapping),
                        contractTypeRestriction: 'Only Ups & Downs (RISE/FALL) contracts from Continuous Indices are allowed'
                    }
                };
            }
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
            if (tradeRequest.symbol && !tradeRequest.symbol.match(/^(R_|1HZ|BOOM|CRASH|RD)/)) {
                logger_1.default.warn('Non-continuous indices symbol provided, will be replaced by market selection', {
                    providedSymbol: tradeRequest.symbol
                });
            }
            const mappedRequest = {
                ...tradeRequest,
                contractType: mappedContractType,
                durationUnit: tradeRequest.durationUnit || 't'
            };
            logger_1.default.info('Trade request validation and mapping successful', {
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
        }
        catch (error) {
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
    validateTradeRequest(tradeRequest) {
        const result = this.validateAndMapTradeRequest(tradeRequest);
        if (!result.success) {
            throw new Error(result.error || 'Validation failed');
        }
    }
    validateTrade(amount) {
        if (!this.riskManagement.stopLossEnabled) {
            return true;
        }
        if (amount > this.riskManagement.maxStakePerTrade) {
            return false;
        }
        return true;
    }
    isConnectedAndReady() {
        return this.derivApi.isConnectedAndAuthenticated();
    }
    getConnectionStatus() {
        return this.derivApi.getConnectionStatus();
    }
    getActiveTrades() {
        return Array.from(this.activeTrades.values());
    }
    async analyzeMarkets(amount = 10, duration = 5, durationUnit = 't') {
        try {
            logger_1.default.info('Starting market analysis', { amount, duration, durationUnit });
            if (!this.derivApi.isConnectedAndAuthenticated()) {
                return {
                    success: false,
                    error: 'Not connected to Deriv API',
                    message: 'Connection error - cannot analyze markets'
                };
            }
            const marketSelection = await this.marketSelectionService.selectOptimalMarket(amount, duration, durationUnit);
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
                        minimumPayoutRequired: config_1.config.trading.minimumPayout,
                        requireIdenticalPayouts: config_1.config.trading.requireIdenticalPayouts,
                        allowedContractTypes: config_1.config.trading.allowedContractTypes,
                        contractTypeMapping: config_1.config.trading.contractTypeMapping
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
        }
        catch (error) {
            logger_1.default.error('Error in market analysis:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                message: 'Failed to analyze markets'
            };
        }
    }
    clearMarketCache() {
        this.marketSelectionService.clearCache();
        logger_1.default.info('Market cache cleared by request');
    }
    setWebSocketService(webSocketService) {
        this.webSocketService = webSocketService;
    }
    startTradeMonitoring() {
        this.monitoringInterval = setInterval(() => {
            this.monitorActiveTrades();
        }, 30000);
        logger_1.default.info('Trade monitoring started');
    }
    stopTradeMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        logger_1.default.info('Trade monitoring stopped');
    }
    async subscribeToPortfolioUpdates() {
        try {
            if (!this.portfolioSubscribed) {
                await this.derivApi.subscribeToPortfolio();
                this.portfolioSubscribed = true;
                logger_1.default.info('Subscribed to portfolio updates');
            }
        }
        catch (error) {
            logger_1.default.error('Failed to subscribe to portfolio updates:', error);
        }
    }
    async subscribeToContractUpdates(contractId) {
        try {
            if (!this.contractSubscriptions.has(contractId)) {
                await this.derivApi.subscribeToContract(contractId);
                this.contractSubscriptions.add(contractId);
                logger_1.default.debug('Subscribed to contract updates', { contractId });
            }
        }
        catch (error) {
            logger_1.default.error('Failed to subscribe to contract updates:', error, { contractId });
        }
    }
    handlePortfolioUpdate(message) {
        if (message.portfolio && message.portfolio.contracts) {
            message.portfolio.contracts.forEach((contract) => {
                this.updateTradeFromPortfolio(contract);
            });
        }
    }
    handleContractUpdate(message) {
        if (message.proposal_open_contract) {
            this.updateTradeFromContract(message.proposal_open_contract);
        }
    }
    updateTradeFromPortfolio(contract) {
        const contractId = contract.contract_id;
        const activeTrade = this.activeTrades.get(contractId);
        if (activeTrade) {
            const wasOpen = activeTrade.status === 'open' || !activeTrade.status;
            activeTrade.currentSpot = contract.current_spot;
            activeTrade.profit = contract.profit;
            activeTrade.profitPercentage = contract.profit_percentage;
            activeTrade.entrySpot = contract.entry_spot;
            activeTrade.exitSpot = contract.exit_spot;
            let newStatus = 'open';
            if (contract.is_sold) {
                newStatus = 'sold';
                activeTrade.sellTime = contract.sell_time * 1000;
            }
            else if (contract.is_expired) {
                newStatus = contract.profit > 0 ? 'won' : 'lost';
            }
            activeTrade.status = newStatus;
            if (wasOpen && newStatus !== 'open') {
                this.broadcastTradeResult(activeTrade);
                setTimeout(() => {
                    this.activeTrades.delete(contractId);
                }, 5000);
            }
            else if (newStatus === 'open') {
                this.broadcastTradeStatus(activeTrade);
            }
        }
    }
    updateTradeFromContract(contract) {
        const contractId = contract.contract_id;
        const activeTrade = this.activeTrades.get(contractId);
        if (activeTrade) {
            const wasOpen = activeTrade.status === 'open' || !activeTrade.status;
            activeTrade.currentSpot = contract.current_spot;
            activeTrade.profit = contract.profit;
            activeTrade.profitPercentage = contract.profit_percentage;
            activeTrade.entrySpot = contract.entry_spot;
            activeTrade.exitSpot = contract.exit_spot;
            let newStatus = 'open';
            if (contract.is_sold) {
                newStatus = 'sold';
                activeTrade.sellTime = contract.sell_time * 1000;
            }
            else if (contract.is_expired) {
                newStatus = contract.profit > 0 ? 'won' : 'lost';
            }
            activeTrade.status = newStatus;
            if (wasOpen && newStatus !== 'open') {
                this.broadcastTradeResult(activeTrade);
                setTimeout(() => {
                    this.activeTrades.delete(contractId);
                }, 5000);
            }
            else if (newStatus === 'open') {
                this.broadcastTradeStatus(activeTrade);
            }
        }
    }
    async monitorActiveTrades() {
        const now = Date.now();
        const tradesToCheck = [];
        this.activeTrades.forEach((trade) => {
            if (trade.expiryTime <= now && (!trade.status || trade.status === 'open')) {
                tradesToCheck.push(trade);
            }
        });
        for (const trade of tradesToCheck) {
            try {
                const contractDetails = await this.derivApi.getContractDetails(trade.contractId);
                if (contractDetails.proposal_open_contract) {
                    this.updateTradeFromContract(contractDetails);
                }
            }
            catch (error) {
                logger_1.default.error('Error checking contract details:', error, { contractId: trade.contractId });
            }
        }
    }
    broadcastTradeResult(trade) {
        if (!this.webSocketService)
            return;
        const tradeResult = {
            contractId: trade.contractId,
            symbol: trade.symbol,
            contractType: trade.contractType,
            stake: trade.stake,
            buyPrice: trade.entryPrice,
            payout: trade.payout,
            profit: trade.profit || 0,
            profitPercentage: trade.profitPercentage || 0,
            status: trade.status,
            entrySpot: trade.entrySpot || 0,
            exitSpot: trade.exitSpot,
            currentSpot: trade.currentSpot || 0,
            purchaseTime: trade.purchaseTime,
            expiryTime: trade.expiryTime,
            sellTime: trade.sellTime,
            longcode: '',
            shortcode: '',
            balanceAfter: trade.balanceAfter || 0
        };
        this.webSocketService.broadcastTradeResult(tradeResult);
        logger_1.default.info('Trade result broadcasted', {
            contractId: trade.contractId,
            status: trade.status,
            profit: trade.profit
        });
    }
    broadcastTradeStatus(trade) {
        if (!this.webSocketService)
            return;
        const tradeStatus = {
            contractId: trade.contractId,
            status: trade.status,
            currentSpot: trade.currentSpot,
            profit: trade.profit,
            profitPercentage: trade.profitPercentage,
            timestamp: Date.now()
        };
        this.webSocketService.broadcastTradeStatus(tradeStatus);
    }
    async cleanup() {
        this.stopTradeMonitoring();
        try {
            if (this.portfolioSubscribed) {
                await this.derivApi.unsubscribeFromPortfolio();
                this.portfolioSubscribed = false;
            }
            if (this.contractSubscriptions.size > 0) {
                await this.derivApi.unsubscribeFromContract(0);
                this.contractSubscriptions.clear();
            }
        }
        catch (error) {
            logger_1.default.error('Error during trading service cleanup:', error);
        }
    }
}
exports.TradingService = TradingService;
//# sourceMappingURL=tradingService.js.map