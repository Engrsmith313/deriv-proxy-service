import { DerivApiService } from './derivApi';
import { WebSocketService } from './webSocketService';
import { TradeRequest, TradeResponse, BalanceResponse, PortfolioResponse, ContractDetailsResponse } from '../types/api';
import { ActiveTrade } from '../types/deriv';
export declare class TradingService {
    private derivApi;
    private webSocketService;
    private activeTrades;
    private contractSubscriptions;
    private portfolioSubscribed;
    private monitoringInterval;
    private riskManagement;
    constructor(derivApi: DerivApiService, webSocketService?: WebSocketService);
    private setupDerivApiEvents;
    executeTrade(tradeRequest: TradeRequest): Promise<TradeResponse>;
    getBalance(): Promise<BalanceResponse>;
    getPortfolio(): Promise<PortfolioResponse>;
    getContractDetails(contractId: number): Promise<ContractDetailsResponse>;
    private validateTradeRequest;
    private validateTrade;
    isConnectedAndReady(): boolean;
    getConnectionStatus(): {
        connected: boolean;
        authenticated: boolean;
        lastActivity: Date;
    };
    getActiveTrades(): ActiveTrade[];
    setWebSocketService(webSocketService: WebSocketService): void;
    private startTradeMonitoring;
    private stopTradeMonitoring;
    private subscribeToPortfolioUpdates;
    private subscribeToContractUpdates;
    private handlePortfolioUpdate;
    private handleContractUpdate;
    private updateTradeFromPortfolio;
    private updateTradeFromContract;
    private monitorActiveTrades;
    private broadcastTradeResult;
    private broadcastTradeStatus;
    cleanup(): Promise<void>;
}
//# sourceMappingURL=tradingService.d.ts.map