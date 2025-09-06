import { Request, Response, NextFunction } from 'express';
import { TradeRequest } from '../types/api';
import { config } from '../config';
import logger from '../utils/logger';

export const validateTradeRequest = (req: Request, res: Response, next: NextFunction): void => {
  const tradeRequest: TradeRequest = req.body;
  const errors: Array<{ field: string; message: string }> = [];

  // Validate symbol
  if (!tradeRequest.symbol || typeof tradeRequest.symbol !== 'string' || tradeRequest.symbol.trim().length === 0) {
    errors.push({ field: 'symbol', message: 'Symbol is required and must be a non-empty string' });
  }

  // Validate amount
  if (!tradeRequest.amount || typeof tradeRequest.amount !== 'number' || tradeRequest.amount <= 0) {
    errors.push({ field: 'amount', message: 'Amount is required and must be a positive number' });
  } else if (tradeRequest.amount > config.app.maxStake) {
    errors.push({ field: 'amount', message: `Amount cannot exceed maximum stake of ${config.app.maxStake}` });
  }

  // Validate contract type
  if (!tradeRequest.contractType || typeof tradeRequest.contractType !== 'string') {
    errors.push({ field: 'contractType', message: 'Contract type is required and must be a string' });
  } else if (!config.trading.allowedContractTypes.includes(tradeRequest.contractType)) {
    errors.push({ 
      field: 'contractType', 
      message: `Contract type must be one of: ${config.trading.allowedContractTypes.join(', ')}` 
    });
  }

  // Validate duration
  if (!tradeRequest.duration || typeof tradeRequest.duration !== 'number' || tradeRequest.duration <= 0) {
    errors.push({ field: 'duration', message: 'Duration is required and must be a positive number' });
  }

  // Validate duration unit (optional, defaults to 's')
  if (tradeRequest.durationUnit && typeof tradeRequest.durationUnit !== 'string') {
    errors.push({ field: 'durationUnit', message: 'Duration unit must be a string' });
  }

  // Validate currency (optional, defaults to 'USD')
  if (tradeRequest.currency && typeof tradeRequest.currency !== 'string') {
    errors.push({ field: 'currency', message: 'Currency must be a string' });
  }

  if (errors.length > 0) {
    logger.warn('Trade request validation failed', {
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

  // Set defaults
  if (!tradeRequest.durationUnit) {
    tradeRequest.durationUnit = config.trading.fixedDurationUnit;
  }
  if (!tradeRequest.currency) {
    tradeRequest.currency = 'USD';
  }

  logger.debug('Trade request validation passed', {
    request: tradeRequest,
    ip: req.ip
  });

  next();
};

export const validateContractIdParam = (req: Request, res: Response, next: NextFunction): void => {
  const contractIdParam = req.params.contractId;

  if (!contractIdParam) {
    logger.warn('Missing contract ID parameter', {
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
    logger.warn('Invalid contract ID parameter', {
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
