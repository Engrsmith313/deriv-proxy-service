import { Router, Request, Response } from 'express';
import { TradingService } from '../services/tradingService';
import { TradeRequest } from '../types/api';
import { validateTradeRequest, validateContractIdParam } from '../middleware/validation';
import logger from '../utils/logger';

export function createTradingRoutes(tradingService: TradingService): Router {
  const router = Router();

  // Execute a trade
  router.post('/trade', validateTradeRequest, async (req: Request, res: Response) => {
    try {
      const tradeRequest: TradeRequest = req.body;
      
      logger.info('Received trade request', {
        symbol: tradeRequest.symbol,
        amount: tradeRequest.amount,
        contractType: tradeRequest.contractType,
        duration: tradeRequest.duration,
        ip: req.ip
      });

      const result = await tradingService.executeTrade(tradeRequest);
      
      if (result.success) {
        logger.info('Trade executed successfully', {
          contractId: result.data?.contractId,
          buyPrice: result.data?.buyPrice,
          payout: result.data?.payout
        });
        res.status(200).json(result);
      } else {
        logger.warn('Trade execution failed', {
          error: result.error,
          message: result.message
        });
        res.status(400).json(result);
      }
    } catch (error) {
      logger.error('Error in trade endpoint:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'An unexpected error occurred while processing the trade'
      });
    }
  });

  // Get account balance
  router.get('/balance', async (req: Request, res: Response) => {
    try {
      logger.debug('Received balance request', { ip: req.ip });

      const result = await tradingService.getBalance();
      
      if (result.success) {
        logger.debug('Balance retrieved successfully', {
          balance: result.data?.balance,
          currency: result.data?.currency
        });
        res.status(200).json(result);
      } else {
        logger.warn('Failed to get balance', {
          error: result.error
        });
        res.status(400).json(result);
      }
    } catch (error) {
      logger.error('Error in balance endpoint:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'An unexpected error occurred while retrieving balance'
      });
    }
  });

  // Get portfolio
  router.get('/portfolio', async (req: Request, res: Response) => {
    try {
      logger.debug('Received portfolio request', { ip: req.ip });

      const result = await tradingService.getPortfolio();
      
      if (result.success) {
        logger.debug('Portfolio retrieved successfully', {
          totalContracts: result.data?.totalContracts
        });
        res.status(200).json(result);
      } else {
        logger.warn('Failed to get portfolio', {
          error: result.error
        });
        res.status(400).json(result);
      }
    } catch (error) {
      logger.error('Error in portfolio endpoint:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'An unexpected error occurred while retrieving portfolio'
      });
    }
  });

  // Get contract details
  router.get('/contract/:contractId', validateContractIdParam, async (req: Request, res: Response) => {
    try {
      const contractId = parseInt(req.params.contractId!, 10);
      
      logger.debug('Received contract details request', {
        contractId,
        ip: req.ip
      });

      const result = await tradingService.getContractDetails(contractId);
      
      if (result.success) {
        logger.debug('Contract details retrieved successfully', {
          contractId: result.data?.contractId,
          status: result.data?.status
        });
        res.status(200).json(result);
      } else {
        logger.warn('Failed to get contract details', {
          contractId,
          error: result.error
        });
        res.status(400).json(result);
      }
    } catch (error) {
      logger.error('Error in contract details endpoint:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'An unexpected error occurred while retrieving contract details'
      });
    }
  });

  // Get active trades
  router.get('/active-trades', async (req: Request, res: Response) => {
    try {
      logger.debug('Received active trades request', { ip: req.ip });

      const activeTrades = tradingService.getActiveTrades();
      
      logger.debug('Active trades retrieved successfully', {
        count: activeTrades.length
      });

      res.status(200).json({
        success: true,
        data: {
          trades: activeTrades,
          totalTrades: activeTrades.length
        }
      });
    } catch (error) {
      logger.error('Error in active trades endpoint:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'An unexpected error occurred while retrieving active trades'
      });
    }
  });

  return router;
}
