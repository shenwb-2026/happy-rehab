// 快乐康复指导 · 全局配置
// 所有可调参数集中在此，不散落在各模块内部。
// 首次训练后可针对该儿童调优 DETECTION_CONFIG 中的阈值参数。

// ─── 摄像头 ──────────────────────────────────────────────────
export const CAMERA_CONFIG = {
  width: 1376,
  height: 768,
  facingMode: 'user',
};

// ─── MediaPipe ───────────────────────────────────────────────
export const MEDIAPIPE_CONFIG = {
  wasmPath: '/mediapipe/',
  poseModelPath: '/mediapipe/pose_landmarker_lite.task',
  maxPoses: 1,
  runningMode: 'VIDEO',
  minPoseDetectionConfidence: 0.5,
  minPoseTrackingConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  outputSegmentationMasks: false,
};

// ─── 检测层参数（规格书 7.2 节） ─────────────────────────────
export const DETECTION_CONFIG = {
  // 髋关节摆动阈值（肩宽归一化比例），临床预估值，首次训练后调优（Q4）
  hipSwingThresholdMin: 0.12,
  hipSwingThresholdMax: 0.18,

  minStepIntervalMs: 700,

  // 低通滤波：8帧滚动平均（250ms @ 30fps）
  smoothingFrames: 8,

  peakDurationMinMs: 120,
  peakReturnWindowMs: 1500,

  crosslineTimeWindowMs: 2000,

  auxiliaryValidationWindowMs: 200,

  signalSelectionWindowMs: 5000,

  hipConfidenceMin: 0.6,
  keyPointConfidenceMin: 0.5,
  lowConfidenceFrameThreshold: 10,

  // MVP 阶段保留但不生效
  fallDetectionRatio: 0.4,
};

// ─── 校准参数 ──────────────────────────────────────────────────
export const CALIBRATION_CONFIG = {
  promptDurationMs: 3000,
  collectDurationMs: 5000,
  sampleFrames: 150,
  referenceJoints: [11, 12, 23, 24],
};

// ─── 游戏层参数（规格书 9 节 + 补充决策 v1.2） ──────────────
export const GAME_CONFIG = {
  streakBonusAt: 5,
  streakTimeoutMs: 5000,

  hungerIncreasePerStep: 5,
  streakBonusTiles: 5,

  // 场景解锁阈值；补充决策 2 确认太空阈值为 100 步
  sceneUnlockSteps: [50, 100],
  scenes: ['forest', 'beach', 'space'],

  bounceAnimationMs: 350,
  particleLifetimeMs: 700,
  streakDanceMs: 2000,

  bubbleSpecialEvery: 5,
  bubbleSurpriseRatio: 0.125,
};

// ─── 存储配置 ──────────────────────────────────────────────────
export const STORAGE_CONFIG = {
  keyPrefix: 'hrg.',
};

// ─── 调试开关 ──────────────────────────────────────────────────
export const DEBUG_CONFIG = {
  drawSkeleton: false,
  showFPS: false,
  verboseLogging: false,
};
