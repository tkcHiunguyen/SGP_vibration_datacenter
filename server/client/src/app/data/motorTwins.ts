type MotorPosition = {
  x: number;
  y: number;
  z: number;
};

type MotorRotation = {
  x?: number;
  y?: number;
  z?: number;
};

export type MotorTwin = {
  motorId: string;
  sensorId: string;
  name: string;
  position: MotorPosition;
  rotation?: MotorRotation;
};

export const MOCK_MOTOR_TWINS: MotorTwin[] = [
  {
    motorId: "motor-cra-01",
    sensorId: "sensor-vib-001",
    name: "Motor CRAH 01",
    position: { x: 0, y: 0, z: 0 },
    rotation: { y: 0 },
  },
];
