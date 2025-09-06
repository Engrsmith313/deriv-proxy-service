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
    };
    private constructor();
    static getInstance(): Config;
    private validateEnvVars;
    isDevelopment(): boolean;
    isProduction(): boolean;
}
export declare const config: Config;
//# sourceMappingURL=index.d.ts.map