import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { config } from './config';
import { DerivApiService } from './services/derivApi';
import { TradingService } from './services/tradingService';
import { WebSocketService } from './services/webSocketService';
import { createTradingRoutes } from './routes/trading';
import { createStatusRoutes } from './routes/status';
import { authenticateApiKey } from './middleware/auth';
import logger from './utils/logger';
import fs from 'fs';
import path from 'path';

class DerivProxyServer {
  private app: express.Application;
  private httpServer: any;
  private derivApi: DerivApiService;
  private tradingService: TradingService;
  private webSocketService: WebSocketService;
  private server: any;

  constructor() {
    this.app = express();
    this.httpServer = createServer(this.app);
    this.derivApi = new DerivApiService(config.deriv);
    this.webSocketService = new WebSocketService({
      port: config.websocket.port,
      heartbeatInterval: config.websocket.heartbeatInterval,
      clientTimeout: config.websocket.clientTimeout,
      maxClients: config.websocket.maxClients,
      requireAuth: config.websocket.requireAuth
    });
    this.tradingService = new TradingService(this.derivApi, this.webSocketService);

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
    this.ensureLogsDirectory();
  }

  private ensureLogsDirectory(): void {
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
      logger.info('Created logs directory');
    }
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }));

    // CORS configuration
    this.app.use(cors({
      origin: config.isDevelopment() ? true : process.env.ALLOWED_ORIGINS?.split(',') || false,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
    }));

    // Body parsing middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging middleware
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        contentType: req.get('Content-Type')
      });
      next();
    });
  }

  private setupRoutes(): void {
    // Public routes (no authentication required)
    this.app.use('/api/status', createStatusRoutes(this.tradingService, this.webSocketService));

    // Protected routes (authentication required)
    this.app.use('/api/trading', authenticateApiKey, createTradingRoutes(this.tradingService));

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        success: true,
        message: 'Deriv Proxy Service',
        version: '1.0.0',
        endpoints: {
          status: '/api/status',
          trading: '/api/trading',
          health: '/api/status/health',
          websocket: '/api/status/websocket',
          ping: '/api/status/ping'
        },
        websocket: {
          url: '/ws',
          description: 'WebSocket endpoint for real-time trade updates',
          authentication: 'API key required via auth message'
        },
        documentation: {
          trade: 'POST /api/trading/trade',
          balance: 'GET /api/trading/balance',
          portfolio: 'GET /api/trading/portfolio',
          contract: 'GET /api/trading/contract/:contractId',
          activeTrades: 'GET /api/trading/active-trades',
          websocketStatus: 'GET /api/status/websocket'
        }
      });
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      logger.warn(`404 - Route not found: ${req.method} ${req.originalUrl}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      res.status(404).json({
        success: false,
        error: 'Route not found',
        message: `The requested endpoint ${req.method} ${req.originalUrl} does not exist`
      });
    });
  }

  private setupErrorHandling(): void {
    // Global error handler
    this.app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error('Unhandled error in request:', {
        error: error.message,
        stack: error.stack,
        path: req.path,
        method: req.method,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: config.isDevelopment() ? error.message : 'An unexpected error occurred'
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      this.gracefulShutdown('UNCAUGHT_EXCEPTION');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      this.gracefulShutdown('UNHANDLED_REJECTION');
    });

    // Handle SIGTERM
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received');
      this.gracefulShutdown('SIGTERM');
    });

    // Handle SIGINT
    process.on('SIGINT', () => {
      logger.info('SIGINT received');
      this.gracefulShutdown('SIGINT');
    });
  }

  public async start(): Promise<void> {
    try {
      // Connect to Deriv API
      logger.info('Connecting to Deriv API...');
      await this.derivApi.connect();
      await this.derivApi.authenticate();
      logger.info('Successfully connected and authenticated with Deriv API');

      // Start HTTP server
      this.server = this.httpServer.listen(config.server.port, '0.0.0.0', () => {
        logger.info(`Deriv Proxy Service started on port ${config.server.port}`, {
          environment: config.server.nodeEnv,
          port: config.server.port,
          derivUrl: config.deriv.wsUrl,
          isDemo: config.deriv.isDemo,
          host: '0.0.0.0'
        });
      });

      // Start WebSocket service if enabled
      if (config.websocket.enabled) {
        await this.webSocketService.start(this.httpServer);
        logger.info('WebSocket service started successfully');
      } else {
        logger.info('WebSocket service disabled by configuration');
      }

      // Handle server errors
      this.server.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') {
          logger.error(`Port ${config.server.port} is already in use`);
        } else {
          logger.error('Server error:', error);
        }
        process.exit(1);
      });

    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  private async gracefulShutdown(signal: string): Promise<void> {
    logger.info(`Graceful shutdown initiated by ${signal}`);

    try {
      // Stop WebSocket service
      if (this.webSocketService) {
        await this.webSocketService.stop();
        logger.info('WebSocket service stopped');
      }

      // Cleanup trading service
      if (this.tradingService) {
        await this.tradingService.cleanup();
        logger.info('Trading service cleaned up');
      }

      // Close HTTP server
      if (this.server) {
        this.server.close(() => {
          logger.info('HTTP server closed');
        });
      }

      // Disconnect from Deriv API
      if (this.derivApi) {
        this.derivApi.disconnect();
        logger.info('Deriv API connection closed');
      }

      // Exit process
      setTimeout(() => {
        logger.info('Graceful shutdown completed');
        process.exit(0);
      }, 5000);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  }
}

// Start the server
const server = new DerivProxyServer();
server.start().catch((error) => {
  logger.error('Failed to start Deriv Proxy Service:', error);
  process.exit(1);
});
