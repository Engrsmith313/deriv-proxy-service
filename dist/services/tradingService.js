"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TradingService = void 0;
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
            logger_1.default.info('Executing trade', tradeRequest);
            this.validateTradeRequest(tradeRequest);
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
            const balanceResponse = await this.derivApi.getBalance();
            const balance = balanceResponse?.balance?.balance || 0;
            if (balance < tradeRequest.amount) {
                return {
                    success: false,
                    error: 'Insufficient balance for this trade',
                    message: `Current balance: $${balance}, Required: $${tradeRequest.amount}`
                };
            }
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
                logger_1.default.info('Trade executed successfully', {
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
    validateTradeRequest(tradeRequest) {
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
        if (!config_1.config.trading.allowedContractTypes.includes(tradeRequest.contractType)) {
            throw new Error(`Contract type ${tradeRequest.contractType} is not allowed`);
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