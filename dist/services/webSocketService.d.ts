import { EventEmitter } from 'events';
import { WebSocketServerConfig } from '../types/api';
import { TradeResultEvent, TradeStatusEvent } from '../types/deriv';
export declare class WebSocketService extends EventEmitter {
    private wss;
    private clients;
    private config;
    private heartbeatInterval;
    constructor(serverConfig?: Partial<WebSocketServerConfig>);
    start(server?: any): Promise<void>;
    stop(): Promise<void>;
    private handleConnection;
    private handleMessage;
    private handleAuthentication;
    private handleSubscription;
    private handleUnsubscription;
    private handleDisconnection;
    private handleClientError;
    private handleServerError;
    private handlePong;
    private startHeartbeat;
    broadcastTradeResult(tradeResult: TradeResultEvent): void;
    broadcastTradeStatus(tradeStatus: TradeStatusEvent): void;
    private broadcast;
    private sendMessage;
    private sendError;
    getConnectedClients(): number;
    getAuthenticatedClients(): number;
    getClientInfo(): Array<{
        id: string;
        isAuthenticated: boolean;
        connectedAt: number;
        subscriptions: string[];
    }>;
}
//# sourceMappingURL=webSocketService.d.ts.map