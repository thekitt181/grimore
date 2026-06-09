import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './auth';
/** Requires X-Session-Id header and that the user is the campaign GM. */
export declare function requireSessionGM(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=requireSessionGM.d.ts.map