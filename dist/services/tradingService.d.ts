import { DerivApiService } from './derivApi';
import { TradeRequest, TradeResponse, BalanceResponse, PortfolioResponse, ContractDetailsResponse } from '../types/api';
import { ActiveTrade } from '../types/deriv';
export declare class TradingService {
    private derivApi;
    private activeTrades;
    private riskManagement;
    constructor(derivApi: DerivApiService);
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
}
//# sourceMappingURL=tradingService.d.ts.map