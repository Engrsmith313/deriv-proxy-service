import { EventEmitter } from 'events';
import { DerivConfig, AuthorizeResponse, BalanceResponse, ContractResponse, PortfolioResponse } from '../types/deriv';
export declare class DerivApiService extends EventEmitter {
    private ws;
    private config;
    private isConnected;
    private isAuthenticated;
    private requestId;
    private pendingRequests;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private reconnectDelay;
    private lastActivity;
    constructor(config: DerivConfig);
    connect(): Promise<void>;
    authenticate(): Promise<AuthorizeResponse>;
    getBalance(): Promise<BalanceResponse>;
    getPortfolio(): Promise<PortfolioResponse>;
    getTicks(symbol: string): Promise<any>;
    getContractDetails(contractId: number): Promise<any>;
    subscribeToContract(contractId: number): Promise<any>;
    unsubscribeFromContract(contractId: number): Promise<any>;
    subscribeToPortfolio(): Promise<any>;
    unsubscribeFromPortfolio(): Promise<any>;
    buyContract(params: {
        contractType: string;
        symbol: string;
        amount: number;
        duration: number;
        durationUnit: string;
        basis?: string;
    }): Promise<ContractResponse>;
    private sendRequest;
    private handleMessage;
    private handleReconnection;
    private ensureAuthenticated;
    disconnect(): void;
    isConnectedAndAuthenticated(): boolean;
    getLastActivity(): Date;
    getConnectionStatus(): {
        connected: boolean;
        authenticated: boolean;
        lastActivity: Date;
    };
}
//# sourceMappingURL=derivApi.d.ts.map