// 快乐康复指导 · 应用主入口
// 连接所有模块，管理训练完整生命周期。
// 流程：idle → calibrating → gameSelect → training ⇄ rest → ended

import './styles/global.css';
import { CAMERA_CONFIG, CALIBRATION_CONFIG } from './config.js';
import { SoundEngine }    from './audio/audio.js';
import { UIManager }      from './ui/ui-manager.js';
import { CameraManager }  from './core/camera.js';
import { MediaPipeManager } from './core/mediapipe.js';
import { SignalDetector } from './detection/SignalDetector.js';
import { SessionManager } from './core/session.js';
import { BubblePop }      from './games/BubblePop/BubblePop.js';
import { CompanionJourney } from './games/CompanionJourney/CompanionJourney.js';
import { LocalStore }     from './storage/localstore.js';

// ── 全局模块引用 ──────────────────────────────────────────────
let sound    = null;
let ui       = null;
let camera   = null;
let mediapipe = null;
let detector = null;
let session  = null;
let game     = null;
let canvas   = null;

// 校准采集缓冲
let _calibSamples  = [];
let _isCollecting  = false;
let _calibTimers   = [];

// ── 应用启动 ──────────────────────────────────────────────────
async function bootstrap() {
  canvas = document.getElementById('main-canvas');
  if (!canvas) throw new Error('找不到 #main-canvas');

  _resizeCanvas();
  window.addEventListener('resize',            _resizeCanvas);
  window.addEventListener('orientationchange', () => setTimeout(_resizeCanvas, 200));

  sound    = new SoundEngine();
  detector = new SignalDetector();

  // 尝试加载已保存的校准参数
  const saved = LocalStore.getCalibration();
  if (saved) detector.setCalibration(saved);

  session = new SessionManager({
    detector,
    onStateChange: _onStateChange,
    onStepCount:   _onStepCount,
  });

  ui = new UIManager({
    onStartCalibration: _handleStartCalibration,
    onGameSelected:     _handleGameSelected,
    onStartRest:        _handleStartRest,
    onEndRest:          _handleEndRest,
    onEndSession:       _handleEndSession,
    onAgain:            _handleAgain,
  });

  // 初始界面：直接显示校准
  ui.showCalibration();

  console.log('[HRG] 启动完成');
}

function _resizeCanvas() {
  const app = document.getElementById('app');
  if (!app || !canvas) return;
  const W = app.clientWidth, H = app.clientHeight;
  const scale = Math.min(W / CAMERA_CONFIG.width, H / CAMERA_CONFIG.height);
  canvas.width  = Math.round(CAMERA_CONFIG.width  * scale);
  canvas.height = Math.round(CAMERA_CONFIG.height * scale);
  canvas.style.width  = canvas.width  + 'px';
  canvas.style.height = canvas.height + 'px';
}

// ── 校准流程 ──────────────────────────────────────────────────

async function _handleStartCalibration() {
  console.log('[HRG] 开始校准');
  sound?._ensureContext?.(); // 触发 AudioContext（用户交互时）

  try {
    camera    = new CameraManager();
    const video = await camera.start();

    ui.updateCalibrationPreview(camera.stream);

    mediapipe = new MediaPipeManager({
      onLandmarks: _onCalibLandmarks,
      onError: err => console.error('[MediaPipe]', err.message),
    });
    await mediapipe.initialize();
    mediapipe.start(video);

    session.startCalibration();

    // 倒计时 3 秒提示
    let countdown = Math.ceil(CALIBRATION_CONFIG.promptDurationMs / 1000);
    ui.showCalibrationCountdown(countdown);

    const countInterval = setInterval(() => {
      countdown--;
      if (countdown > 0) {
        ui.showCalibrationCountdown(countdown);
      } else {
        clearInterval(countInterval);
        ui.hideCalibrationCountdown();
        // 开始采集
        _calibSamples  = [];
        _isCollecting  = true;

        const collectTimer = setTimeout(() => {
          _isCollecting = false;
          _finishCalibration();
        }, CALIBRATION_CONFIG.collectDurationMs);
        _calibTimers.push(collectTimer);
      }
    }, 1000);
    _calibTimers.push(countInterval);

  } catch (err) {
    console.error('[HRG] 校准启动失败:', err.message);
    alert(`校准启动失败：${err.message}`);
  }
}

function _onCalibLandmarks(landmarks) {
  if (!landmarks) return;
  ui.updateConfidenceIndicators(landmarks);
  if (!_isCollecting) return;

  const lh = landmarks[23], rh = landmarks[24];
  const ls = landmarks[11], rs = landmarks[12];
  if (!lh || !rh || !ls || !rs) return;
  if (lh.visibility < 0.5 || rh.visibility < 0.5) return;
  if (ls.visibility < 0.5 || rs.visibility < 0.5) return;

  _calibSamples.push({
    midX:           (lh.x + rh.x) / 2,
    shoulderWidthN: Math.abs(ls.x - rs.x),
    hipY:           (lh.y + rh.y) / 2,
  });
}

function _finishCalibration() {
  if (_calibSamples.length < 5) {
    // 样本不足，使用保守默认值
    _applyCalibration({ hipNeutralX: 0.5, shoulderWidthPx: 100, baselineTremorAmplitude: 0.005, standingHipY: 0.65 });
    return;
  }

  const n = _calibSamples.length;
  const avgMidX    = _calibSamples.reduce((s,v) => s + v.midX,           0) / n;
  const avgShoulder = _calibSamples.reduce((s,v) => s + v.shoulderWidthN, 0) / n;
  const avgHipY    = _calibSamples.reduce((s,v) => s + v.hipY,           0) / n;

  const variance = _calibSamples.reduce((s,v) => s + (v.midX - avgMidX) ** 2, 0) / n;
  const tremor   = Math.sqrt(variance);

  const videoW   = camera?.getVideoElement()?.videoWidth ?? 1376;
  const shoulderPx = Math.round(avgShoulder * videoW);

  _applyCalibration({
    hipNeutralX:             avgMidX,
    shoulderWidthPx:         shoulderPx,
    baselineTremorAmplitude: tremor,
    standingHipY:            avgHipY,
  });
}

function _applyCalibration(params) {
  console.log('[HRG] 校准参数:', params);
  session.setCalibration(params);
  LocalStore.saveCalibration(params);
  ui.showCalibrationReady({ shoulderWidth: params.shoulderWidthPx });

  // 绑定"开始训练"按钮到 enterGameSelect
  const btnTrain = document.getElementById('btn-start-training');
  if (btnTrain) {
    // 移除旧监听后重新绑定，避免重复
    const handler = () => _enterGameSelect();
    btnTrain.replaceWith(btnTrain.cloneNode(true));
    document.getElementById('btn-start-training').addEventListener('click', handler);
  }
}

// ── 游戏选择 ──────────────────────────────────────────────────

function _enterGameSelect() {
  // 切换 mediapipe 回调：gameSelect 期间继续运行但忽略结果
  if (mediapipe) mediapipe.onLandmarks = () => {};
  session.enterGameSelect();
  ui.showGameSelection();
}

function _handleGameSelected(gameId) {
  console.log('[HRG] 游戏选择:', gameId);
  sound?._ensureContext?.();

  if (gameId === 'bubble') {
    game = new BubblePop(canvas, sound);
  } else {
    game = new CompanionJourney(canvas, sound);
  }

  session.setGame(game);

  // 切换 mediapipe 回调到训练模式
  if (mediapipe) mediapipe.onLandmarks = _onTrainingLandmarks;

  session.startTraining();
  ui.showTraining();
}

// ── 训练流程 ──────────────────────────────────────────────────

function _onTrainingLandmarks(landmarks) {
  if (!landmarks || !session) return;
  const result = detector.processFrame(landmarks);
  session.handleDetectionResult(result);

  if (result.status === 'LOW_CONFIDENCE') {
    ui.showLowConfidenceWarning(result.reason);
  }
}

function _onStateChange(newState, oldState, extra) {
  if (extra?.alert === 'lowConfidence') {
    ui.showLowConfidenceWarning(extra.reason);
  }
}

function _onStepCount(totalSteps, streak) {
  ui.updateHUD({ steps: totalSteps, streak });
}

// ── 休息流程 ──────────────────────────────────────────────────

function _handleStartRest() {
  session.startRest();
  ui.showRest();
  ui.hideLowConfidenceWarning();
}

function _handleEndRest() {
  session.endRest();
  ui.showTraining();
}

// ── 结束流程 ──────────────────────────────────────────────────

function _handleEndSession() {
  const summary = session.endSession();

  LocalStore.saveSessionSummary(summary);
  LocalStore.addTotalSteps(summary.totalSteps ?? 0);

  // 停止 mediapipe 和摄像头
  mediapipe?.stop();
  camera?.stop();
  camera = null;

  // 销毁游戏
  game?.destroy();
  game = null;

  // 清空计时器
  _calibTimers.forEach(t => { clearTimeout(t); clearInterval(t); });
  _calibTimers = [];

  ui.showSessionSummary(summary);
}

function _handleAgain() {
  // 重置会话，回到校准界面
  if (session) {
    session = new SessionManager({
      detector,
      onStateChange: _onStateChange,
      onStepCount:   _onStepCount,
    });
    const saved = LocalStore.getCalibration();
    if (saved) {
      detector.setCalibration(saved);
      session.startCalibration();
      session.enterGameSelect();
      ui.showGameSelection();
    } else {
      ui.showCalibration();
    }
  } else {
    ui.showCalibration();
  }
}

// ── 启动 ──────────────────────────────────────────────────────
bootstrap().catch(err => {
  console.error('[HRG] 启动失败:', err);
  const app = document.getElementById('app');
  if (app) {
    app.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;
        height:100%;color:#FFD93D;font-size:22px;background:#0a001a;
        text-align:center;padding:40px;">
        <p>应用启动失败，请刷新页面重试。<br><small>${err.message}</small></p>
      </div>`;
  }
});
