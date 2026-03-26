import type {
  AuthAccessDescriptor,
  AuthConfig,
  AuthHeaderBag,
  AuthRole,
  AuthScheme,
  AuthenticatedPrincipal,
} from './auth.types.js';
import { extractBearerToken, extractHeaderValue, roleRank, tokenFingerprint } from './auth.utils.js';

const AUTH_API_KEY_HEADER_NAMES = ['x-api-key', 'x-auth-token', 'x-access-token', 'apiKey'] as const;

export class AuthService {
  private readonly tokenIndex = new Map<string, AuthAccessDescriptor & { role: AuthRole }>();

  constructor(private readonly config: AuthConfig) {
    for (const seed of config.tokenSeeds) {
      this.tokenIndex.set(seed.token, {
        role: seed.role,
        source: seed.source,
        tokenFingerprint: tokenFingerprint(seed.token),
      });
    }
  }

  getDefaultRole(): AuthRole {
    return this.config.defaultRole;
  }

  isConfigured(): boolean {
    return this.tokenIndex.size > 0;
  }

  listConfiguredAccess(): AuthAccessDescriptor[] {
    return [...this.tokenIndex.values()].map((seed) => ({
      role: seed.role,
      source: seed.source,
      tokenFingerprint: seed.tokenFingerprint,
    }));
  }

  getConfiguredRoles(): AuthRole[] {
    const roles = new Set<AuthRole>();
    for (const seed of this.tokenIndex.values()) {
      roles.add(seed.role);
    }
    return [...roles].sort((left, right) => roleRank(left) - roleRank(right));
  }

  authenticate(headers: AuthHeaderBag): AuthenticatedPrincipal | null {
    const bearerToken = extractBearerToken(headers.authorization);
    if (bearerToken) {
      const principal = this.authenticateToken(bearerToken, 'bearer');
      if (principal) {
        return principal;
      }
    }

    for (const headerName of AUTH_API_KEY_HEADER_NAMES) {
      const apiKey = extractHeaderValue(headers[headerName]);
      if (!apiKey) {
        continue;
      }
      const principal = this.authenticateToken(apiKey, 'api-key');
      if (principal) {
        return principal;
      }
    }

    return null;
  }

  authenticateBearer(authorization?: string | string[] | null): AuthenticatedPrincipal | null {
    return this.authenticateTokenFromValue(extractBearerToken(authorization), 'bearer');
  }

  authenticateApiKey(apiKey?: string | string[] | null): AuthenticatedPrincipal | null {
    return this.authenticateTokenFromValue(extractHeaderValue(apiKey), 'api-key');
  }

  authenticateToken(token: string, scheme: AuthScheme): AuthenticatedPrincipal | null {
    const normalized = token.trim();
    if (!normalized) {
      return null;
    }

    const match = this.tokenIndex.get(normalized);
    if (!match) {
      return null;
    }

    return {
      role: match.role,
      scheme,
      source: match.source,
      tokenFingerprint: match.tokenFingerprint,
      authenticatedAt: new Date().toISOString(),
    };
  }

  authorize(principal: AuthenticatedPrincipal | null, requiredRole: AuthRole): boolean {
    if (!principal) {
      return false;
    }
    return roleRank(principal.role) >= roleRank(requiredRole);
  }

  hasRoleAtLeast(role: AuthRole, requiredRole: AuthRole): boolean {
    return roleRank(role) >= roleRank(requiredRole);
  }

  private authenticateTokenFromValue(
    value: string | undefined,
    scheme: AuthScheme,
  ): AuthenticatedPrincipal | null {
    if (!value) {
      return null;
    }

    return this.authenticateToken(value, scheme);
  }
}
