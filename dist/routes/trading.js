"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTradingRoutes = createTradingRoutes;
const express_1 = require("express");
const validation_1 = require("../middleware/validation");
const logger_1 = __importDefault(require("../utils/logger"));
function createTradingRoutes(tradingService) {
    const router = (0, express_1.Router)();
    router.post('/trade', validation_1.validateTradeRequest, async (req, res) => {
        try {
            const tradeRequest = req.body;
            logger_1.default.info('Received trade request', {
                symbol: tradeRequest.symbol,
                amount: tradeRequest.amount,
                contractType: tradeRequest.contractType,
                duration: tradeRequest.duration,
                ip: req.ip
            });
            const result = await tradingService.executeTrade(tradeRequest);
            if (result.success) {
                logger_1.default.info('Trade executed successfully', {
                    contractId: result.data?.contractId,
                    buyPrice: result.data?.buyPrice,
                    payout: result.data?.payout
                });
                res.status(200).json(result);
            }
            else {
                logger_1.default.warn('Trade execution failed', {
                    error: result.error,
                    message: result.message
                });
                res.status(400).json(result);
            }
        }
        catch (error) {
            logger_1.default.error('Error in trade endpoint:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: 'An unexpected error occurred while processing the trade'
            });
        }
    });
    router.get('/balance', async (req, res) => {
        try {
            logger_1.default.debug('Received balance request', { ip: req.ip });
            const result = await tradingService.getBalance();
            if (result.success) {
                logger_1.default.debug('Balance retrieved successfully', {
                    balance: result.data?.balance,
                    currency: result.data?.currency
                });
                res.status(200).json(result);
            }
            else {
                logger_1.default.warn('Failed to get balance', {
                    error: result.error
                });
                res.status(400).json(result);
            }
        }
        catch (error) {
            logger_1.default.error('Error in balance endpoint:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: 'An unexpected error occurred while retrieving balance'
            });
        }
    });
    router.get('/portfolio', async (req, res) => {
        try {
            logger_1.default.debug('Received portfolio request', { ip: req.ip });
            const result = await tradingService.getPortfolio();
            if (result.success) {
                logger_1.default.debug('Portfolio retrieved successfully', {
                    totalContracts: result.data?.totalContracts
                });
                res.status(200).json(result);
            }
            else {
                logger_1.default.warn('Failed to get portfolio', {
                    error: result.error
                });
                res.status(400).json(result);
            }
        }
        catch (error) {
            logger_1.default.error('Error in portfolio endpoint:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: 'An unexpected error occurred while retrieving portfolio'
            });
        }
    });
    router.get('/contract/:contractId', validation_1.validateContractIdParam, async (req, res) => {
        try {
            const contractId = parseInt(req.params.contractId, 10);
            logger_1.default.debug('Received contract details request', {
                contractId,
                ip: req.ip
            });
            const result = await tradingService.getContractDetails(contractId);
            if (result.success) {
                logger_1.default.debug('Contract details retrieved successfully', {
                    contractId: result.data?.contractId,
                    status: result.data?.status
                });
                res.status(200).json(result);
            }
            else {
                logger_1.default.warn('Failed to get contract details', {
                    contractId,
                    error: result.error
                });
                res.status(400).json(result);
            }
        }
        catch (error) {
            logger_1.default.error('Error in contract details endpoint:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: 'An unexpected error occurred while retrieving contract details'
            });
        }
    });
    router.get('/active-trades', async (req, res) => {
        try {
            logger_1.default.debug('Received active trades request', { ip: req.ip });
            const activeTrades = tradingService.getActiveTrades();
            logger_1.default.debug('Active trades retrieved successfully', {
                count: activeTrades.length
            });
            res.status(200).json({
                success: true,
                data: {
                    trades: activeTrades,
                    totalTrades: activeTrades.length
                }
            });
        }
        catch (error) {
            logger_1.default.error('Error in active trades endpoint:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: 'An unexpected error occurred while retrieving active trades'
            });
        }
    });
    return router;
}
//# sourceMappingURL=trading.js.map