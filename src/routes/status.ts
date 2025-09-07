import { Router, Request, Response } from 'express';
import { TradingService } from '../services/tradingService';
import { WebSocketService } from '../services/webSocketService';
import { StatusResponse } from '../types/api';
import logger from '../utils/logger';

export function createStatusRoutes(tradingService: TradingService, webSocketService?: WebSocketService): Router {
  const router = Router();
  const startTime = Date.now();

  // Health check endpoint
  router.get('/health', (req: Request, res: Response) => {
    try {
      const connectionStatus = tradingService.getConnectionStatus();
      const uptime = Date.now() - startTime;
      
      const healthStatus: StatusResponse = {
        success: true,
        data: {
          connected: connectionStatus.connected,
          authenticated: connectionStatus.authenticated,
          lastActivity: connectionStatus.lastActivity.toISOString(),
          uptime: Math.floor(uptime / 1000) // Convert to seconds
        }
      };

      logger.debug('Health check requested', {
        status: healthStatus.data,
        ip: req.ip
      });

      res.status(200).json(healthStatus);
    } catch (error) {
      logger.error('Error in health check endpoint:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'An unexpected error occurred during health check'
      });
    }
  });

  // Detailed status endpoint
  router.get('/status', (req: Request, res: Response) => {
    try {
      const connectionStatus = tradingService.getConnectionStatus();
      const uptime = Date.now() - startTime;
      const activeTrades = tradingService.getActiveTrades();
      
      const detailedStatus = {
        success: true,
        data: {
          service: {
            name: 'deriv-proxy-service',
            version: '1.0.0',
            uptime: Math.floor(uptime / 1000),
            startTime: new Date(startTime).toISOString()
          },
          connection: {
            connected: connectionStatus.connected,
            authenticated: connectionStatus.authenticated,
            lastActivity: connectionStatus.lastActivity.toISOString()
          },
          trading: {
            activeTrades: activeTrades.length,
            totalTradesMonitored: activeTrades.length
          },
          websocket: webSocketService ? {
            connectedClients: webSocketService.getConnectedClients(),
            authenticatedClients: webSocketService.getAuthenticatedClients()
          } : {
            enabled: false,
            message: 'WebSocket service not available'
          },
          system: {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            memoryUsage: process.memoryUsage(),
            cpuUsage: process.cpuUsage()
          }
        }
      };

      logger.debug('Status check requested', {
        connection: detailedStatus.data.connection,
        trading: detailedStatus.data.trading,
        ip: req.ip
      });

      res.status(200).json(detailedStatus);
    } catch (error) {
      logger.error('Error in status endpoint:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'An unexpected error occurred while retrieving status'
      });
    }
  });

  // WebSocket status endpoint
  router.get('/websocket', (req: Request, res: Response) => {
    try {
      if (!webSocketService) {
        return res.status(404).json({
          success: false,
          error: 'WebSocket service not available',
          message: 'WebSocket functionality is not enabled'
        });
      }

      const clientInfo = webSocketService.getClientInfo();

      const wsStatus = {
        success: true,
        data: {
          enabled: true,
          connectedClients: webSocketService.getConnectedClients(),
          authenticatedClients: webSocketService.getAuthenticatedClients(),
          clients: clientInfo.map(client => ({
            id: client.id,
            isAuthenticated: client.isAuthenticated,
            connectedAt: new Date(client.connectedAt).toISOString(),
            subscriptions: client.subscriptions
          }))
        }
      };

      logger.debug('WebSocket status requested', {
        connectedClients: wsStatus.data.connectedClients,
        authenticatedClients: wsStatus.data.authenticatedClients,
        ip: req.ip
      });

      return res.status(200).json(wsStatus);
    } catch (error) {
      logger.error('Error in WebSocket status endpoint:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'An unexpected error occurred while retrieving WebSocket status'
      });
    }
  });

  // Simple ping endpoint
  router.get('/ping', (req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      message: 'pong',
      timestamp: new Date().toISOString()
    });
  });

  return router;
}
