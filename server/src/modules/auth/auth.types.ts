export type AuthRole = 'admin' | 'approver' | 'release_manager' | 'operator' | 'viewer';

export type AuthScheme = 'bearer' | 'api-key';

export type AuthTokenSeed = {
  role: AuthRole;
  token: string;
  source: string;
  label?: string;
};

export type AuthConfig = {
  defaultRole: AuthRole;
  tokenSeeds: AuthTokenSeed[];
};

export type AuthHeaderValue = string | string[] | undefined | null;

export type AuthHeaderBag = {
  authorization?: AuthHeaderValue;
  apiKey?: AuthHeaderValue;
  'x-api-key'?: AuthHeaderValue;
  'x-auth-token'?: AuthHeaderValue;
  'x-access-token'?: AuthHeaderValue;
};

export type AuthenticatedPrincipal = {
  role: AuthRole;
  scheme: AuthScheme;
  source: string;
  tokenFingerprint: string;
  authenticatedAt: string;
};

export type AuthAccessDescriptor = {
  role: AuthRole;
  source: string;
  tokenFingerprint: string;
};
