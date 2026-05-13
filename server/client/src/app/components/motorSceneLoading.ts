type SceneLoadProgress = {
  environment: number;
  motorModel: number;
  machineTrainModel: number;
  sensorModel: number;
};

function clampPercentage(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
}

export function calculateSceneLoadProgress(progress: SceneLoadProgress) {
  const environment = clampPercentage(progress.environment);
  const motorModel = clampPercentage(progress.motorModel);
  const machineTrainModel = clampPercentage(progress.machineTrainModel);
  const sensorModel = clampPercentage(progress.sensorModel);

  return Math.round((environment + motorModel + machineTrainModel + sensorModel) / 4);
}
