"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateApiKey = void 0;
const config_1 = require("../config");
const logger_1 = __importDefault(require("../utils/logger"));
const authenticateApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    if (!apiKey) {
        logger_1.default.warn('API request without API key', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            path: req.path
        });
        res.status(401).json({
            success: false,
            error: 'API key required',
            message: 'Please provide a valid API key in the X-API-Key header or Authorization header'
        });
        return;
    }
    const apiKeyString = Array.isArray(apiKey) ? apiKey[0] : apiKey;
    if (apiKeyString !== config_1.config.server.apiKey) {
        logger_1.default.warn('API request with invalid API key', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            path: req.path,
            providedKey: apiKeyString.substring(0, 8) + '...'
        });
        res.status(401).json({
            success: false,
            error: 'Invalid API key',
            message: 'The provided API key is not valid'
        });
        return;
    }
    req.isAuthenticated = true;
    logger_1.default.debug('API request authenticated successfully', {
        ip: req.ip,
        path: req.path
    });
    next();
};
exports.authenticateApiKey = authenticateApiKey;
//# sourceMappingURL=auth.js.map