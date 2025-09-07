"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = exports.Config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
class Config {
    constructor() {
        this.validateEnvVars();
        this.deriv = {
            apiToken: process.env.DERIV_API_TOKEN,
            appId: process.env.DERIV_APP_ID || '1089',
            wsUrl: process.env.NODE_ENV === 'production'
                ? process.env.DERIV_WS_URL
                : process.env.DERIV_WS_URL_DEMO,
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
            allowedContractTypes: (process.env.ALLOWED_CONTRACT_TYPES || 'RISE,FALL').split(','),
            minimumPayout: parseFloat(process.env.MINIMUM_PAYOUT || '95'),
            requireIdenticalPayouts: process.env.REQUIRE_IDENTICAL_PAYOUTS !== 'false',
            allowedMarketTypes: (process.env.ALLOWED_MARKET_TYPES || 'continuous_indices').split(','),
            contractTypeMapping: {
                'CALL': 'RISE',
                'PUT': 'FALL',
                'RISE': 'RISE',
                'FALL': 'FALL'
            }
        };
        this.websocket = {
            enabled: process.env.WEBSOCKET_ENABLED !== 'false',
            port: parseInt(process.env.WEBSOCKET_PORT || '3001', 10),
            heartbeatInterval: parseInt(process.env.WEBSOCKET_HEARTBEAT_INTERVAL || '30000', 10),
            clientTimeout: parseInt(process.env.WEBSOCKET_CLIENT_TIMEOUT || '60000', 10),
            maxClients: parseInt(process.env.WEBSOCKET_MAX_CLIENTS || '100', 10),
            requireAuth: process.env.WEBSOCKET_REQUIRE_AUTH !== 'false'
        };
    }
    static getInstance() {
        if (!Config.instance) {
            Config.instance = new Config();
        }
        return Config.instance;
    }
    validateEnvVars() {
        const required = [
            'DERIV_API_TOKEN'
        ];
        const missing = required.filter(key => !process.env[key]);
        if (missing.length > 0) {
            throw new Error(`Missing required environment variables: ${missing.join(', ')}\n` +
                'Please check your .env file and ensure all required variables are set.');
        }
    }
    isDevelopment() {
        return this.server.nodeEnv === 'development';
    }
    isProduction() {
        return this.server.nodeEnv === 'production';
    }
}
exports.Config = Config;
exports.config = Config.getInstance();
//# sourceMappingURL=index.js.map