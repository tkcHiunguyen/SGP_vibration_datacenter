import { env } from '../../shared/config.js';
import type { AuthConfig, AuthRole, AuthTokenSeed } from './auth.types.js';
import { parseAuthTokenSeedEntry, parseAuthTokenSeeds, uniqueByToken } from './auth.utils.js';
import { AuthService } from './auth.service.js';

type AuthEnvSource = {
  AUTH_DEFAULT_ROLE: AuthRole;
  AUTH_STATIC_TOKENS?: string;
  AUTH_ADMIN_TOKEN?: string;
  AUTH_APPROVER_TOKEN?: string;
  AUTH_RELEASE_MANAGER_TOKEN?: string;
  AUTH_OPERATOR_TOKEN?: string;
  AUTH_VIEWER_TOKEN?: string;
};

const ROLE_ENV_VARS: Array<{
  role: AuthRole;
  envKey: keyof AuthEnvSource;
}> = [
  { role: 'admin', envKey: 'AUTH_ADMIN_TOKEN' },
  { role: 'approver', envKey: 'AUTH_APPROVER_TOKEN' },
  { role: 'release_manager', envKey: 'AUTH_RELEASE_MANAGER_TOKEN' },
  { role: 'operator', envKey: 'AUTH_OPERATOR_TOKEN' },
  { role: 'viewer', envKey: 'AUTH_VIEWER_TOKEN' },
];

export function createAuthConfigFromEnv(source: AuthEnvSource = env): AuthConfig {
  const tokenSeeds: AuthTokenSeed[] = [
    ...parseAuthTokenSeeds(source.AUTH_STATIC_TOKENS, source.AUTH_DEFAULT_ROLE),
    ...ROLE_ENV_VARS.flatMap(({ role, envKey }) => {
      const token = source[envKey];
      if (!token?.trim()) {
        return [];
      }

      return [
        parseAuthTokenSeedEntry(token, role, envKey),
      ];
    }).filter((seed): seed is AuthTokenSeed => Boolean(seed)),
  ];

  return {
    defaultRole: source.AUTH_DEFAULT_ROLE,
    tokenSeeds: uniqueByToken(tokenSeeds),
  };
}

export function createAuthServiceFromEnv(source: AuthEnvSource = env): AuthService {
  return new AuthService(createAuthConfigFromEnv(source));
}
