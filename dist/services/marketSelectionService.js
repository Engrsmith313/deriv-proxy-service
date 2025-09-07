"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketSelectionService = void 0;
const config_1 = require("../config");
const logger_1 = __importDefault(require("../utils/logger"));
class MarketSelectionService {
    constructor(derivApi) {
        this.marketCache = new Map();
        this.cacheExpiry = new Map();
        this.CACHE_DURATION = 5 * 60 * 1000;
        this.CONTINUOUS_INDICES_SYMBOLS = [
            'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
            '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
            'BOOM300N', 'BOOM500N', 'BOOM1000N',
            'CRASH300N', 'CRASH500N', 'CRASH1000N',
            'RDBEAR', 'RDBULL'
        ];
        this.derivApi = derivApi;
    }
    async selectOptimalMarket(amount, duration, durationUnit = 't') {
        try {
            logger_1.default.info('Starting market selection process', {
                amount,
                duration,
                durationUnit,
                minimumPayout: config_1.config.trading.minimumPayout
            });
            const marketData = await this.getMarketData(amount, duration, durationUnit);
            if (marketData.length === 0) {
                return {
                    success: false,
                    error: 'No markets available',
                    message: 'No Continuous Indices markets are currently available',
                    selectionReason: 'No markets found'
                };
            }
            const selectionResult = this.applyMarketSelectionAlgorithm(marketData);
            logger_1.default.info('Market selection completed', {
                selectedMarket: selectionResult.selectedMarket?.symbol,
                totalMarketsAnalyzed: marketData.length,
                eligibleMarkets: marketData.filter(m => m.isEligible).length,
                selectionReason: selectionResult.selectionReason
            });
            return {
                ...selectionResult,
                availableMarkets: marketData
            };
        }
        catch (error) {
            logger_1.default.error('Error in market selection:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                message: 'Failed to select optimal market',
                selectionReason: 'Selection process failed'
            };
        }
    }
    async getMarketData(amount, duration, durationUnit) {
        const marketData = [];
        for (const symbol of this.CONTINUOUS_INDICES_SYMBOLS) {
            try {
                const cacheKey = `${symbol}_${amount}_${duration}_${durationUnit}`;
                const cachedData = this.getFromCache(cacheKey);
                if (cachedData) {
                    marketData.push(cachedData);
                    continue;
                }
                const [riseProposal, fallProposal] = await Promise.all([
                    this.getProposal({ symbol, contractType: 'RISE', amount, duration, durationUnit }),
                    this.getProposal({ symbol, contractType: 'FALL', amount, duration, durationUnit })
                ]);
                if (riseProposal && fallProposal) {
                    const marketInfo = this.createMarketInfo(symbol, riseProposal, fallProposal);
                    marketData.push(marketInfo);
                    this.setCache(cacheKey, marketInfo);
                }
            }
            catch (error) {
                logger_1.default.warn(`Failed to get market data for ${symbol}:`, error);
            }
        }
        return marketData;
    }
    async getProposal(request) {
        try {
            const proposalRequest = {
                proposal: 1,
                amount: request.amount,
                basis: 'stake',
                contract_type: request.contractType,
                currency: 'USD',
                duration: request.duration,
                duration_unit: request.durationUnit,
                symbol: request.symbol,
                req_id: Date.now() + Math.random()
            };
            const response = await this.derivApi.sendRequest(proposalRequest);
            if (response.error) {
                logger_1.default.debug(`Proposal error for ${request.symbol} ${request.contractType}:`, response.error);
                return null;
            }
            return response.proposal;
        }
        catch (error) {
            logger_1.default.debug(`Failed to get proposal for ${request.symbol} ${request.contractType}:`, error);
            return null;
        }
    }
    createMarketInfo(symbol, riseProposal, fallProposal) {
        const risePayoutPercentage = this.calculatePayoutPercentage(riseProposal);
        const fallPayoutPercentage = this.calculatePayoutPercentage(fallProposal);
        const averagePayoutPercentage = (risePayoutPercentage + fallPayoutPercentage) / 2;
        const hasIdenticalPayouts = Math.abs(risePayoutPercentage - fallPayoutPercentage) < 0.01;
        const meetsMinimumPayout = Math.min(risePayoutPercentage, fallPayoutPercentage) >= config_1.config.trading.minimumPayout;
        const isEligible = hasIdenticalPayouts && (meetsMinimumPayout || !config_1.config.trading.requireIdenticalPayouts);
        return {
            symbol,
            displayName: this.getDisplayName(symbol),
            marketType: 'continuous_indices',
            submarket: this.getSubmarket(symbol),
            risePayoutPercentage,
            fallPayoutPercentage,
            averagePayoutPercentage,
            hasIdenticalPayouts,
            meetsMinimumPayout,
            isEligible
        };
    }
    calculatePayoutPercentage(proposal) {
        if (!proposal || !proposal.payout || !proposal.ask_price) {
            return 0;
        }
        const payout = parseFloat(proposal.payout);
        const askPrice = parseFloat(proposal.ask_price);
        if (askPrice === 0)
            return 0;
        return ((payout / askPrice) - 1) * 100;
    }
    applyMarketSelectionAlgorithm(markets) {
        const eligibleMarkets = markets.filter(m => m.hasIdenticalPayouts);
        if (eligibleMarkets.length === 0) {
            return {
                success: false,
                error: 'No markets with identical RISE/FALL payouts found',
                message: 'All available markets have different payout amounts for RISE and FALL positions',
                selectionReason: 'No markets meet identical payout requirement'
            };
        }
        const premiumMarkets = eligibleMarkets.filter(m => m.meetsMinimumPayout);
        if (premiumMarkets.length > 0) {
            const selectedMarket = premiumMarkets.reduce((best, current) => current.averagePayoutPercentage > best.averagePayoutPercentage ? current : best);
            return {
                success: true,
                selectedMarket,
                message: `Selected ${selectedMarket.displayName} with ${selectedMarket.averagePayoutPercentage.toFixed(2)}% payout`,
                selectionReason: `Priority 1: Highest payout (${selectedMarket.averagePayoutPercentage.toFixed(2)}%) meeting 95% minimum requirement`
            };
        }
        const selectedMarket = eligibleMarkets.reduce((best, current) => current.averagePayoutPercentage > best.averagePayoutPercentage ? current : best);
        return {
            success: true,
            selectedMarket,
            message: `Selected ${selectedMarket.displayName} with ${selectedMarket.averagePayoutPercentage.toFixed(2)}% payout (fallback selection)`,
            selectionReason: `Fallback: Highest available identical payout (${selectedMarket.averagePayoutPercentage.toFixed(2)}%) - below 95% minimum`
        };
    }
    getDisplayName(symbol) {
        const displayNames = {
            'R_10': 'Volatility 10 Index',
            'R_25': 'Volatility 25 Index',
            'R_50': 'Volatility 50 Index',
            'R_75': 'Volatility 75 Index',
            'R_100': 'Volatility 100 Index',
            '1HZ10V': 'Volatility 10 (1s) Index',
            '1HZ25V': 'Volatility 25 (1s) Index',
            '1HZ50V': 'Volatility 50 (1s) Index',
            '1HZ75V': 'Volatility 75 (1s) Index',
            '1HZ100V': 'Volatility 100 (1s) Index',
            'BOOM300N': 'Boom 300 Index',
            'BOOM500N': 'Boom 500 Index',
            'BOOM1000N': 'Boom 1000 Index',
            'CRASH300N': 'Crash 300 Index',
            'CRASH500N': 'Crash 500 Index',
            'CRASH1000N': 'Crash 1000 Index',
            'RDBEAR': 'Bear Market Index',
            'RDBULL': 'Bull Market Index'
        };
        return displayNames[symbol] || symbol;
    }
    getSubmarket(symbol) {
        if (symbol.startsWith('R_') || symbol.includes('HZ'))
            return 'continuous_indices';
        if (symbol.includes('BOOM') || symbol.includes('CRASH'))
            return 'crash_boom';
        if (symbol.includes('BEAR') || symbol.includes('BULL'))
            return 'daily_reset_indices';
        return 'continuous_indices';
    }
    getFromCache(key) {
        const expiry = this.cacheExpiry.get(key);
        if (!expiry || Date.now() > expiry) {
            this.marketCache.delete(key);
            this.cacheExpiry.delete(key);
            return null;
        }
        return this.marketCache.get(key) || null;
    }
    setCache(key, data) {
        this.marketCache.set(key, data);
        this.cacheExpiry.set(key, Date.now() + this.CACHE_DURATION);
    }
    clearCache() {
        this.marketCache.clear();
        this.cacheExpiry.clear();
        logger_1.default.info('Market selection cache cleared');
    }
}
exports.MarketSelectionService = MarketSelectionService;
//# sourceMappingURL=marketSelectionService.js.map