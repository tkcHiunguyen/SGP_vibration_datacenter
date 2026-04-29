type SceneLoadProgress = {
  environment: number;
  motor: number;
};

function clampPercentage(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
}

export function calculateSceneLoadProgress(progress: SceneLoadProgress) {
  const environment = clampPercentage(progress.environment);
  const motor = clampPercentage(progress.motor);

  return Math.round((environment + motor) / 2);
}
