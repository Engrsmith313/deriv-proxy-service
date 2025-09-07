import { DerivConfig } from '../types/deriv';
export declare class Config {
    private static instance;
    readonly deriv: DerivConfig;
    readonly server: {
        port: number;
        nodeEnv: string;
        apiKey: string;
    };
    readonly app: {
        logLevel: string;
        defaultStake: number;
        maxStake: number;
        riskManagementEnabled: boolean;
    };
    readonly trading: {
        fixedDuration: number;
        fixedDurationUnit: string;
        allowedContractTypes: string[];
        minimumPayout: number;
        requireIdenticalPayouts: boolean;
        allowedMarketTypes: string[];
        contractTypeMapping: {
            [key: string]: string;
        };
    };
    readonly websocket: {
        enabled: boolean;
        port: number;
        heartbeatInterval: number;
        clientTimeout: number;
        maxClients: number;
        requireAuth: boolean;
    };
    private constructor();
    static getInstance(): Config;
    private validateEnvVars;
    isDevelopment(): boolean;
    isProduction(): boolean;
}
export declare const config: Config;
//# sourceMappingURL=index.d.ts.map