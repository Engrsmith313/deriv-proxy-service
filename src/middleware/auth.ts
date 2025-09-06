import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import logger from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  isAuthenticated?: boolean;
}

export const authenticateApiKey = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

  if (!apiKey) {
    logger.warn('API request without API key', {
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

  // Convert apiKey to string if it's an array
  const apiKeyString = Array.isArray(apiKey) ? apiKey[0] : apiKey;

  if (apiKeyString !== config.server.apiKey) {
    logger.warn('API request with invalid API key', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path,
      providedKey: apiKeyString.substring(0, 8) + '...' // Log only first 8 characters for security
    });

    res.status(401).json({
      success: false,
      error: 'Invalid API key',
      message: 'The provided API key is not valid'
    });
    return;
  }

  req.isAuthenticated = true;
  logger.debug('API request authenticated successfully', {
    ip: req.ip,
    path: req.path
  });

  next();
};
