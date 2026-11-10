import { Request, Response, NextFunction } from 'express';
import { Sep10AuthService, Sep10TokenPayload } from '../services/Sep10AuthService';

export interface Sep10User {
  stellarPublicKey: string;
  issuer: string;
  issuedAt: Date;
  expiresAt: Date;
  role?: string;
}

export interface AuthenticatedRequest extends Request {
  sep10User?: Sep10User;
  user?: {
    address: string;
    role: string;
  };
}

export interface AuthMiddlewareOptions {
  requireAdmin?: boolean;
  requireUserMatch?: boolean;
  service?: Sep10AuthService;
}

// Singleton instance for default middleware usage
const defaultAuthService = new Sep10AuthService();

/**
 * Extracts Bearer token from HTTP Authorization header
 */
export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

/**
 * Express middleware to authenticate incoming requests via SEP-10 JWT
 */
export function authenticate(options: AuthMiddlewareOptions = {}) {
  const service = options.service || defaultAuthService;

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = extractBearerToken(req);
      if (!token) {
        return res.status(401).json({
          success: false,
          error: 'authentication_required',
          message: 'SEP-10 JWT token required in Authorization header',
        });
      }

      let payload: Sep10TokenPayload;
      try {
        payload = service.verifyToken(token);
      } catch (err: any) {
        return res.status(401).json({
          success: false,
          error: 'invalid_token',
          message: 'Invalid or expired SEP-10 token',
          details: err.message,
        });
      }

      const clientPublicKey = payload.sub;
      if (!clientPublicKey) {
        return res.status(401).json({
          success: false,
          error: 'invalid_claims',
          message: 'Missing sub claim in SEP-10 token',
        });
      }

      // Check user-match if requested
      if (options.requireUserMatch) {
        const requestedAddress = req.params?.userAddress || req.query?.account || req.body?.userAddress;
        if (requestedAddress && requestedAddress !== clientPublicKey) {
          return res.status(403).json({
            success: false,
            error: 'access_denied',
            message: 'Access denied: Users can only access their own data',
          });
        }
      }

      // Check admin privilege if requested
      const adminAddresses = process.env.ADMIN_ADDRESSES
        ? process.env.ADMIN_ADDRESSES.split(',').map((a) => a.trim().toLowerCase())
        : [];

      const isAdmin = adminAddresses.includes(clientPublicKey.toLowerCase());

      if (options.requireAdmin && !isAdmin) {
        return res.status(403).json({
          success: false,
          error: 'admin_privileges_required',
          message: 'Admin privileges required for this endpoint',
        });
      }

      // Attach user info to request
      req.sep10User = {
        stellarPublicKey: clientPublicKey,
        issuer: payload.iss,
        issuedAt: new Date(payload.iat * 1000),
        expiresAt: new Date(payload.exp * 1000),
        role: isAdmin ? 'admin' : 'user',
      };

      req.user = {
        address: clientPublicKey,
        role: isAdmin ? 'admin' : 'user',
      };

      next();
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: 'authentication_error',
        message: 'Internal authentication error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  };
}

/**
 * Express middleware helper specifically for admin endpoints
 */
export function authenticateAdmin(service?: Sep10AuthService) {
  return authenticate({ requireAdmin: true, service });
}

export { defaultAuthService };
export default authenticate;
