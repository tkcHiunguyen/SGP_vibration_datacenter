export const APP_VERSION_QUERY_KEY = "ui_version";

export type AppVersionManifest = {
  buildId: string;
  builtAt?: string;
};

export function parseAppVersionManifest(value: unknown): AppVersionManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const buildId = typeof record.buildId === "string" ? record.buildId.trim() : "";
  if (!buildId) {
    return null;
  }
  return {
    buildId,
    builtAt: typeof record.builtAt === "string" ? record.builtAt : undefined,
  };
}

export function shouldReloadForAppVersion(currentBuildId: string, serverBuildId: string): boolean {
  return Boolean(currentBuildId && serverBuildId && currentBuildId !== serverBuildId);
}

export function createAppVersionReloadUrl(currentHref: string, serverBuildId: string): string {
  const url = new URL(currentHref);
  url.searchParams.set(APP_VERSION_QUERY_KEY, serverBuildId);
  return url.toString();
}
