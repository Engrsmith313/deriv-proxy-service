"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TradingService = void 0;
const config_1 = require("../config");
const logger_1 = __importDefault(require("../utils/logger"));
class TradingService {
    constructor(derivApi) {
        this.activeTrades = new Map();
        this.derivApi = derivApi;
        this.riskManagement = {
            maxStakePerTrade: config_1.config.app.maxStake,
            maxDailyLoss: config_1.config.app.maxStake * 10,
            maxConsecutiveLosses: 5,
            stopLossEnabled: config_1.config.app.riskManagementEnabled,
            takeProfitEnabled: config_1.config.app.riskManagementEnabled
        };
        this.setupDerivApiEvents();
    }
    setupDerivApiEvents() {
        this.derivApi.on('connected', () => {
            logger_1.default.info('Trading service: Deriv API connected');
        });
        this.derivApi.on('disconnected', () => {
            logger_1.default.warn('Trading service: Deriv API disconnected');
        });
        this.derivApi.on('authenticated', () => {
            logger_1.default.info('Trading service: Deriv API authenticated');
        });
        this.derivApi.on('error', (error) => {
            logger_1.default.error('Trading service: Deriv API error', error);
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
                    isMonitoring: true
                });
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
}
exports.TradingService = TradingService;
//# sourceMappingURL=tradingService.js.map