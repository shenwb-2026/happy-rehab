/**
 * 快乐康复指导 - 训练会话状态机模块
 *
 * 管理完整的训练会话生命周期：
 * idle → calibrating → training → rest → training (循环) → ended
 *
 * 作为检测层（Detector）和游戏层（Game）之间的调度中心，
 * 负责状态流转、步数计数、连续步数管理和训练统计。
 *
 * 所有可调参数从 config.js 读取，不硬编码。
 */

import { GAME_CONFIG } from '../config.js';

// =========================================================================
// 会话状态常量
// =========================================================================

/**
 * 训练会话的所有可能状态
 */
export const SessionState = {
  /** 空闲状态：应用已启动，等待开始校准 */
  IDLE: 'idle',
  /** 校准中：正在采集基准参数 */
  CALIBRATING: 'calibrating',
  /** 训练中：正在检测步数并播放游戏反馈 */
  TRAINING: 'training',
  /** 休息中：暂停训练，等待恢复 */
  REST: 'rest',
  /** 已结束：训练完成，显示总结 */
  ENDED: 'ended',
};

// =========================================================================
// 会话管理器
// =========================================================================

/**
 * 训练会话状态机
 *
 * 状态流转规则：
 * - IDLE / ENDED → CALIBRATING（调用 startCalibration）
 * - CALIBRATING → TRAINING（调用 startTraining）
 * - TRAINING → REST（调用 startRest）
 * - REST → TRAINING（调用 endRest）
 * - TRAINING / REST → ENDED（调用 endSession）
 */
class SessionManager {
  /**
   * @param {Object} deps - 依赖注入
   * @param {Object} deps.detector - 检测器实例（遵循 DetectorInterface）
   * @param {Object} deps.game - 当前激活的游戏模块（遵循 GameInterface）
   * @param {Function} deps.onStateChange - 状态变更回调
   *       回调签名: (newState: string, oldState: string) => void
   * @param {Function} deps.onStepCount - 步数更新回调
   *       回调签名: (totalSteps: number, streakCount: number) => void
   */
  constructor(deps) {
    this.detector = deps.detector;
    this.game = deps.game;
    this.onStateChange = deps.onStateChange ?? (() => {});
    this.onStepCount = deps.onStepCount ?? (() => {});

    /** @type {string} 当前会话状态 */
    this.state = SessionState.IDLE;

    /** @type {number} 训练总步数 */
    this.totalSteps = 0;

    /** @type {number} 当前连续步数（无步数超时后重置为 0） */
    this.streak = 0;

    /** @type {number|null} 训练开始时间戳（毫秒），null 表示尚未开始 */
    this.sessionStartTime = null;

    /** @type {number|null} 上次步数时间戳（毫秒），用于超时检测 */
    this.lastStepTimestamp = null;

    /** @type {number|null} 连续步数超时检查定时器 ID */
    this.streakTimeoutTimerId = null;

    /** @type {number} 训练历史中的最高连续步数 */
    this.maxStreak = 0;

    /** @type {number} 上次休息开始时间戳，用于统计纯训练时长 */
    this.restStartTime = null;

    /** @type {number} 累计休息时长（毫秒） */
    this.totalRestDurationMs = 0;

    /** @type {number} 连续步数超时时间（毫秒） */
    this.streakTimeoutMs = GAME_CONFIG.streakTimeoutMs;
  }

  // =========================================================================
  // 状态查询
  // =========================================================================

  /**
   * 获取当前会话状态
   *
   * @returns {string} 当前状态值（IDLE | CALIBRATING | TRAINING | REST | ENDED）
   */
  getState() {
    return this.state;
  }

  /**
   * 获取训练统计
   *
   * @returns {{ totalSteps: number, streak: number, durationMs: number, maxStreak: number }}
   *   - totalSteps: 训练总步数
   *   - streak: 当前连续步数
   *   - durationMs: 纯训练时长（减去休息时间）
   *   - maxStreak: 历史最高连续步数
   */
  getStats() {
    const durationMs = this._calculateTrainingDuration();
    return {
      totalSteps: this.totalSteps,
      streak: this.streak,
      durationMs,
      maxStreak: this.maxStreak,
    };
  }

  // =========================================================================
  // 状态转换
  // =========================================================================

  /**
   * 开始校准流程
   *
   * 状态变更：IDLE / ENDED → CALIBRATING
   *
   * 前置条件：只能在 IDLE 或 ENDED 状态下调用
   * 内部操作：调用检测器的 reset() 清空内部状态
   */
  startCalibration() {
    if (this.state !== SessionState.IDLE && this.state !== SessionState.ENDED) {
      console.warn(`[SessionManager] 无法从 ${this.state} 状态进入校准`);
      return;
    }

    this._transitionTo(SessionState.CALIBRATING);
    this.detector.reset();
  }

  /**
   * 完成校准，设置校准参数
   *
   * 将校准阶段采集的基准参数传递给检测器，
   * 为后续步数检测提供参考基准。
   *
   * @param {Object} params - 校准参数
   * @param {number} params.hipNeutralX - 髋关节中点中立 X 坐标（归一化）
   * @param {number} params.shoulderWidthPx - 像素级肩宽
   * @param {number} params.baselineTremorAmplitude - 基线震颤幅度
   * @param {number} params.standingHipY - 站立髋关节 Y 坐标（归一化）
   */
  completeCalibration(params) {
    if (this.state !== SessionState.CALIBRATING) {
      console.warn('[SessionManager] 当前不在校准状态，无法设置校准参数');
      return;
    }

    this.detector.setCalibration(params);
    console.log('[SessionManager] 校准参数已设置:', params);
  }

  /**
   * 开始训练
   *
   * 状态变更：CALIBRATING → TRAINING
   *
   * 内部操作：
   * 1. 重置所有步数计数器和统计信息
   * 2. 记录训练开始时间
   * 3. 调用游戏层的 onSessionStart()
   * 4. 启动连续步数超时检查
   */
  startTraining() {
    if (this.state !== SessionState.CALIBRATING) {
      console.warn(`[SessionManager] 无法从 ${this.state} 状态直接开始训练`);
      return;
    }

    // 重置计数器
    this.totalSteps = 0;
    this.streak = 0;
    this.maxStreak = 0;
    this.lastStepTimestamp = null;
    this.totalRestDurationMs = 0;
    this.restStartTime = null;

    // 记录训练开始时间
    this.sessionStartTime = Date.now();

    // 状态转换
    this._transitionTo(SessionState.TRAINING);

    // 通知游戏层
    this.game.onSessionStart();

    // 启动连续步数超时检查
    this._startStreakTimeoutCheck();
  }

  /**
   * 进入休息模式
   *
   * 状态变更：TRAINING → REST
   *
   * 内部操作：
   * 1. 暂停连续步数超时计时器
   * 2. 记录休息开始时间
   * 3. 调用游戏层的 onRestStart()
   */
  startRest() {
    if (this.state !== SessionState.TRAINING) {
      console.warn(`[SessionManager] 当前不在训练状态，无法进入休息`);
      return;
    }

    // 暂停超时检查
    this._stopStreakTimeoutCheck();

    // 记录休息开始时间
    this.restStartTime = Date.now();

    this._transitionTo(SessionState.REST);

    // 通知游戏层
    this.game.onRestStart();
  }

  /**
   * 退出休息模式
   *
   * 状态变更：REST → TRAINING
   *
   * 内部操作：
   * 1. 累计休息时长
   * 2. 恢复连续步数超时计时器
   * 3. 调用游戏层的 onRestEnd()
   */
  endRest() {
    if (this.state !== SessionState.REST) {
      console.warn(`[SessionManager] 当前不在休息状态，无法退出休息`);
      return;
    }

    // 累计休息时长
    if (this.restStartTime !== null) {
      this.totalRestDurationMs += Date.now() - this.restStartTime;
      this.restStartTime = null;
    }

    this._transitionTo(SessionState.TRAINING);

    // 通知游戏层
    this.game.onRestEnd();

    // 恢复连续步数超时检查
    this._startStreakTimeoutCheck();
  }

  /**
   * 结束训练
   *
   * 状态变更：TRAINING / REST → ENDED
   *
   * 内部操作：
   * 1. 停止超时检查
   * 2. 调用游戏层的 onSessionEnd()
   * 3. 返回训练总结数据
   *
   * @returns {{ totalSteps: number, durationMs: number, maxStreak: number }} 训练总结
   */
  endSession() {
    if (this.state !== SessionState.TRAINING && this.state !== SessionState.REST) {
      console.warn(`[SessionManager] 当前不在训练/休息状态，无法结束训练`);
      return this.getStats();
    }

    // 如果正在休息，先累计休息时长
    if (this.state === SessionState.REST && this.restStartTime !== null) {
      this.totalRestDurationMs += Date.now() - this.restStartTime;
      this.restStartTime = null;
    }

    // 停止超时检查
    this._stopStreakTimeoutCheck();

    // 状态转换
    this._transitionTo(SessionState.ENDED);

    // 通知游戏层
    this.game.onSessionEnd();

    // 返回训练总结
    const durationMs = this._calculateTrainingDuration();
    return {
      totalSteps: this.totalSteps,
      durationMs,
      maxStreak: this.maxStreak,
    };
  }

  // =========================================================================
  // 核心调度
  // =========================================================================

  /**
   * 处理每帧检测结果（核心调度方法）
   *
   * 根据检测器返回的状态和当前会话状态决定如何处理：
   *
   * - result.status === 'STEP' && state === TRAINING：
   *   1. 更新时间戳
   *   2. 累加步数计数（totalSteps++, streak++）
   *   3. 更新最高连续步数记录
   *   4. 调用 game.onStep(timestamp, side)
   *   5. 通知 onStepCount 回调
   *
   * - result.status === 'LOW_CONFIDENCE'：
   *   通知 onStateChange（UI 层可监听并显示提示）
   *
   * - result.status === 'FALL_DETECTED'：
   *   通知 onStateChange（UI 层可显示安全提示）
   *
   * - state !== TRAINING：忽略所有 STEP 事件
   *
   * @param {Object} result - 检测器返回的结果
   * @param {string} result.status - 检测状态：'STEP' | 'NO_STEP' | 'LOW_CONFIDENCE' | 'FALL_DETECTED'
   * @param {number} [result.timestamp] - 检测时间戳
   * @param {string} [result.side] - 步数方向：'left' | 'right'
   * @param {string} [result.reason] - LOW_CONFIDENCE 时的说明信息
   */
  handleDetectionResult(result) {
    if (!result) return;

    // 仅 TRAINING 状态下处理步数事件
    if (result.status === 'STEP' && this.state === SessionState.TRAINING) {
      // 更新统计
      this.lastStepTimestamp = Date.now();
      this.totalSteps++;
      this.streak++;

      // 更新最高连续步数
      if (this.streak > this.maxStreak) {
        this.maxStreak = this.streak;
      }

      // 通知游戏层（延迟目标 ≤10ms 内调用）
      this.game.onStep(result.timestamp, result.side);

      // 通知步数更新
      this.onStepCount(this.totalSteps, this.streak);
      return;
    }

    // 置信度不足事件：转发给 UI 层
    if (result.status === 'LOW_CONFIDENCE') {
      this.onStateChange(this.state, this.state, {
        alert: 'lowConfidence',
        reason: result.reason || '姿态检测置信度不足',
      });
      return;
    }

    // 摔倒检测事件：转发给 UI 层
    if (result.status === 'FALL_DETECTED') {
      this.onStateChange(this.state, this.state, {
        alert: 'fallDetected',
        reason: '检测到髋部位置异常，请确认患者状态',
      });
      return;
    }

    // NO_STEP 事件：正常，无需处理
  }

  // =========================================================================
  // 内部方法
  // =========================================================================

  /**
   * 状态转换的内部实现
   *
   * 记录日志并触发 onStateChange 回调
   *
   * @param {string} newState - 目标状态
   */
  _transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;
    console.log(`[SessionManager] 状态变更: ${oldState} → ${newState}`);
    this.onStateChange(newState, oldState);
  }

  /**
   * 计算纯训练时长（减去休息时间）
   *
   * @returns {number} 训练时长（毫秒）
   */
  _calculateTrainingDuration() {
    if (this.sessionStartTime === null) return 0;

    const now = Date.now();
    let duration = now - this.sessionStartTime;

    // 减去累计休息时长
    duration -= this.totalRestDurationMs;

    // 如果当前正在休息，还要减去未完成的休息时长
    if (this.state === SessionState.REST && this.restStartTime !== null) {
      duration -= now - this.restStartTime;
    }

    return Math.max(0, duration);
  }

  /**
   * 启动连续步数超时检查
   *
   * 定期检查距上次步数是否超过 streakTimeoutMs（默认 5 秒），
   * 超时则重置连续步数计数器（streak = 0）。
   *
   * 使用 setInterval 定期检查，间隔为超时时间的一半。
   */
  _startStreakTimeoutCheck() {
    this._stopStreakTimeoutCheck();

    // 每间隔一半超时时间检查一次，确保及时响应
    const checkInterval = Math.min(this.streakTimeoutMs / 2, 2000);

    this.streakTimeoutTimerId = setInterval(() => {
      this._checkStreakTimeout();
    }, checkInterval);
  }

  /**
   * 停止连续步数超时检查
   */
  _stopStreakTimeoutCheck() {
    if (this.streakTimeoutTimerId !== null) {
      clearInterval(this.streakTimeoutTimerId);
      this.streakTimeoutTimerId = null;
    }
  }

  /**
   * 检查连续步数是否超时
   *
   * 距上次步数时间 > streakTimeoutMs 时重置 streak 为 0。
   * TRAINING 状态且已有步数记录时才会执行检查。
   */
  _checkStreakTimeout() {
    if (this.state !== SessionState.TRAINING) return;
    if (this.lastStepTimestamp === null) return;
    if (this.streak === 0) return;

    const elapsed = Date.now() - this.lastStepTimestamp;
    if (elapsed > this.streakTimeoutMs) {
      console.log(`[SessionManager] 连续步数超时（${elapsed}ms > ${this.streakTimeoutMs}ms），已重置`);
      this.streak = 0;
      this.onStepCount(this.totalSteps, this.streak);
    }
  }
}

export { SessionManager };
export default SessionManager;
