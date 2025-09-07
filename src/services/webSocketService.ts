import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { config } from '../config';
import {
  WebSocketClient,
  WebSocketServerConfig,
  WebSocketIncomingMessage,
  WebSocketOutgoingMessage,
  WebSocketAuthMessage,
  WebSocketAuthResponse,
  WebSocketTradeResultMessage,
  WebSocketTradeStatusMessage,
  WebSocketErrorMessage,
  WebSocketHeartbeatMessage
} from '../types/api';
import { TradeResultEvent, TradeStatusEvent } from '../types/deriv';

export class WebSocketService extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, WebSocketClient>();
  private config: WebSocketServerConfig;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(serverConfig?: Partial<WebSocketServerConfig>) {
    super();
    
    this.config = {
      port: serverConfig?.port || 3001,
      heartbeatInterval: serverConfig?.heartbeatInterval || 30000, // 30 seconds
      clientTimeout: serverConfig?.clientTimeout || 60000, // 60 seconds
      maxClients: serverConfig?.maxClients || 100,
      requireAuth: serverConfig?.requireAuth !== false, // Default to true
    };
  }

  public async start(server?: any): Promise<void> {
    try {
      // Create WebSocket server
      if (server) {
        // Attach to existing HTTP server
        this.wss = new WebSocketServer({ 
          server,
          path: '/ws'
        });
        logger.info('WebSocket server attached to HTTP server on path /ws');
      } else {
        // Create standalone WebSocket server
        this.wss = new WebSocketServer({ 
          port: this.config.port 
        });
        logger.info(`WebSocket server started on port ${this.config.port}`);
      }

      this.wss.on('connection', this.handleConnection.bind(this));
      this.wss.on('error', this.handleServerError.bind(this));

      // Start heartbeat interval
      this.startHeartbeat();

      logger.info('WebSocket service initialized successfully', {
        maxClients: this.config.maxClients,
        heartbeatInterval: this.config.heartbeatInterval,
        requireAuth: this.config.requireAuth
      });

    } catch (error) {
      logger.error('Failed to start WebSocket service:', error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    try {
      // Stop heartbeat
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }

      // Close all client connections
      this.clients.forEach((client) => {
        if (client.socket.readyState === WebSocket.OPEN) {
          client.socket.close(1000, 'Server shutting down');
        }
      });
      this.clients.clear();

      // Close WebSocket server
      if (this.wss) {
        this.wss.close();
        this.wss = null;
      }

      logger.info('WebSocket service stopped successfully');
    } catch (error) {
      logger.error('Error stopping WebSocket service:', error);
      throw error;
    }
  }

  private handleConnection(ws: WebSocket, request: IncomingMessage): void {
    const clientId = uuidv4();
    const now = Date.now();

    // Check client limit
    if (this.clients.size >= this.config.maxClients) {
      logger.warn('WebSocket connection rejected: max clients reached', {
        maxClients: this.config.maxClients,
        currentClients: this.clients.size
      });
      ws.close(1013, 'Server overloaded');
      return;
    }

    // Create client object
    const client: WebSocketClient = {
      id: clientId,
      socket: ws,
      isAuthenticated: !this.config.requireAuth, // If auth not required, auto-authenticate
      connectedAt: now,
      lastActivity: now,
      subscriptions: new Set(['trade_results', 'trade_status']) // Default subscriptions
    };

    this.clients.set(clientId, client);

    logger.info('New WebSocket connection', {
      clientId,
      clientIP: request.socket.remoteAddress,
      totalClients: this.clients.size
    });

    // Set up event handlers
    ws.on('message', (data) => this.handleMessage(clientId, data));
    ws.on('close', (code, reason) => this.handleDisconnection(clientId, code, reason));
    ws.on('error', (error) => this.handleClientError(clientId, error));
    ws.on('pong', () => this.handlePong(clientId));

    // Send authentication requirement if needed
    if (this.config.requireAuth) {
      this.sendMessage(clientId, {
        type: 'auth_response',
        timestamp: Date.now(),
        data: {
          success: false,
          message: 'Authentication required. Please send auth message with API key.'
        }
      });
    } else {
      // Send welcome message
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

  private handleMessage(clientId: string, data: any): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.lastActivity = Date.now();

    try {
      const message: WebSocketIncomingMessage = JSON.parse(data.toString());
      
      logger.debug('Received WebSocket message', {
        clientId,
        type: message.type
      });

      switch (message.type) {
        case 'auth':
          this.handleAuthentication(clientId, message as WebSocketAuthMessage);
          break;
        case 'subscribe':
          this.handleSubscription(clientId, message.data.events);
          break;
        case 'unsubscribe':
          this.handleUnsubscription(clientId, message.data.events);
          break;
        default:
          this.sendError(clientId, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type: ${(message as any).type}`);
      }
    } catch (error) {
      logger.error('Error parsing WebSocket message', { clientId, error });
      this.sendError(clientId, 'INVALID_MESSAGE', 'Invalid JSON message format');
    }
  }

  private handleAuthentication(clientId: string, message: WebSocketAuthMessage): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { apiKey } = message.data;

    // Validate API key (using the same validation as HTTP endpoints)
    const isValidApiKey = apiKey === config.server.apiKey;

    if (isValidApiKey) {
      client.isAuthenticated = true;
      client.apiKey = apiKey;
      
      logger.info('WebSocket client authenticated successfully', { clientId });
      
      this.sendMessage(clientId, {
        type: 'auth_response',
        timestamp: Date.now(),
        data: {
          success: true,
          message: 'Authentication successful',
          clientId
        }
      });
    } else {
      logger.warn('WebSocket authentication failed', { clientId });
      
      this.sendMessage(clientId, {
        type: 'auth_response',
        timestamp: Date.now(),
        data: {
          success: false,
          message: 'Invalid API key'
        }
      });

      // Close connection after failed authentication
      setTimeout(() => {
        if (client.socket.readyState === WebSocket.OPEN) {
          client.socket.close(1008, 'Authentication failed');
        }
      }, 1000);
    }
  }

  private handleSubscription(clientId: string, events: string[]): void {
    const client = this.clients.get(clientId);
    if (!client || !client.isAuthenticated) return;

    events.forEach(event => client.subscriptions.add(event));
    
    logger.debug('Client subscribed to events', { clientId, events });
  }

  private handleUnsubscription(clientId: string, events: string[]): void {
    const client = this.clients.get(clientId);
    if (!client || !client.isAuthenticated) return;

    events.forEach(event => client.subscriptions.delete(event));
    
    logger.debug('Client unsubscribed from events', { clientId, events });
  }

  private handleDisconnection(clientId: string, code: number, reason: Buffer): void {
    const client = this.clients.get(clientId);
    if (client) {
      const connectionDuration = Date.now() - client.connectedAt;
      logger.info('WebSocket client disconnected', {
        clientId,
        code,
        reason: reason.toString(),
        connectionDuration,
        totalClients: this.clients.size - 1
      });
      
      this.clients.delete(clientId);
    }
  }

  private handleClientError(clientId: string, error: Error): void {
    logger.error('WebSocket client error', { clientId, error });
  }

  private handleServerError(error: Error): void {
    logger.error('WebSocket server error', error);
    this.emit('error', error);
  }

  private handlePong(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.lastActivity = Date.now();
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      
      this.clients.forEach((client, clientId) => {
        // Check for inactive clients
        if (now - client.lastActivity > this.config.clientTimeout) {
          logger.warn('Closing inactive WebSocket connection', { clientId });
          client.socket.close(1000, 'Connection timeout');
          return;
        }

        // Send heartbeat
        if (client.socket.readyState === WebSocket.OPEN) {
          client.socket.ping();
          
          // Also send heartbeat message to authenticated clients
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

  // Public methods for broadcasting messages
  public broadcastTradeResult(tradeResult: TradeResultEvent): void {
    const message: WebSocketTradeResultMessage = {
      type: 'trade_result',
      timestamp: Date.now(),
      data: tradeResult
    };

    this.broadcast(message, 'trade_results');
  }

  public broadcastTradeStatus(tradeStatus: TradeStatusEvent): void {
    const message: WebSocketTradeStatusMessage = {
      type: 'trade_status',
      timestamp: Date.now(),
      data: tradeStatus
    };

    this.broadcast(message, 'trade_status');
  }

  private broadcast(message: WebSocketOutgoingMessage, eventType?: string): void {
    let sentCount = 0;
    
    this.clients.forEach((client, clientId) => {
      if (client.isAuthenticated && 
          client.socket.readyState === WebSocket.OPEN &&
          (!eventType || client.subscriptions.has(eventType))) {
        
        this.sendMessage(clientId, message);
        sentCount++;
      }
    });

    logger.debug('Broadcast message sent', {
      type: message.type,
      eventType,
      sentCount,
      totalClients: this.clients.size
    });
  }

  private sendMessage(clientId: string, message: WebSocketOutgoingMessage): void {
    const client = this.clients.get(clientId);
    if (!client || client.socket.readyState !== WebSocket.OPEN) return;

    try {
      client.socket.send(JSON.stringify(message));
    } catch (error) {
      logger.error('Error sending WebSocket message', { clientId, error });
    }
  }

  private sendError(clientId: string, code: string, message: string, details?: any): void {
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

  // Getters for monitoring
  public getConnectedClients(): number {
    return this.clients.size;
  }

  public getAuthenticatedClients(): number {
    return Array.from(this.clients.values()).filter(client => client.isAuthenticated).length;
  }

  public getClientInfo(): Array<{id: string, isAuthenticated: boolean, connectedAt: number, subscriptions: string[]}> {
    return Array.from(this.clients.entries()).map(([id, client]) => ({
      id,
      isAuthenticated: client.isAuthenticated,
      connectedAt: client.connectedAt,
      subscriptions: Array.from(client.subscriptions)
    }));
  }
}
