import type { AuthHeaderValue, AuthRole, AuthTokenSeed } from './auth.types.js';

const authRoleRank: Record<AuthRole, number> = {
  viewer: 0,
  operator: 1,
  release_manager: 2,
  approver: 3,
  admin: 4,
};

function isAuthRole(value: string): value is AuthRole {
  return (
    value === 'admin'
    || value === 'approver'
    || value === 'release_manager'
    || value === 'operator'
    || value === 'viewer'
  );
}

export function roleRank(role: AuthRole): number {
  return authRoleRank[role];
}

function normalizeToken(token: string): string {
  return token.trim();
}

export function tokenFingerprint(token: string): string {
  const cleaned = normalizeToken(token);
  if (cleaned.length <= 8) {
    return cleaned;
  }
  return `${cleaned.slice(0, 4)}…${cleaned.slice(-4)}`;
}

export function extractHeaderValue(value: AuthHeaderValue): string | undefined {
  if (Array.isArray(value)) {
    const [first] = value;
    return first?.trim() || undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

export function extractBearerToken(authorization?: AuthHeaderValue): string | undefined {
  const raw = extractHeaderValue(authorization);
  if (!raw) {
    return undefined;
  }

  const [scheme, ...rest] = raw.split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer') {
    return undefined;
  }

  const token = rest.join(' ').trim();
  return token || undefined;
}

export function parseAuthTokenSeeds(raw: string | undefined, defaultRole: AuthRole): AuthTokenSeed[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(/[\n,;]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((entry, index) => parseAuthTokenSeedEntry(entry, defaultRole, `AUTH_STATIC_TOKENS[${index}]`))
    .filter((seed): seed is AuthTokenSeed => Boolean(seed));
}

export function parseAuthTokenSeedEntry(
  entry: string,
  defaultRole: AuthRole,
  source: string,
): AuthTokenSeed | null {
  const separatorIndex = entry.search(/[:=]/);
  let role = defaultRole;
  let token = entry.trim();

  if (separatorIndex >= 0) {
    const rawRole = entry.slice(0, separatorIndex).trim().toLowerCase();
    const rawToken = entry.slice(separatorIndex + 1).trim();
    if (isAuthRole(rawRole)) {
      role = rawRole;
      token = rawToken;
    } else {
      token = rawToken || entry.trim();
    }
  }

  if (!token) {
    return null;
  }

  return {
    role,
    token: normalizeToken(token),
    source,
  };
}

export function uniqueByToken(seeds: AuthTokenSeed[]): AuthTokenSeed[] {
  const seen = new Map<string, AuthTokenSeed>();
  for (const seed of seeds) {
    seen.set(seed.token, seed);
  }
  return [...seen.values()];
}
