"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DerivApiService = void 0;
const ws_1 = __importDefault(require("ws"));
const events_1 = require("events");
const logger_1 = __importDefault(require("../utils/logger"));
class DerivApiService extends events_1.EventEmitter {
    constructor(config) {
        super();
        this.ws = null;
        this.isConnected = false;
        this.isAuthenticated = false;
        this.requestId = 1;
        this.pendingRequests = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.lastActivity = new Date();
        this.config = config;
    }
    async connect() {
        return new Promise((resolve, reject) => {
            try {
                const wsUrlWithAppId = `${this.config.wsUrl}?app_id=${this.config.appId}`;
                logger_1.default.info(`Connecting to Deriv API: ${wsUrlWithAppId}`);
                this.ws = new ws_1.default(wsUrlWithAppId);
                this.ws.on('open', () => {
                    logger_1.default.info('Connected to Deriv API');
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    this.lastActivity = new Date();
                    this.emit('connected');
                    resolve();
                });
                this.ws.on('message', (data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        this.lastActivity = new Date();
                        this.handleMessage(message);
                    }
                    catch (error) {
                        logger_1.default.error('Error parsing message:', error);
                    }
                });
                this.ws.on('close', (code, reason) => {
                    logger_1.default.warn(`Deriv API connection closed: ${code} - ${reason}`);
                    this.isConnected = false;
                    this.isAuthenticated = false;
                    this.emit('disconnected', { code, reason });
                    this.handleReconnection();
                });
                this.ws.on('error', (error) => {
                    logger_1.default.error('Deriv API WebSocket error:', error);
                    this.emit('error', error);
                    reject(error);
                });
            }
            catch (error) {
                logger_1.default.error('Error creating WebSocket connection:', error);
                reject(error);
            }
        });
    }
    async authenticate() {
        if (!this.isConnected) {
            throw new Error('Not connected to Deriv API');
        }
        const request = {
            authorize: this.config.apiToken,
            req_id: this.requestId++
        };
        try {
            const response = await this.sendRequest(request);
            if (response.error) {
                throw new Error(`Authentication failed: ${response.error.message}`);
            }
            this.isAuthenticated = true;
            logger_1.default.info('Successfully authenticated with Deriv API');
            this.emit('authenticated', response.authorize);
            return response;
        }
        catch (error) {
            logger_1.default.error('Authentication error:', error);
            throw error;
        }
    }
    async getBalance() {
        this.ensureAuthenticated();
        const request = {
            balance: 1,
            req_id: this.requestId++
        };
        return this.sendRequest(request);
    }
    async getPortfolio() {
        this.ensureAuthenticated();
        const request = {
            portfolio: 1,
            req_id: this.requestId++
        };
        return this.sendRequest(request);
    }
    async getTicks(symbol) {
        this.ensureAuthenticated();
        const request = {
            ticks_history: symbol,
            adjust_start_time: 1,
            count: 1,
            end: 'latest',
            start: 1,
            style: 'ticks',
            req_id: this.requestId++
        };
        return this.sendRequest(request);
    }
    async getContractDetails(contractId) {
        this.ensureAuthenticated();
        const request = {
            proposal_open_contract: 1,
            contract_id: contractId,
            req_id: this.requestId++
        };
        return this.sendRequest(request);
    }
    async subscribeToContract(contractId) {
        this.ensureAuthenticated();
        const request = {
            proposal_open_contract: 1,
            contract_id: contractId,
            subscribe: 1,
            req_id: this.requestId++
        };
        return this.sendRequest(request);
    }
    async unsubscribeFromContract(contractId) {
        this.ensureAuthenticated();
        const request = {
            forget_all: 'proposal_open_contract',
            req_id: this.requestId++
        };
        return this.sendRequest(request);
    }
    async subscribeToPortfolio() {
        this.ensureAuthenticated();
        const request = {
            portfolio: 1,
            subscribe: 1,
            req_id: this.requestId++
        };
        return this.sendRequest(request);
    }
    async unsubscribeFromPortfolio() {
        this.ensureAuthenticated();
        const request = {
            forget_all: 'portfolio',
            req_id: this.requestId++
        };
        return this.sendRequest(request);
    }
    async buyContract(params) {
        this.ensureAuthenticated();
        const proposalRequest = {
            proposal: 1,
            amount: params.amount,
            basis: params.basis || 'stake',
            contract_type: params.contractType,
            currency: 'USD',
            duration: params.duration,
            duration_unit: params.durationUnit,
            symbol: params.symbol,
            req_id: this.requestId++
        };
        const proposalResponse = await this.sendRequest(proposalRequest);
        if (proposalResponse.error || !proposalResponse.proposal) {
            throw new Error(`Failed to get proposal: ${proposalResponse.error?.message || 'Unknown error'}`);
        }
        const buyRequest = {
            buy: proposalResponse.proposal.id,
            price: params.amount,
            req_id: this.requestId++
        };
        return this.sendRequest(buyRequest);
    }
    sendRequest(request) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected || !this.ws) {
                reject(new Error('Not connected to Deriv API'));
                return;
            }
            const reqId = request.req_id || this.requestId++;
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(reqId);
                reject(new Error('Request timeout'));
            }, 30000);
            this.pendingRequests.set(reqId, {
                resolve,
                reject,
                timeout
            });
            try {
                this.ws.send(JSON.stringify(request));
                logger_1.default.debug(`Sent request: ${request.msg_type || 'unknown'}`, { reqId });
            }
            catch (error) {
                this.pendingRequests.delete(reqId);
                clearTimeout(timeout);
                reject(error);
            }
        });
    }
    handleMessage(message) {
        logger_1.default.debug(`Received message: ${message.msg_type}`, { reqId: message.req_id });
        if (message.req_id && this.pendingRequests.has(message.req_id)) {
            const pending = this.pendingRequests.get(message.req_id);
            this.pendingRequests.delete(message.req_id);
            clearTimeout(pending.timeout);
            if (message.error) {
                pending.reject(new Error(message.error.message));
            }
            else {
                pending.resolve(message);
            }
            return;
        }
        this.emit('message', message);
        this.emit(message.msg_type, message);
    }
    handleReconnection() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger_1.default.error('Max reconnection attempts reached');
            this.emit('maxReconnectAttemptsReached');
            return;
        }
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        logger_1.default.info(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        setTimeout(async () => {
            try {
                await this.connect();
                if (this.config.apiToken) {
                    await this.authenticate();
                }
            }
            catch (error) {
                logger_1.default.error('Reconnection failed:', error);
            }
        }, delay);
    }
    ensureAuthenticated() {
        if (!this.isAuthenticated) {
            throw new Error('Not authenticated with Deriv API');
        }
    }
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
        this.isAuthenticated = false;
        this.pendingRequests.forEach(({ reject, timeout }) => {
            clearTimeout(timeout);
            reject(new Error('Connection closed'));
        });
        this.pendingRequests.clear();
    }
    isConnectedAndAuthenticated() {
        return this.isConnected && this.isAuthenticated;
    }
    getLastActivity() {
        return this.lastActivity;
    }
    getConnectionStatus() {
        return {
            connected: this.isConnected,
            authenticated: this.isAuthenticated,
            lastActivity: this.lastActivity
        };
    }
}
exports.DerivApiService = DerivApiService;
//# sourceMappingURL=derivApi.js.map