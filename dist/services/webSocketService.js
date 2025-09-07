"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketService = void 0;
const events_1 = require("events");
const ws_1 = require("ws");
const uuid_1 = require("uuid");
const logger_1 = __importDefault(require("../utils/logger"));
const config_1 = require("../config");
class WebSocketService extends events_1.EventEmitter {
    constructor(serverConfig) {
        super();
        this.wss = null;
        this.clients = new Map();
        this.heartbeatInterval = null;
        this.config = {
            port: serverConfig?.port || 3001,
            heartbeatInterval: serverConfig?.heartbeatInterval || 30000,
            clientTimeout: serverConfig?.clientTimeout || 60000,
            maxClients: serverConfig?.maxClients || 100,
            requireAuth: serverConfig?.requireAuth !== false,
        };
    }
    async start(server) {
        try {
            if (server) {
                this.wss = new ws_1.WebSocketServer({
                    server,
                    path: '/ws'
                });
                logger_1.default.info('WebSocket server attached to HTTP server on path /ws');
            }
            else {
                this.wss = new ws_1.WebSocketServer({
                    port: this.config.port
                });
                logger_1.default.info(`WebSocket server started on port ${this.config.port}`);
            }
            this.wss.on('connection', this.handleConnection.bind(this));
            this.wss.on('error', this.handleServerError.bind(this));
            this.startHeartbeat();
            logger_1.default.info('WebSocket service initialized successfully', {
                maxClients: this.config.maxClients,
                heartbeatInterval: this.config.heartbeatInterval,
                requireAuth: this.config.requireAuth
            });
        }
        catch (error) {
            logger_1.default.error('Failed to start WebSocket service:', error);
            throw error;
        }
    }
    async stop() {
        try {
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
                this.heartbeatInterval = null;
            }
            this.clients.forEach((client) => {
                if (client.socket.readyState === ws_1.WebSocket.OPEN) {
                    client.socket.close(1000, 'Server shutting down');
                }
            });
            this.clients.clear();
            if (this.wss) {
                this.wss.close();
                this.wss = null;
            }
            logger_1.default.info('WebSocket service stopped successfully');
        }
        catch (error) {
            logger_1.default.error('Error stopping WebSocket service:', error);
            throw error;
        }
    }
    handleConnection(ws, request) {
        const clientId = (0, uuid_1.v4)();
        const now = Date.now();
        if (this.clients.size >= this.config.maxClients) {
            logger_1.default.warn('WebSocket connection rejected: max clients reached', {
                maxClients: this.config.maxClients,
                currentClients: this.clients.size
            });
            ws.close(1013, 'Server overloaded');
            return;
        }
        const client = {
            id: clientId,
            socket: ws,
            isAuthenticated: !this.config.requireAuth,
            connectedAt: now,
            lastActivity: now,
            subscriptions: new Set(['trade_results', 'trade_status'])
        };
        this.clients.set(clientId, client);
        logger_1.default.info('New WebSocket connection', {
            clientId,
            clientIP: request.socket.remoteAddress,
            totalClients: this.clients.size
        });
        ws.on('message', (data) => this.handleMessage(clientId, data));
        ws.on('close', (code, reason) => this.handleDisconnection(clientId, code, reason));
        ws.on('error', (error) => this.handleClientError(clientId, error));
        ws.on('pong', () => this.handlePong(clientId));
        if (this.config.requireAuth) {
            this.sendMessage(clientId, {
                type: 'auth_response',
                timestamp: Date.now(),
                data: {
                    success: false,
                    message: 'Authentication required. Please send auth message with API key.'
                }
            });
        }
        else {
            this.sendMessage(clientId, {
                type: 'auth_response',
                timestamp: Date.now(),
                data: {
                    success: true,
                    message: 'Connected successfully',
                    clientId
                }
            });
        }
    }
    handleMessage(clientId, data) {
        const client = this.clients.get(clientId);
        if (!client)
            return;
        client.lastActivity = Date.now();
        try {
            const message = JSON.parse(data.toString());
            logger_1.default.debug('Received WebSocket message', {
                clientId,
                type: message.type
            });
            switch (message.type) {
                case 'auth':
                    this.handleAuthentication(clientId, message);
                    break;
                case 'subscribe':
                    this.handleSubscription(clientId, message.data.events);
                    break;
                case 'unsubscribe':
                    this.handleUnsubscription(clientId, message.data.events);
                    break;
                default:
                    this.sendError(clientId, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type: ${message.type}`);
            }
        }
        catch (error) {
            logger_1.default.error('Error parsing WebSocket message', { clientId, error });
            this.sendError(clientId, 'INVALID_MESSAGE', 'Invalid JSON message format');
        }
    }
    handleAuthentication(clientId, message) {
        const client = this.clients.get(clientId);
        if (!client)
            return;
        const { apiKey } = message.data;
        const isValidApiKey = apiKey === config_1.config.server.apiKey;
        if (isValidApiKey) {
            client.isAuthenticated = true;
            client.apiKey = apiKey;
            logger_1.default.info('WebSocket client authenticated successfully', { clientId });
            this.sendMessage(clientId, {
                type: 'auth_response',
                timestamp: Date.now(),
                data: {
                    success: true,
                    message: 'Authentication successful',
                    clientId
                }
            });
        }
        else {
            logger_1.default.warn('WebSocket authentication failed', { clientId });
            this.sendMessage(clientId, {
                type: 'auth_response',
                timestamp: Date.now(),
                data: {
                    success: false,
                    message: 'Invalid API key'
                }
            });
            setTimeout(() => {
                if (client.socket.readyState === ws_1.WebSocket.OPEN) {
                    client.socket.close(1008, 'Authentication failed');
                }
            }, 1000);
        }
    }
    handleSubscription(clientId, events) {
        const client = this.clients.get(clientId);
        if (!client || !client.isAuthenticated)
            return;
        events.forEach(event => client.subscriptions.add(event));
        logger_1.default.debug('Client subscribed to events', { clientId, events });
    }
    handleUnsubscription(clientId, events) {
        const client = this.clients.get(clientId);
        if (!client || !client.isAuthenticated)
            return;
        events.forEach(event => client.subscriptions.delete(event));
        logger_1.default.debug('Client unsubscribed from events', { clientId, events });
    }
    handleDisconnection(clientId, code, reason) {
        const client = this.clients.get(clientId);
        if (client) {
            const connectionDuration = Date.now() - client.connectedAt;
            logger_1.default.info('WebSocket client disconnected', {
                clientId,
                code,
                reason: reason.toString(),
                connectionDuration,
                totalClients: this.clients.size - 1
            });
            this.clients.delete(clientId);
        }
    }
    handleClientError(clientId, error) {
        logger_1.default.error('WebSocket client error', { clientId, error });
    }
    handleServerError(error) {
        logger_1.default.error('WebSocket server error', error);
        this.emit('error', error);
    }
    handlePong(clientId) {
        const client = this.clients.get(clientId);
        if (client) {
            client.lastActivity = Date.now();
        }
    }
    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            const now = Date.now();
            this.clients.forEach((client, clientId) => {
                if (now - client.lastActivity > this.config.clientTimeout) {
                    logger_1.default.warn('Closing inactive WebSocket connection', { clientId });
                    client.socket.close(1000, 'Connection timeout');
                    return;
                }
                if (client.socket.readyState === ws_1.WebSocket.OPEN) {
                    client.socket.ping();
                    if (client.isAuthenticated) {
                        this.sendMessage(clientId, {
                            type: 'heartbeat',
                            timestamp: now,
                            data: {
                                serverTime: now
                            }
                        });
                    }
                }
            });
        }, this.config.heartbeatInterval);
    }
    broadcastTradeResult(tradeResult) {
        const message = {
            type: 'trade_result',
            timestamp: Date.now(),
            data: tradeResult
        };
        this.broadcast(message, 'trade_results');
    }
    broadcastTradeStatus(tradeStatus) {
        const message = {
            type: 'trade_status',
            timestamp: Date.now(),
            data: tradeStatus
        };
        this.broadcast(message, 'trade_status');
    }
    broadcast(message, eventType) {
        let sentCount = 0;
        this.clients.forEach((client, clientId) => {
            if (client.isAuthenticated &&
                client.socket.readyState === ws_1.WebSocket.OPEN &&
                (!eventType || client.subscriptions.has(eventType))) {
                this.sendMessage(clientId, message);
                sentCount++;
            }
        });
        logger_1.default.debug('Broadcast message sent', {
            type: message.type,
            eventType,
            sentCount,
            totalClients: this.clients.size
        });
    }
    sendMessage(clientId, message) {
        const client = this.clients.get(clientId);
        if (!client || client.socket.readyState !== ws_1.WebSocket.OPEN)
            return;
        try {
            client.socket.send(JSON.stringify(message));
        }
        catch (error) {
            logger_1.default.error('Error sending WebSocket message', { clientId, error });
        }
    }
    sendError(clientId, code, message, details) {
        this.sendMessage(clientId, {
            type: 'error',
            timestamp: Date.now(),
            data: {
                code,
                message,
                details
            }
        });
    }
    getConnectedClients() {
        return this.clients.size;
    }
    getAuthenticatedClients() {
        return Array.from(this.clients.values()).filter(client => client.isAuthenticated).length;
    }
    getClientInfo() {
        return Array.from(this.clients.entries()).map(([id, client]) => ({
            id,
            isAuthenticated: client.isAuthenticated,
            connectedAt: client.connectedAt,
            subscriptions: Array.from(client.subscriptions)
        }));
    }
}
exports.WebSocketService = WebSocketService;
//# sourceMappingURL=webSocketService.js.map