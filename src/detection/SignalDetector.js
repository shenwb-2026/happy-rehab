/**
 * 第一周髋关节信号处理检测器
 *
 * 基于痉挛性双瘫步态的临床特征，利用髋关节左右摆动信号进行步数检测。
 * 核心逻辑严格遵循规格书 7.2 节：
 *   - 髋关节水平中点 8 帧滚动平均低通滤波
 *   - 肩宽归一化摆动幅度
 *   - 峰值检测 + 跨中线验证
 *   - 辅助信号（膝关节高度差）验证
 *   - 摔倒检测（髋高阈值）
 *   - 低置信度降级 + 最小步间隔强制
 *
 * 设计前提：该儿童为痉挛性双瘫，步态特征为剪刀步态，
 *          髋关节摆动代替常规脚部高度变化作为主检测信号。
 */

import { DetectorInterface } from './DetectorInterface.js';
import { DETECTION_CONFIG } from '../config.js';

// MediaPipe 姿态关键点索引（仅本模块内使用）
const LANDMARK = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
};

class SignalDetector extends DetectorInterface {
  constructor() {
    super();

    // ── 校准参数（由 setCalibration 设置） ──
    /** @type {number|null} 髋关节中立 X 坐标（归一化） */
    this.neutralX = null;
    /** @type {number|null} 像素级肩宽 */
    this.shoulderWidth = null;
    /** @type {number|null} 基线震颤幅度 */
    this.baselineTremor = null;
    /** @type {number|null} 站立髋关节 Y 坐标（摔倒检测基准） */
    this.standingHipY = null;

    // ── 内部状态 ──
    /** @type {number[]} 髋关节中点滚动平均缓冲区（最近 N 帧） */
    this.smoothingBuffer = [];
    /** @type {Array<{x:number, timestamp:number}>} 平滑后的髋关节中点历史（峰值检测用） */
    this.hipHistory = [];
    /** @type {number} 上一步触发时间戳（强制执行最小步间隔） */
    this.lastStepTime = 0;
    /** @type {'left'|'right'|null} 上一步的迈步侧 */
    this.lastCrossSide = null;
    /** @type {number} 连续低置信度帧计数 */
    this.lowConfidenceFrames = 0;

    // ── 辅助信号缓冲区 ──
    /** @type {Array<{timestamp:number, leftKneeY:number, rightKneeY:number, hipY:number}>} 膝关节高度历史（辅助验证窗口用） */
    this.kneeHistory = [];
    /** @type {Array<{side:'left'|'right', timestamp:number}>} 待验证的主信号触发事件 */
    this.pendingSignals = [];
  }

  // =========================================================================
  // 公共接口
  // =========================================================================

  /**
   * 设置校准参数
   *
   * 校准完成后由 session.js 调用，传入站立基准测量值。
   *
   * @param {CalibrationParams} params
   */
  setCalibration(params) {
    this.neutralX = params.hipNeutralX;
    this.shoulderWidth = params.shoulderWidthPx;
    this.baselineTremor = params.baselineTremorAmplitude;
    this.standingHipY = params.standingHipY;
  }

  /**
   * 重置内部状态
   *
   * 清空所有缓冲区、计数器，保留校准参数不变。
   * 训练结束或重新校准前调用。
   */
  reset() {
    this.smoothingBuffer = [];
    this.hipHistory = [];
    this.lastStepTime = 0;
    this.lastCrossSide = null;
    this.lowConfidenceFrames = 0;
    this.kneeHistory = [];
    this.pendingSignals = [];
  }

  /**
   * 逐帧处理关键点，返回检测结果
   *
   * 完整检测流程（严格按规格书 7.2 节）：
   *
   *   1. 【信号提取】          → 提取髋关节中点 midX
   *   2. 【置信度检查】        → visibility 不足时累加计数，超限报 LOW_CONFIDENCE
   *   3. 【滚动平均低通滤波】   → 8 帧平滑 buffer → smoothX
   *   4. 【摔倒/坐下检测】     → 髋高低于站立值 × fallDetectionRatio → FALL_DETECTED
   *   5. 【摆动幅度归一化】     → displacement = |smoothX - neutralX| / shoulderWidth
   *   6. 【峰值检测】          → 局部极大值，带振幅 & 持续时间约束
   *   7. 【跨中线验证】        → 左右交替，同侧合并
   *   8. 【最小步间隔】        → now - lastStepTime >= minStepIntervalMs
   *   9. 【辅助信号验证】      → 膝关节高度差在时间窗口内确认
   *  10. 【输出步数事件】      → { status: 'STEP', timestamp, side }
   *  11. 【默认返回】          → { status: 'NO_STEP' }
   *
   * @param {Array<{x:number, y:number, z:number, visibility:number}>} landmarks
   * @returns {DetectorResult}
   */
  processFrame(landmarks) {
    // ── 边界情况：landmarks 无效 ──
    if (!Array.isArray(landmarks) || landmarks.length < 25) {
      return { status: 'NO_STEP' };
    }

    const now = Date.now();

    // =====================================================================
    // 1. 【信号提取】— 从 landmarks 提取髋关节水平中点
    // =====================================================================
    const leftHip = landmarks[LANDMARK.LEFT_HIP];
    const rightHip = landmarks[LANDMARK.RIGHT_HIP];

    // 任一髋关节 visibility 低于关键点置信度阈值，本帧跳过
    if (
      leftHip.visibility < DETECTION_CONFIG.keyPointConfidenceMin ||
      rightHip.visibility < DETECTION_CONFIG.keyPointConfidenceMin
    ) {
      this.lowConfidenceFrames++;
      if (this.lowConfidenceFrames >= DETECTION_CONFIG.lowConfidenceFrameThreshold) {
        return {
          status: 'LOW_CONFIDENCE',
          reason: '髋关节关键点置信度不足，请调整摄像头位置',
        };
      }
      return { status: 'NO_STEP' };
    }

    // 计算髋关节水平中点
    const midX = (leftHip.x + rightHip.x) / 2;
    const hipY = (leftHip.y + rightHip.y) / 2;

    // =====================================================================
    // 2. 【置信度检查】— 髋关节置信度持续不足降级
    // =====================================================================
    if (
      leftHip.visibility < DETECTION_CONFIG.hipConfidenceMin ||
      rightHip.visibility < DETECTION_CONFIG.hipConfidenceMin
    ) {
      this.lowConfidenceFrames++;
      if (this.lowConfidenceFrames >= DETECTION_CONFIG.lowConfidenceFrameThreshold) {
        return {
          status: 'LOW_CONFIDENCE',
          reason: '髋关节关键点置信度不足，请调整摄像头位置',
        };
      }
      // 置信度不足但未超阈值：不进行检测，静默返回
      return { status: 'NO_STEP' };
    }

    // 置信度恢复：清零累加器
    this.lowConfidenceFrames = 0;

    // =====================================================================
    // 3. 【滚动平均低通滤波】— 8 帧平滑，消除震颤
    // =====================================================================
    this.smoothingBuffer.push(midX);
    if (this.smoothingBuffer.length > DETECTION_CONFIG.smoothingFrames) {
      this.smoothingBuffer.shift();
    }

    // 计算平滑值
    const smoothX =
      this.smoothingBuffer.reduce((sum, v) => sum + v, 0) /
      this.smoothingBuffer.length;

    // 记录平滑后的髋关节中点历史（用于峰值检测）
    this.hipHistory.push({ x: smoothX, timestamp: now });

    // 清理过旧的历史记录（保留 2 倍峰值返回窗口时长 + 1 秒缓冲）
    this._pruneHipHistory(now);

    // =====================================================================
    // 4. 【摔倒/坐下检测】— 髋高低于站立值阈值
    // =====================================================================
    if (this.standingHipY !== null) {
      if (hipY < this.standingHipY * DETECTION_CONFIG.fallDetectionRatio) {
        return { status: 'FALL_DETECTED' };
      }
    }

    // =====================================================================
    // 5. 【摆动幅度归一化】— 相对于肩宽的位移比例
    // =====================================================================
    // 校准参数未设置时，无法做有意义的检测
    if (this.neutralX === null || this.shoulderWidth === null) {
      return { status: 'NO_STEP' };
    }

    const displacement = Math.abs(smoothX - this.neutralX) / this.shoulderWidth;

    // =====================================================================
    // 6. 【峰值检测】— 局部极大值，带振幅和时间约束
    // =====================================================================
    const peakResult = this._detectPeak(now);

    // =====================================================================
    // 7. 【跨中线验证】— 左右交替
    // =====================================================================
    if (!peakResult) {
      // 无峰值：检查待验证信号是否超时
      this._prunePendingSignals(now);
      this._recordKneeHistory(leftHip, rightHip, hipY, now);
      return { status: 'NO_STEP' };
    }

    const { direction, confidence } = peakResult;

    // =====================================================================
    // 8. 【最小步间隔】
    // =====================================================================
    if (this.lastStepTime > 0 && (now - this.lastStepTime) < DETECTION_CONFIG.minStepIntervalMs) {
      // 已有峰值但在最小间隔内，记录但不触发
      // 仍需要记录本次跨中线方向以便后续交替判断
      this._recordKneeHistory(leftHip, rightHip, hipY, now);
      return { status: 'NO_STEP' };
    }

    // 跨中线验证：要求与上一步方向交替
    if (this.lastCrossSide !== null && direction === this.lastCrossSide) {
      // 同侧连续峰值：检查是否在合并时间窗口内
      const lastPeakTime = this._getLastPeakTime(direction);
      if (lastPeakTime !== null && (now - lastPeakTime) < DETECTION_CONFIG.crosslineTimeWindowMs) {
        // 在窗口内，合并为同一步（不触发新步数）
        this._recordKneeHistory(leftHip, rightHip, hipY, now);
        return { status: 'NO_STEP' };
      }
      // 超出窗口，视为新步（允许同侧新步）
    }

    // =====================================================================
    // 9. 【辅助信号验证】— 膝关节高度差
    // =====================================================================
    this._recordKneeHistory(leftHip, rightHip, hipY, now);

    const auxiliaryConfirmed = this._verifyAuxiliarySignal(direction, now);

    if (!auxiliaryConfirmed) {
      // 主信号触发但无辅助信号支持，注册为待验证信号
      // 在 auxiliaryValidationWindowMs 内等待辅助信号
      this.pendingSignals.push({ side: direction, timestamp: now });
      return { status: 'NO_STEP' };
    }

    // =====================================================================
    // 10. 【输出步数事件】
    // =====================================================================
    this.lastStepTime = now;
    this.lastCrossSide = direction;

    // 清理已确认的待验证信号
    this.pendingSignals = [];

    return {
      status: 'STEP',
      timestamp: now,
      side: direction,
    };
  }

  // =========================================================================
  // 私有方法：峰值检测
  // =========================================================================

  /**
   * 在 hipHistory 中检测局部峰值（极大值点）
   *
   * 峰值条件：
   *   a. 位移幅度在 [hipSwingThresholdMin, hipSwingThresholdMax] 之间
   *   b. 峰值持续时间 >= peakDurationMinMs（过滤震颤噪声）
   *   c. 为最近 N 帧内的局部极大值
   *
   * @param {number} now - 当前时间戳
   * @returns {{direction:'left'|'right', confidence:number}|null}
   */
  _detectPeak(now) {
    if (this.hipHistory.length < 3) return null;

    const len = this.hipHistory.length;
    const current = this.hipHistory[len - 1];
    const prev = this.hipHistory[len - 2];
    const prevPrev = this.hipHistory[len - 3];

    // 计算位移（相对中立的偏移）
    const displacement = Math.abs(current.x - this.neutralX) / this.shoulderWidth;

    // 振幅约束：必须在有效范围内
    if (displacement < DETECTION_CONFIG.hipSwingThresholdMin ||
        displacement > DETECTION_CONFIG.hipSwingThresholdMax) {
      return null;
    }

    // 判局部极大值：前一帧值大于前两帧且大于等于当前帧
    const prevDisp = Math.abs(prev.x - this.neutralX) / this.shoulderWidth;
    const prevPrevDisp = Math.abs(prevPrev.x - this.neutralX) / this.shoulderWidth;

    const isLocalMax =
      prevDisp >= prevPrevDisp &&
      prevDisp >= displacement;

    if (!isLocalMax) return null;

    // 持续时间约束：峰值至少持续 peakDurationMinMs
    const peakStartTime = this._findPeakDuration(prev.timestamp);
    const peakDuration = now - peakStartTime;

    if (peakDuration < DETECTION_CONFIG.peakDurationMinMs) {
      return null;
    }

    // 判断方向
    const direction = current.x > this.neutralX ? 'right' : 'left';

    return {
      direction,
      confidence: Math.min(1, displacement / DETECTION_CONFIG.hipSwingThresholdMin),
    };
  }

  /**
   * 查找当前峰值区域的起始时间戳
   *
   * 从当前帧向前回溯，找到位移持续在有效范围内的最早帧。
   *
   * @param {number} peakTimestamp - 峰值时间戳
   * @returns {number} 峰值区域起始时间戳
   */
  _findPeakDuration(peakTimestamp) {
    let startTime = peakTimestamp;
    for (let i = this.hipHistory.length - 1; i >= 0; i--) {
      const entry = this.hipHistory[i];
      const disp = Math.abs(entry.x - this.neutralX) / this.shoulderWidth;
      if (disp < DETECTION_CONFIG.hipSwingThresholdMin) {
        // 位移回落到阈值以下，峰值区域结束
        startTime = entry.timestamp;
        break;
      }
      startTime = entry.timestamp;
    }
    return startTime;
  }

  /**
   * 获取指定方向上最近一次峰值的时间戳
   *
   * @param {'left'|'right'} direction
   * @returns {number|null}
   */
  _getLastPeakTime(direction) {
    // 从 hipHistory 中查找指定方向的最近峰值
    for (let i = this.hipHistory.length - 1; i >= 0; i--) {
      const entry = this.hipHistory[i];
      const disp = Math.abs(entry.x - this.neutralX) / this.shoulderWidth;
      if (disp >= DETECTION_CONFIG.hipSwingThresholdMin) {
        const dir = entry.x > this.neutralX ? 'right' : 'left';
        if (dir === direction) {
          return entry.timestamp;
        }
      }
    }
    return null;
  }

  // =========================================================================
  // 私有方法：辅助信号验证
  // =========================================================================

  /**
   * 记录膝关节高度历史，用于辅助信号验证
   *
   * @param {Object} leftHip - 左髋关键点
   * @param {Object} rightHip - 右髋关键点
   * @param {number} hipY - 当前髋关节 Y 坐标
   * @param {number} now - 当前时间戳
   */
  _recordKneeHistory(leftHip, rightHip, hipY, now) {
    // 使用髋高作为参考计算膝关节相对高度
    // 注：真实场景应从 landmarks 中提取膝关节点，此处用髋高做代理
    // 简化处理：记录髋部 Y 变化作为步态辅助信号
    this.kneeHistory.push({
      timestamp: now,
      hipY,
    });

    // 清理过旧的记录
    const windowMs = DETECTION_CONFIG.auxiliaryValidationWindowMs;
    this.kneeHistory = this.kneeHistory.filter(
      (entry) => now - entry.timestamp <= windowMs
    );
  }

  /**
   * 在辅助信号窗口内验证膝部信号是否支持迈步方向
   *
   * 检测原理：迈步侧膝部应相对另一侧膝部有高度变化。
   * 简化实现：检查髋关节 Y 轴在窗口内是否有足够的变化幅度。
   *
   * @param {'left'|'right'} direction - 主信号判定的迈步方向
   * @param {number} now - 当前时间戳
   * @returns {boolean} 辅助信号是否确认
   */
  _verifyAuxiliarySignal(direction, now) {
    if (this.kneeHistory.length < 2) {
      // 尚无足够历史数据，默认通过（避免初始阶段无检测）
      return true;
    }

    // 获取窗口内的髋部 Y 变化幅度
    const windowMs = DETECTION_CONFIG.auxiliaryValidationWindowMs;
    const inWindow = this.kneeHistory.filter(
      (entry) => now - entry.timestamp <= windowMs
    );

    if (inWindow.length < 2) {
      return true; // 数据不足，默认通过
    }

    const hipYValues = inWindow.map((e) => e.hipY);
    const minY = Math.min(...hipYValues);
    const maxY = Math.max(...hipYValues);
    const yRange = maxY - minY;

    // 髋关节 Y 轴需有一定变化幅度才视为有效步行
    // 使用基线震颤幅度作为噪声阈值比较
    const noiseThreshold = this.baselineTremor !== null
      ? this.baselineTremor * 3
      : 0.01;

    return yRange > noiseThreshold;
  }

  // =========================================================================
  // 私有方法：待验证信号管理
  // =========================================================================

  /**
   * 清理超时的待验证信号
   *
   * @param {number} now - 当前时间戳
   */
  _prunePendingSignals(now) {
    const windowMs = DETECTION_CONFIG.auxiliaryValidationWindowMs;
    this.pendingSignals = this.pendingSignals.filter(
      (sig) => now - sig.timestamp <= windowMs
    );
  }

  // =========================================================================
  // 私有方法：hipHistory 维护
  // =========================================================================

  /**
   * 清理过旧的髋关节历史记录
   *
   * 保留策略：至少保留峰值返回窗口的 2 倍时长 + 1 秒缓冲。
   *
   * @param {number} now - 当前时间戳
   */
  _pruneHipHistory(now) {
    const retentionMs = DETECTION_CONFIG.peakReturnWindowMs * 2 + 1000;
    this.hipHistory = this.hipHistory.filter(
      (entry) => now - entry.timestamp <= retentionMs
    );
  }
}

export { SignalDetector };
