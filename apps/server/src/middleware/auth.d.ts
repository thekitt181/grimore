import type { Request, Response, NextFunction } from 'express';
export interface AuthenticatedRequest extends Request {
    userId?: string;
    clerkUserId?: string;
}
/**
 * Verifies the Clerk session token from the Authorization header
 * and attaches the database userId to the request.
 */
export declare function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=auth.d.ts.map