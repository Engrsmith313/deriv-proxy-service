"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateContractIdParam = exports.validateTradeRequest = void 0;
const config_1 = require("../config");
const logger_1 = __importDefault(require("../utils/logger"));
const validateTradeRequest = (req, res, next) => {
    const tradeRequest = req.body;
    const errors = [];
    if (!tradeRequest.symbol || typeof tradeRequest.symbol !== 'string' || tradeRequest.symbol.trim().length === 0) {
        errors.push({ field: 'symbol', message: 'Symbol is required and must be a non-empty string' });
    }
    if (!tradeRequest.amount || typeof tradeRequest.amount !== 'number' || tradeRequest.amount <= 0) {
        errors.push({ field: 'amount', message: 'Amount is required and must be a positive number' });
    }
    else if (tradeRequest.amount > config_1.config.app.maxStake) {
        errors.push({ field: 'amount', message: `Amount cannot exceed maximum stake of ${config_1.config.app.maxStake}` });
    }
    if (!tradeRequest.contractType || typeof tradeRequest.contractType !== 'string') {
        errors.push({ field: 'contractType', message: 'Contract type is required and must be a string' });
    }
    else if (!config_1.config.trading.allowedContractTypes.includes(tradeRequest.contractType)) {
        errors.push({
            field: 'contractType',
            message: `Contract type must be one of: ${config_1.config.trading.allowedContractTypes.join(', ')}`
        });
    }
    if (!tradeRequest.duration || typeof tradeRequest.duration !== 'number' || tradeRequest.duration <= 0) {
        errors.push({ field: 'duration', message: 'Duration is required and must be a positive number' });
    }
    if (tradeRequest.durationUnit && typeof tradeRequest.durationUnit !== 'string') {
        errors.push({ field: 'durationUnit', message: 'Duration unit must be a string' });
    }
    if (tradeRequest.currency && typeof tradeRequest.currency !== 'string') {
        errors.push({ field: 'currency', message: 'Currency must be a string' });
    }
    if (errors.length > 0) {
        logger_1.default.warn('Trade request validation failed', {
            errors,
            request: tradeRequest,
            ip: req.ip
        });
        res.status(400).json({
            success: false,
            error: 'Validation failed',
            message: 'The request contains invalid data',
            validationErrors: errors
        });
        return;
    }
    if (!tradeRequest.durationUnit) {
        tradeRequest.durationUnit = config_1.config.trading.fixedDurationUnit;
    }
    if (!tradeRequest.currency) {
        tradeRequest.currency = 'USD';
    }
    logger_1.default.debug('Trade request validation passed', {
        request: tradeRequest,
        ip: req.ip
    });
    next();
};
exports.validateTradeRequest = validateTradeRequest;
const validateContractIdParam = (req, res, next) => {
    const contractIdParam = req.params.contractId;
    if (!contractIdParam) {
        logger_1.default.warn('Missing contract ID parameter', {
            ip: req.ip
        });
        res.status(400).json({
            success: false,
            error: 'Missing contract ID',
            message: 'Contract ID parameter is required'
        });
        return;
    }
    const contractId = parseInt(contractIdParam, 10);
    if (isNaN(contractId) || contractId <= 0) {
        logger_1.default.warn('Invalid contract ID parameter', {
            contractId: contractIdParam,
            ip: req.ip
        });
        res.status(400).json({
            success: false,
            error: 'Invalid contract ID',
            message: 'Contract ID must be a positive integer'
        });
        return;
    }
    req.params.contractId = contractId.toString();
    next();
};
exports.validateContractIdParam = validateContractIdParam;
//# sourceMappingURL=validation.js.map