"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStatusRoutes = createStatusRoutes;
const express_1 = require("express");
const logger_1 = __importDefault(require("../utils/logger"));
function createStatusRoutes(tradingService, webSocketService) {
    const router = (0, express_1.Router)();
    const startTime = Date.now();
    router.get('/health', (req, res) => {
        try {
            const connectionStatus = tradingService.getConnectionStatus();
            const uptime = Date.now() - startTime;
            const healthStatus = {
                success: true,
                data: {
                    connected: connectionStatus.connected,
                    authenticated: connectionStatus.authenticated,
                    lastActivity: connectionStatus.lastActivity.toISOString(),
                    uptime: Math.floor(uptime / 1000)
                }
            };
            logger_1.default.debug('Health check requested', {
                status: healthStatus.data,
                ip: req.ip
            });
            res.status(200).json(healthStatus);
        }
        catch (error) {
            logger_1.default.error('Error in health check endpoint:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: 'An unexpected error occurred during health check'
            });
        }
    });
    router.get('/status', (req, res) => {
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
            logger_1.default.debug('Status check requested', {
                connection: detailedStatus.data.connection,
                trading: detailedStatus.data.trading,
                ip: req.ip
            });
            res.status(200).json(detailedStatus);
        }
        catch (error) {
            logger_1.default.error('Error in status endpoint:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: 'An unexpected error occurred while retrieving status'
            });
        }
    });
    router.get('/websocket', (req, res) => {
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
            logger_1.default.debug('WebSocket status requested', {
                connectedClients: wsStatus.data.connectedClients,
                authenticatedClients: wsStatus.data.authenticatedClients,
                ip: req.ip
            });
            return res.status(200).json(wsStatus);
        }
        catch (error) {
            logger_1.default.error('Error in WebSocket status endpoint:', error);
            return res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: 'An unexpected error occurred while retrieving WebSocket status'
            });
        }
    });
    router.get('/ping', (req, res) => {
        res.status(200).json({
            success: true,
            message: 'pong',
            timestamp: new Date().toISOString()
        });
    });
    return router;
}
//# sourceMappingURL=status.js.map