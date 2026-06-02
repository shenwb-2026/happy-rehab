// 快乐康复指导 · 第一周髋关节信号处理检测器（规格书 7.2 节）
// 基于痉挛性双瘫步态临床特征：以髋关节左右摆动为主要信号，
// 膝关节高度差为辅助验证信号，无需标注训练数据。

import { DetectorInterface } from './DetectorInterface.js';
import { DETECTION_CONFIG } from '../config.js';

// MediaPipe 关键点索引
const LM = {
  LEFT_SHOULDER:  11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP:       23,
  RIGHT_HIP:      24,
  LEFT_KNEE:      25,
  RIGHT_KNEE:     26,
};

class SignalDetector extends DetectorInterface {
  constructor() {
    super();
    // 校准参数
    this.neutralX      = null;
    this.shoulderWidth = null;
    this.baselineTremor = null;
    this.standingHipY  = null;

    // 内部状态
    this._smoothBuf    = [];  // 髋关节水平中点滚动平均缓冲区
    this._hipHistory   = [];  // { x, timestamp } 平滑后历史
    this._kneeHistory  = [];  // { leftKneeY, rightKneeY, timestamp }
    this._pendingPeak  = null; // 待辅助信号确认的峰值 { direction, timestamp }
    this._lastStepTime = 0;
    this._lastSide     = null;
    this._lowConfFrames = 0;
  }

  setCalibration(params) {
    this.neutralX       = params.hipNeutralX;
    this.shoulderWidth  = params.shoulderWidthPx;
    this.baselineTremor = params.baselineTremorAmplitude;
    this.standingHipY   = params.standingHipY;
  }

  reset() {
    this._smoothBuf     = [];
    this._hipHistory    = [];
    this._kneeHistory   = [];
    this._pendingPeak   = null;
    this._lastStepTime  = 0;
    this._lastSide      = null;
    this._lowConfFrames = 0;
  }

  /**
   * 逐帧检测（规格书 7.2 节完整流程）
   * @param {Array} landmarks - MediaPipe 33 个归一化关键点
   * @returns {DetectorResult}
   */
  processFrame(landmarks) {
    if (!Array.isArray(landmarks) || landmarks.length < 27) {
      return { status: 'NO_STEP' };
    }

    const now = Date.now();
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];

    // ── 1. 置信度检查 ──────────────────────────────────────
    const hipVis = Math.min(lh?.visibility ?? 0, rh?.visibility ?? 0);
    if (hipVis < DETECTION_CONFIG.keyPointConfidenceMin) {
      this._lowConfFrames++;
      if (this._lowConfFrames >= DETECTION_CONFIG.lowConfidenceFrameThreshold) {
        return { status: 'LOW_CONFIDENCE', reason: '髋关节关键点置信度不足，请调整摄像头位置' };
      }
      return { status: 'NO_STEP' };
    }
    this._lowConfFrames = 0;

    // ── 2. 提取信号 ────────────────────────────────────────
    const midX = (lh.x + rh.x) / 2;
    const hipY = (lh.y + rh.y) / 2;

    // 记录膝关节高度（辅助信号）
    if ((lk?.visibility ?? 0) >= DETECTION_CONFIG.keyPointConfidenceMin &&
        (rk?.visibility ?? 0) >= DETECTION_CONFIG.keyPointConfidenceMin) {
      this._kneeHistory.push({ leftKneeY: lk.y, rightKneeY: rk.y, timestamp: now });
      // 只保留辅助验证窗口内的数据
      const win = DETECTION_CONFIG.auxiliaryValidationWindowMs;
      this._kneeHistory = this._kneeHistory.filter(e => now - e.timestamp <= win);
    }

    // ── 3. 低通滤波（8帧滚动平均）──────────────────────────
    this._smoothBuf.push(midX);
    if (this._smoothBuf.length > DETECTION_CONFIG.smoothingFrames) {
      this._smoothBuf.shift();
    }
    const smoothX = this._smoothBuf.reduce((s, v) => s + v, 0) / this._smoothBuf.length;

    this._hipHistory.push({ x: smoothX, timestamp: now });
    this._pruneHipHistory(now);

    // ── 4. 摔倒检测（MVP 阶段不生效，补充决策 3）──────────
    // fallDetectionRatio 参数保留，此处跳过实际判断

    // ── 5. 校准参数就绪检查 ────────────────────────────────
    if (this.neutralX === null || this.shoulderWidth === null || this.shoulderWidth <= 0) {
      return { status: 'NO_STEP' };
    }

    // ── 6. 处理待确认峰值：在辅助信号窗口内等待膝关节确认 ──
    if (this._pendingPeak) {
      const elapsed = now - this._pendingPeak.timestamp;
      if (elapsed <= DETECTION_CONFIG.auxiliaryValidationWindowMs) {
        // 检查辅助信号是否在此期间出现
        if (this._verifyKneeSignal(this._pendingPeak.direction)) {
          return this._emitStep(this._pendingPeak.direction, now);
        }
      } else {
        // 超时未确认，宽松地直接发出步数（提高召回率）
        const pending = this._pendingPeak;
        this._pendingPeak = null;
        return this._emitStep(pending.direction, now);
      }
    }

    // ── 7. 峰值检测 ────────────────────────────────────────
    const peak = this._detectPeak(smoothX, now);
    if (!peak) return { status: 'NO_STEP' };

    const { direction } = peak;

    // ── 8. 最小步间隔 ──────────────────────────────────────
    if (this._lastStepTime > 0 && now - this._lastStepTime < DETECTION_CONFIG.minStepIntervalMs) {
      return { status: 'NO_STEP' };
    }

    // ── 9. 跨中线验证（同侧合并） ──────────────────────────
    if (this._lastSide === direction) {
      const lastT = this._getLastPeakTime(direction);
      if (lastT && now - lastT < DETECTION_CONFIG.crosslineTimeWindowMs) {
        return { status: 'NO_STEP' }; // 同侧合并
      }
    }

    // ── 10. 辅助信号验证 ───────────────────────────────────
    if (this._verifyKneeSignal(direction)) {
      return this._emitStep(direction, now);
    }

    // 辅助信号暂无，挂起等待
    this._pendingPeak = { direction, timestamp: now };
    return { status: 'NO_STEP' };
  }

  // ── 峰值检测 ──────────────────────────────────────────────

  _detectPeak(smoothX, now) {
    if (this.shoulderWidth <= 0 || this._hipHistory.length < 3) return null;

    const len  = this._hipHistory.length;
    const cur  = this._hipHistory[len - 1];
    const prev = this._hipHistory[len - 2];
    const pp   = this._hipHistory[len - 3];

    const disp     = Math.abs(cur.x  - this.neutralX) / this.shoulderWidth;
    const prevDisp = Math.abs(prev.x - this.neutralX) / this.shoulderWidth;
    const ppDisp   = Math.abs(pp.x   - this.neutralX) / this.shoulderWidth;

    // 振幅约束
    if (prevDisp < DETECTION_CONFIG.hipSwingThresholdMin ||
        prevDisp > DETECTION_CONFIG.hipSwingThresholdMax) return null;

    // 局部极大值：前一帧 >= 前两帧 且 >= 当前帧
    if (prevDisp < ppDisp || prevDisp < disp) return null;

    // 峰值持续时间约束（过滤震颤）
    const peakStart = this._findPeakStart(prev.timestamp);
    if (now - peakStart < DETECTION_CONFIG.peakDurationMinMs) return null;

    // 判断方向
    const direction = prev.x > this.neutralX ? 'right' : 'left';
    return { direction };
  }

  _findPeakStart(peakTs) {
    let start = peakTs;
    for (let i = this._hipHistory.length - 1; i >= 0; i--) {
      const e = this._hipHistory[i];
      const d = Math.abs(e.x - this.neutralX) / this.shoulderWidth;
      if (d < DETECTION_CONFIG.hipSwingThresholdMin) break;
      start = e.timestamp;
    }
    return start;
  }

  _getLastPeakTime(direction) {
    for (let i = this._hipHistory.length - 1; i >= 0; i--) {
      const e = this._hipHistory[i];
      const d = Math.abs(e.x - this.neutralX) / this.shoulderWidth;
      if (d >= DETECTION_CONFIG.hipSwingThresholdMin) {
        const dir = e.x > this.neutralX ? 'right' : 'left';
        if (dir === direction) return e.timestamp;
      }
    }
    return null;
  }

  // ── 辅助信号验证（膝关节高度差） ─────────────────────────

  _verifyKneeSignal(direction) {
    if (this._kneeHistory.length < 2) return true; // 无数据则默认通过

    const recent = this._kneeHistory.slice(-4); // 最近 4 帧
    // 计算左右膝高度差的变化范围
    const diffs = recent.map(e => e.leftKneeY - e.rightKneeY);
    const minD  = Math.min(...diffs);
    const maxD  = Math.max(...diffs);
    const range = maxD - minD;

    // 噪声阈值：基线震颤的 2 倍，或默认 0.015
    const noiseThreshold = this.baselineTremor ? this.baselineTremor * 2 : 0.015;

    // 膝关节高度差需有足够变化幅度
    return range > noiseThreshold;
  }

  // ── 工具方法 ──────────────────────────────────────────────

  _emitStep(direction, now) {
    this._lastStepTime = now;
    this._lastSide     = direction;
    this._pendingPeak  = null;
    return { status: 'STEP', timestamp: now, side: direction };
  }

  _pruneHipHistory(now) {
    const keep = DETECTION_CONFIG.peakReturnWindowMs * 2 + 1000;
    this._hipHistory = this._hipHistory.filter(e => now - e.timestamp <= keep);
  }
}

export { SignalDetector };
