/**
 * 快乐康复指导 — 应用主入口
 *
 * 职责：
 * 1. 初始化所有模块（音频、UI、摄像头、MediaPipe、检测器、游戏）
 * 2. 连接检测层 → 游戏层的完整数据流
 * 3. 管理训练生命周期（用户交互 → 状态变更 → 模块调度）
 *
 * 主流程：
 * 1. 页面加载 → 初始化 SoundEngine
 * 2. 显示校准界面 → 等待用户点击"开始校准"
 * 3. 用户点击 → 启动摄像头 → 初始化 MediaPipe
 * 4. 校准：采集站立数据 → 计算基准参数 → 传给检测器
 * 5. 显示游戏选择界面 → 等待用户选择游戏
 * 6. 用户选择 → 创建对应 GameInterface 实例
 * 7. 创建 SessionManager → 注入检测器 + 游戏
 * 8. 开始训练 → session.startTraining()
 * 9. MediaPipe 逐帧 → detector.processFrame() → session.handleDetectionResult() → game.onStep()
 * 10. 用户操作（休息/结束）→ session 状态变更 → UI 切换
 */

import './styles/global.css';
import { CAMERA_CONFIG, CALIBRATION_CONFIG } from './config.js';
import { SoundEngine } from './audio/audio.js';
import { UIManager } from './ui/ui-manager.js';
import { CameraManager } from './core/camera.js';
import { MediaPipeManager } from './core/mediapipe.js';
import { SignalDetector } from './detection/SignalDetector.js';
import { SessionManager, SessionState } from './core/session.js';
import { BubblePop } from './games/BubblePop/BubblePop.js';
import { CompanionJourney } from './games/CompanionJourney/CompanionJourney.js';
import { LocalStore } from './storage/localstore.js';

// =========================================================================
// 全局模块引用
// =========================================================================

/** @type {SoundEngine} */
let soundEngine;

/** @type {UIManager} */
let uiManager;

/** @type {CameraManager|null} */
let camera = null;

/** @type {MediaPipeManager|null} */
let mediapipe = null;

/** @type {SignalDetector} */
let detector;

/** @type {Object|null} 当前激活的游戏模块 */
let game = null;

/** @type {SessionManager|null} */
let session = null;

/** @type {string|null} 选中的游戏 ID */
let selectedGameId = null;

/** @type {HTMLCanvasElement} 主 Canvas */
let mainCanvas;

/** @type {number|null} 校准倒计时定时器 */
let calibrationCountdownTimer = null;

/** @type {Array<Object>} 校准期间采集的样本缓存 */
let calibrationSamples = [];

/** @type {boolean} 校准是否正在进行中 */
let isCalibrating = false;

// =========================================================================
// 主启动
// =========================================================================

/**
 * 应用主启动流程
 */
async function bootstrap() {
  console.log('[快乐康复指导] 正在启动...');

  // 1. 获取主 Canvas 引用
  mainCanvas = document.getElementById('main-canvas');
  if (!mainCanvas) {
    throw new Error('找不到 #main-canvas 元素');
  }

  // 设置 Canvas 尺寸
  resizeMainCanvas();
  window.addEventListener('resize', resizeMainCanvas);
  window.addEventListener('orientationchange', () => setTimeout(resizeMainCanvas, 200));

  // 2. 初始化音效引擎（延迟初始化 AudioContext）
  soundEngine = new SoundEngine();

  // 3. 初始化检测器
  detector = new SignalDetector();

  // 4. 创建 UI 管理器并绑定回调
  uiManager = new UIManager({
    onStartCalibration: handleStartCalibration,
    onStartTraining: handleStartTraining,
    onStartRest: handleStartRest,
    onEndRest: handleEndRest,
    onEndSession: handleEndSession,
    onGameSelected: handleGameSelected,
  });

  // 5. 尝试加载已保存的校准参数
  const savedCalibration = LocalStore.getCalibration();
  if (savedCalibration) {
    detector.setCalibration(savedCalibration);
    console.log('[快乐康复指导] 已加载校准参数');
  }

  // 6. 显示校准界面
  uiManager.showCalibration();

  console.log('[快乐康复指导] 启动完成 ✓');
}

// =========================================================================
// Canvas 调整
// =========================================================================

function resizeMainCanvas() {
  if (!mainCanvas) return;
  const app = document.getElementById('app');
  if (!app) return;

  const parentW = app.clientWidth;
  const parentH = app.clientHeight;
  const scale = Math.min(parentW / CAMERA_CONFIG.width, parentH / CAMERA_CONFIG.height);

  mainCanvas.width = CAMERA_CONFIG.width * scale;
  mainCanvas.height = CAMERA_CONFIG.height * scale;
  mainCanvas.style.width = `${CAMERA_CONFIG.width * scale}px`;
  mainCanvas.style.height = `${CAMERA_CONFIG.height * scale}px`;
}

// =========================================================================
// 校准流程
// =========================================================================

/**
 * 用户点击"开始校准"
 */
async function handleStartCalibration() {
  console.log('[App] 开始校准流程');
  try {
    // 创建并启动摄像头
    camera = new CameraManager();
    const videoElement = await camera.start();

    // 更新 UI 的摄像头预览
    uiManager.updateCalibrationPreview(camera.stream);

    // 创建并初始化 MediaPipe
    mediapipe = new MediaPipeManager({
      onLandmarks: handleCalibrationLandmarks,
      onError: (err) => {
        console.error('[App] MediaPipe 错误:', err.message);
      },
    });
    await mediapipe.initialize();

    // 开始帧处理
    mediapipe.start(videoElement);

    // 重置校准状态
    calibrationSamples = [];
    isCalibrating = false;

    // 启动 3 秒准备倒计时
    startCalibrationCountdown(CALIBRATION_CONFIG.promptDurationMs);

  } catch (err) {
    console.error('[App] 校准启动失败:', err.message);
    alert(`校准启动失败：${err.message}`);
  }
}

/**
 * 启动校准倒计时
 *
 * @param {number} durationMs - 倒计时总时长
 */
function startCalibrationCountdown(durationMs) {
  let remaining = Math.floor(durationMs / 1000);
  uiManager.showCalibrationCountdown(remaining);

  calibrationCountdownTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(calibrationCountdownTimer);
      calibrationCountdownTimer = null;
      uiManager.hideCalibrationCountdown();

      // 倒计时结束，开始采集
      isCalibrating = true;
      calibrationSamples = [];
      console.log('[App] 开始采集校准数据...');

      // 采集 CALIBRATION_CONFIG.sampleFrames 帧
      const sampleDuration = (CALIBRATION_CONFIG.sampleFrames / 30) * 1000; // 假设 30fps
      setTimeout(() => {
        finishCalibration();
      }, sampleDuration);
    } else {
      uiManager.showCalibrationCountdown(remaining);
    }
  }, 1000);
}

/**
 * 校准期间的 landmarks 回调
 *
 * @param {Array|null} landmarks
 */
function handleCalibrationLandmarks(landmarks) {
  if (!landmarks) return;

  // 更新置信度指示器
  uiManager.updateConfidenceIndicators(landmarks);

  // 仅在采集阶段累积样本
  if (!isCalibrating) return;

  // 提取左侧/右侧髋关节和肩关节坐标
  const leftHip = landmarks[23];
  const rightHip = landmarks[24];
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];

  // 置信度检查
  if (
    leftHip.visibility < 0.5 ||
    rightHip.visibility < 0.5 ||
    leftShoulder.visibility < 0.5 ||
    rightShoulder.visibility < 0.5
  ) {
    return; // 置信度不足，跳过此帧
  }

  // 计算髋关节中点 X
  const midX = (leftHip.x + rightHip.x) / 2;
  // 计算肩宽（像素级需要结合视频分辨率）
  const shoulderWidthNorm = Math.abs(leftShoulder.x - rightShoulder.x);
  // 髋关节 Y（站立基准）
  const hipY = (leftHip.y + rightHip.y) / 2;

  calibrationSamples.push({
    midX,
    shoulderWidthNorm,
    hipY,
    timestamp: Date.now(),
  });
}

/**
 * 校准采集完成，计算基准参数
 */
function finishCalibration() {
  isCalibrating = false;

  if (calibrationSamples.length < 5) {
    console.warn('[App] 校准样本不足，使用默认参数');
    // 使用保守默认值
    const params = {
      hipNeutralX: 0.5,
      shoulderWidthPx: 100,
      baselineTremorAmplitude: 0.005,
      standingHipY: 0.65,
    };
    detector.setCalibration(params);
    LocalStore.saveCalibration(params);
    uiManager.showCalibrationReady({
      shoulderWidth: params.shoulderWidthPx,
      hipHeight: params.standingHipY,
    });
    return;
  }

  // 计算平均值
  const avgMidX = calibrationSamples.reduce((s, v) => s + v.midX, 0) / calibrationSamples.length;
  const avgShoulderWidth = calibrationSamples.reduce((s, v) => s + v.shoulderWidthNorm, 0) / calibrationSamples.length;
  const avgHipY = calibrationSamples.reduce((s, v) => s + v.hipY, 0) / calibrationSamples.length;

  // 计算基线震颤幅度（标准差）
  const squaredDiffs = calibrationSamples.map((v) => (v.midX - avgMidX) ** 2);
  const variance = squaredDiffs.reduce((s, v) => s + v, 0) / squaredDiffs.length;
  const tremorAmplitude = Math.sqrt(variance);

  // 计算像素级肩宽（需要确认视频实际分辨率）
  const videoEl = camera?.getVideoElement();
  const videoWidth = videoEl ? (videoEl.videoWidth || 1376) : 1376;
  const shoulderWidthPx = avgShoulderWidth * videoWidth;

  const params = {
    hipNeutralX: avgMidX,
    shoulderWidthPx: Math.round(shoulderWidthPx),
    baselineTremorAmplitude: tremorAmplitude,
    standingHipY: avgHipY,
  };

  console.log('[App] 校准完成:', params);

  // 传给检测器
  detector.setCalibration(params);

  // 保存到 localStorage
  LocalStore.saveCalibration(params);

  // 更新 UI
  uiManager.showCalibrationReady({
    shoulderWidth: params.shoulderWidthPx,
    hipHeight: params.standingHipY,
  });

  calibrationSamples = [];
}

// =========================================================================
// 游戏选择流程
// =========================================================================

/**
 * 用户点击"开始训练"（校准完成后）
 */
function handleStartTraining() {
  console.log('[App] 用户点击开始训练');

  // 清理校准阶段的倒计时
  if (calibrationCountdownTimer !== null) {
    clearInterval(calibrationCountdownTimer);
    calibrationCountdownTimer = null;
  }

  // 显示游戏选择界面
  uiManager.showGameSelection();
}

/**
 * 游戏被选择
 *
 * @param {string} gameId - 'bubble' | 'companion'
 */
function handleGameSelected(gameId) {
  console.log(`[App] 游戏已选择: ${gameId}`);
  selectedGameId = gameId;

  // 1. 更新 MediaPipe 的 landmarks 回调（从校准切换到训练）
  if (mediapipe) {
    mediapipe.onLandmarks = handleTrainingLandmarks;
  }

  // 2. 创建游戏模块
  if (gameId === 'bubble') {
    game = new BubblePop(mainCanvas, soundEngine);
  } else if (gameId === 'companion') {
    game = new CompanionJourney(mainCanvas, soundEngine);
  } else {
    console.error(`[App] 未知游戏: ${gameId}`);
    return;
  }

  // 3. 创建 SessionManager
  session = new SessionManager({
    detector,
    game,
    onStateChange: handleSessionStateChange,
    onStepCount: handleStepCountUpdate,
  });

  // 4. 开始训练
  session.startTraining();

  // 5. 切换到训练 UI
  uiManager.showTraining();

  console.log('[App] 训练已开始');
}

// =========================================================================
// 训练流程
// =========================================================================

/**
 * 训练期间的 landmarks 回调
 *
 * @param {Array|null} landmarks
 */
function handleTrainingLandmarks(landmarks) {
  if (!landmarks || !detector || !session) return;

  // 检测器处理
  const result = detector.processFrame(landmarks);

  // 调度给 SessionManager
  session.handleDetectionResult(result);

  // 低置信度 / 摔倒警告转发到 UI
  if (result.status === 'LOW_CONFIDENCE') {
    uiManager.showLowConfidenceWarning(result.reason);
  } else if (result.status === 'FALL_DETECTED') {
    uiManager.showFallWarning();
  }
}

/**
 * Session 状态变更回调
 *
 * @param {string} newState
 * @param {string} oldState
 * @param {Object} [extra]
 */
function handleSessionStateChange(newState, oldState, extra) {
  console.log(`[App] 会话状态: ${oldState} → ${newState}`);

  if (extra) {
    // 处理特殊警告事件
    if (extra.alert === 'lowConfidence') {
      uiManager.showLowConfidenceWarning(extra.reason);
      return;
    }
    if (extra.alert === 'fallDetected') {
      uiManager.showFallWarning();
      return;
    }
  }
}

/**
 * 步数更新回调
 *
 * @param {number} totalSteps
 * @param {number} streakCount
 */
function handleStepCountUpdate(totalSteps, streakCount) {
  // 计算饥饿值（陪伴之旅用）
  let hunger = 0;
  if (selectedGameId === 'companion' && game) {
    hunger = Math.min(100, totalSteps * 5); // HUNGER_PER_STEP = 5
  }

  uiManager.updateHUD({
    steps: totalSteps,
    streak: streakCount,
    hunger: selectedGameId === 'companion' ? hunger : undefined,
  });
}

// =========================================================================
// 休息流程
// =========================================================================

/**
 * 治疗师点击"休息"
 */
function handleStartRest() {
  if (!session) return;

  console.log('[App] 进入休息模式');
  session.startRest();
  uiManager.showRest();

  // 低置信度警告可能残留，清除
  uiManager.hideLowConfidenceWarning();
}

/**
 * 儿童点击"继续"
 */
function handleEndRest() {
  if (!session) return;

  console.log('[App] 退出休息模式');
  session.endRest();
  uiManager.showTraining();
}

// =========================================================================
// 结束流程
// =========================================================================

/**
 * 治疗师点击"结束训练"
 */
function handleEndSession() {
  if (!session) return;

  console.log('[App] 结束训练');

  // 获取训练总结
  const summary = session.endSession();

  // 保存到 localStorage
  LocalStore.saveSessionSummary(summary);
  LocalStore.addTotalSteps(summary.totalSteps || 0);

  // 保存场景进度（陪伴之旅）
  if (selectedGameId === 'companion') {
    const totalAccumSteps = LocalStore.getTotalSteps();
    if (totalAccumSteps >= 100) {
      LocalStore.saveScene('space');
    } else if (totalAccumSteps >= 50) {
      LocalStore.saveScene('beach');
    }
  }

  // 停止 MediaPipe
  if (mediapipe) {
    mediapipe.stop();
  }

  // 停止摄像头
  if (camera) {
    camera.stop();
    camera = null;
  }

  // 销毁游戏
  if (game) {
    game.destroy();
    game = null;
  }

  // 显示总结界面
  uiManager.showSessionSummary(summary);

  session = null;
}

// =========================================================================
// 启动
// =========================================================================

bootstrap().catch((err) => {
  console.error('[快乐康复指导] 启动失败:', err);

  const app = document.getElementById('app');
  if (app) {
    app.innerHTML = `
      <div style="
        display: flex; align-items: center; justify-content: center;
        height: 100%; color: #F472B6; font-size: 20px;
        background: #0f0f23; text-align: center; padding: 40px;
      ">
        <p>应用启动失败，请刷新页面或检查网络连接。</p>
      </div>
    `;
  }
});
