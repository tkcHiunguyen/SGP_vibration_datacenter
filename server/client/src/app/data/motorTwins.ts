export type MotorPosition = {
  x: number;
  y: number;
  z: number;
};

export type MotorRotation = {
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

export type MotorPositionSample = {
  id: string;
  motorId: string;
  sensorId: string;
  recordedAt: string;
  position: MotorPosition;
  rotation?: MotorRotation;
  note: string;
};

type MotorPositionMockPoint = {
  minutesAgo: number;
  position: MotorPosition;
  rotation?: MotorRotation;
  note: string;
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

const MOCK_MOTOR_POSITION_POINTS: MotorPositionMockPoint[] = [
  {
    minutesAgo: 2880,
    position: { x: -0.08, y: 0, z: 0.02 },
    rotation: { y: -0.015 },
    note: "Baseline sau bảo trì",
  },
  {
    minutesAgo: 1440,
    position: { x: -0.05, y: 0, z: 0.01 },
    rotation: { y: -0.008 },
    note: "Ổn định sau 24h",
  },
  {
    minutesAgo: 720,
    position: { x: -0.03, y: 0, z: 0.015 },
    rotation: { y: -0.004 },
    note: "Dao động nhỏ theo cụm đế",
  },
  {
    minutesAgo: 360,
    position: { x: -0.015, y: 0, z: 0.008 },
    rotation: { y: -0.002 },
    note: "Gần vị trí chuẩn",
  },
  {
    minutesAgo: 180,
    position: { x: 0.006, y: 0, z: 0.004 },
    rotation: { y: 0.001 },
    note: "Mẫu mock lúc tải trung bình",
  },
  {
    minutesAgo: 90,
    position: { x: 0.018, y: 0, z: -0.004 },
    rotation: { y: 0.004 },
    note: "Dịch chuyển nhẹ về phía coupling",
  },
  {
    minutesAgo: 45,
    position: { x: 0.026, y: 0, z: -0.008 },
    rotation: { y: 0.006 },
    note: "Mẫu mock sau khi chọn khoảng 1h",
  },
  {
    minutesAgo: 20,
    position: { x: 0.034, y: 0, z: -0.012 },
    rotation: { y: 0.008 },
    note: "Vị trí gần nhất trong ca hiện tại",
  },
  {
    minutesAgo: 5,
    position: { x: 0.04, y: 0, z: -0.015 },
    rotation: { y: 0.01 },
    note: "Mẫu mới nhất từ sensor mock",
  },
];

export function buildMockMotorPositionSamples(
  twin: MotorTwin,
  nowMs = Date.now(),
): MotorPositionSample[] {
  return MOCK_MOTOR_POSITION_POINTS.map((point, index) => ({
    id: `${twin.motorId}-mock-position-${index + 1}`,
    motorId: twin.motorId,
    sensorId: twin.sensorId,
    recordedAt: new Date(nowMs - point.minutesAgo * 60_000).toISOString(),
    position: point.position,
    rotation: point.rotation,
    note: point.note,
  })).sort((left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt));
}
