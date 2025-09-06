import dotenv from 'dotenv';
import { DerivConfig } from '../types/deriv';

// Load environment variables
dotenv.config();

export class Config {
  private static instance: Config;
  
  public readonly deriv: DerivConfig;
  public readonly server: {
    port: number;
    nodeEnv: string;
    apiKey: string;
  };
  public readonly app: {
    logLevel: string;
    defaultStake: number;
    maxStake: number;
    riskManagementEnabled: boolean;
  };

  public readonly trading: {
    fixedDuration: number;
    fixedDurationUnit: string;
    allowedContractTypes: string[];
  };

  private constructor() {
    // Validate required environment variables
    this.validateEnvVars();

    this.deriv = {
      apiToken: process.env.DERIV_API_TOKEN!,
      appId: process.env.DERIV_APP_ID || '1089',
      wsUrl: process.env.NODE_ENV === 'production' 
        ? process.env.DERIV_WS_URL! 
        : process.env.DERIV_WS_URL_DEMO!,
      isDemo: process.env.NODE_ENV !== 'production'
    };

    this.server = {
      port: parseInt(process.env.PORT || '3000', 10),
      nodeEnv: process.env.NODE_ENV || 'development',
      apiKey: process.env.API_KEY || 'default-dev-key'
    };

    this.app = {
      logLevel: process.env.LOG_LEVEL || 'info',
      defaultStake: parseFloat(process.env.DEFAULT_STAKE || '1'),
      maxStake: parseFloat(process.env.MAX_STAKE || '50000'),
      riskManagementEnabled: process.env.RISK_MANAGEMENT_ENABLED === 'true'
    };

    this.trading = {
      fixedDuration: parseInt(process.env.FIXED_DURATION || '15', 10),
      fixedDurationUnit: process.env.FIXED_DURATION_UNIT || 's',
      allowedContractTypes: (process.env.ALLOWED_CONTRACT_TYPES || 'CALL,PUT').split(',')
    };
  }

  public static getInstance(): Config {
    if (!Config.instance) {
      Config.instance = new Config();
    }
    return Config.instance;
  }

  private validateEnvVars(): void {
    const required = [
      'DERIV_API_TOKEN'
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missing.join(', ')}\n` +
        'Please check your .env file and ensure all required variables are set.'
      );
    }
  }

  public isDevelopment(): boolean {
    return this.server.nodeEnv === 'development';
  }

  public isProduction(): boolean {
    return this.server.nodeEnv === 'production';
  }
}

// Export singleton instance
export const config = Config.getInstance();
