import { Request, Response, NextFunction } from 'express';
export interface AuthenticatedRequest extends Request {
    isAuthenticated?: boolean;
}
export declare const authenticateApiKey: (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
//# sourceMappingURL=auth.d.ts.map