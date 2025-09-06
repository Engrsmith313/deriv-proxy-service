"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const config_1 = require("./config");
const derivApi_1 = require("./services/derivApi");
const tradingService_1 = require("./services/tradingService");
const trading_1 = require("./routes/trading");
const status_1 = require("./routes/status");
const auth_1 = require("./middleware/auth");
const logger_1 = __importDefault(require("./utils/logger"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class DerivProxyServer {
    constructor() {
        this.app = (0, express_1.default)();
        this.derivApi = new derivApi_1.DerivApiService(config_1.config.deriv);
        this.tradingService = new tradingService_1.TradingService(this.derivApi);
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
        this.ensureLogsDirectory();
    }
    ensureLogsDirectory() {
        const logsDir = path_1.default.join(process.cwd(), 'logs');
        if (!fs_1.default.existsSync(logsDir)) {
            fs_1.default.mkdirSync(logsDir, { recursive: true });
            logger_1.default.info('Created logs directory');
        }
    }
    setupMiddleware() {
        this.app.use((0, helmet_1.default)({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrc: ["'self'"],
                    imgSrc: ["'self'", "data:", "https:"],
                },
            },
        }));
        this.app.use((0, cors_1.default)({
            origin: config_1.config.isDevelopment() ? true : process.env.ALLOWED_ORIGINS?.split(',') || false,
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
        }));
        this.app.use(express_1.default.json({ limit: '10mb' }));
        this.app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
        this.app.use((req, res, next) => {
            logger_1.default.info(`${req.method} ${req.path}`, {
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                contentType: req.get('Content-Type')
            });
            next();
        });
    }
    setupRoutes() {
        this.app.use('/api/status', (0, status_1.createStatusRoutes)(this.tradingService));
        this.app.use('/api/trading', auth_1.authenticateApiKey, (0, trading_1.createTradingRoutes)(this.tradingService));
        this.app.get('/', (req, res) => {
            res.json({
                success: true,
                message: 'Deriv Proxy Service',
                version: '1.0.0',
                endpoints: {
                    status: '/api/status',
                    trading: '/api/trading',
                    health: '/api/status/health',
                    ping: '/api/status/ping'
                },
                documentation: {
                    trade: 'POST /api/trading/trade',
                    balance: 'GET /api/trading/balance',
                    portfolio: 'GET /api/trading/portfolio',
                    contract: 'GET /api/trading/contract/:contractId',
                    activeTrades: 'GET /api/trading/active-trades'
                }
            });
        });
        this.app.use('*', (req, res) => {
            logger_1.default.warn(`404 - Route not found: ${req.method} ${req.originalUrl}`, {
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
    setupErrorHandling() {
        this.app.use((error, req, res, next) => {
            logger_1.default.error('Unhandled error in request:', {
                error: error.message,
                stack: error.stack,
                path: req.path,
                method: req.method,
                ip: req.ip
            });
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: config_1.config.isDevelopment() ? error.message : 'An unexpected error occurred'
            });
        });
        process.on('uncaughtException', (error) => {
            logger_1.default.error('Uncaught Exception:', error);
            this.gracefulShutdown('UNCAUGHT_EXCEPTION');
        });
        process.on('unhandledRejection', (reason, promise) => {
            logger_1.default.error('Unhandled Rejection at:', promise, 'reason:', reason);
            this.gracefulShutdown('UNHANDLED_REJECTION');
        });
        process.on('SIGTERM', () => {
            logger_1.default.info('SIGTERM received');
            this.gracefulShutdown('SIGTERM');
        });
        process.on('SIGINT', () => {
            logger_1.default.info('SIGINT received');
            this.gracefulShutdown('SIGINT');
        });
    }
    async start() {
        try {
            logger_1.default.info('Connecting to Deriv API...');
            await this.derivApi.connect();
            await this.derivApi.authenticate();
            logger_1.default.info('Successfully connected and authenticated with Deriv API');
            this.server = this.app.listen(config_1.config.server.port, () => {
                logger_1.default.info(`Deriv Proxy Service started on port ${config_1.config.server.port}`, {
                    environment: config_1.config.server.nodeEnv,
                    port: config_1.config.server.port,
                    derivUrl: config_1.config.deriv.wsUrl,
                    isDemo: config_1.config.deriv.isDemo
                });
            });
            this.server.on('error', (error) => {
                if (error.code === 'EADDRINUSE') {
                    logger_1.default.error(`Port ${config_1.config.server.port} is already in use`);
                }
                else {
                    logger_1.default.error('Server error:', error);
                }
                process.exit(1);
            });
        }
        catch (error) {
            logger_1.default.error('Failed to start server:', error);
            process.exit(1);
        }
    }
    gracefulShutdown(signal) {
        logger_1.default.info(`Graceful shutdown initiated by ${signal}`);
        if (this.server) {
            this.server.close(() => {
                logger_1.default.info('HTTP server closed');
            });
        }
        if (this.derivApi) {
            this.derivApi.disconnect();
            logger_1.default.info('Deriv API connection closed');
        }
        setTimeout(() => {
            logger_1.default.info('Graceful shutdown completed');
            process.exit(0);
        }, 5000);
    }
}
const server = new DerivProxyServer();
server.start().catch((error) => {
    logger_1.default.error('Failed to start Deriv Proxy Service:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map