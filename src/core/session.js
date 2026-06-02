// 快乐康复指导 · 训练会话状态机
// 管理完整训练生命周期，是检测层与游戏层之间的调度中心。
// 状态：idle → calibrating → gameSelect → training ⇄ rest → ended
// （补充决策 4：gameSelect 为独立状态）

import { GAME_CONFIG } from '../config.js';

export const SessionState = {
  IDLE:        'idle',
  CALIBRATING: 'calibrating',
  GAME_SELECT: 'gameSelect',
  TRAINING:    'training',
  REST:        'rest',
  ENDED:       'ended',
};

class SessionManager {
  /**
   * @param {Object} deps
   * @param {Object}   deps.detector        - DetectorInterface 实例
   * @param {Function} deps.onStateChange   - (newState, oldState) => void
   * @param {Function} deps.onStepCount     - (totalSteps, streak) => void
   */
  constructor(deps) {
    this.detector      = deps.detector;
    this.onStateChange = deps.onStateChange ?? (() => {});
    this.onStepCount   = deps.onStepCount   ?? (() => {});

    /** @type {Object|null} 当前激活的游戏模块 */
    this.game = null;

    this.state            = SessionState.IDLE;
    this.totalSteps       = 0;
    this.streak           = 0;
    this.maxStreak        = 0;
    this.sessionStartTime = null;
    this.lastStepTime     = null;
    this.streakTimerId    = null;
    this.restStartTime    = null;
    this.totalRestMs      = 0;
  }

  // ── 状态查询 ──────────────────────────────────────────────

  getState() { return this.state; }

  getStats() {
    return {
      totalSteps: this.totalSteps,
      streak:     this.streak,
      maxStreak:  this.maxStreak,
      durationMs: this._trainingDuration(),
    };
  }

  // ── 状态转换 ──────────────────────────────────────────────

  startCalibration() {
    if (this.state !== SessionState.IDLE && this.state !== SessionState.ENDED) return;
    this.detector.reset();
    this._to(SessionState.CALIBRATING);
  }

  setCalibration(params) {
    this.detector.setCalibration(params);
  }

  /** 校准完成后自动跳转到游戏选择界面 */
  enterGameSelect() {
    if (this.state !== SessionState.CALIBRATING) return;
    this._to(SessionState.GAME_SELECT);
  }

  /** 注入游戏模块（游戏选择后调用） */
  setGame(game) {
    this.game = game;
  }

  startTraining() {
    if (this.state !== SessionState.GAME_SELECT) {
      console.warn(`[Session] 无法从 ${this.state} 开始训练`);
      return;
    }
    if (!this.game) {
      console.warn('[Session] 未设置游戏模块，无法开始训练');
      return;
    }

    this.totalSteps    = 0;
    this.streak        = 0;
    this.maxStreak     = 0;
    this.lastStepTime  = null;
    this.totalRestMs   = 0;
    this.restStartTime = null;
    this.sessionStartTime = Date.now();

    this._to(SessionState.TRAINING);
    this.game.onSessionStart();
    this._startStreakTimer();
  }

  startRest() {
    if (this.state !== SessionState.TRAINING) return;
    this._stopStreakTimer();
    this.restStartTime = Date.now();
    this._to(SessionState.REST);
    this.game.onRestStart();
  }

  endRest() {
    if (this.state !== SessionState.REST) return;
    if (this.restStartTime) {
      this.totalRestMs += Date.now() - this.restStartTime;
      this.restStartTime = null;
    }
    this._to(SessionState.TRAINING);
    this.game.onRestEnd();
    this._startStreakTimer();
  }

  endSession() {
    if (this.state !== SessionState.TRAINING && this.state !== SessionState.REST) {
      return this.getStats();
    }
    if (this.state === SessionState.REST && this.restStartTime) {
      this.totalRestMs += Date.now() - this.restStartTime;
    }
    this._stopStreakTimer();
    this._to(SessionState.ENDED);
    this.game.onSessionEnd();

    return {
      totalSteps: this.totalSteps,
      maxStreak:  this.maxStreak,
      durationMs: this._trainingDuration(),
    };
  }

  // ── 核心调度 ──────────────────────────────────────────────

  handleDetectionResult(result) {
    if (!result) return;

    if (result.status === 'STEP' && this.state === SessionState.TRAINING) {
      this.lastStepTime = Date.now();
      this.totalSteps++;
      this.streak++;
      if (this.streak > this.maxStreak) this.maxStreak = this.streak;

      this.game.onStep(result.timestamp, result.side);
      this.onStepCount(this.totalSteps, this.streak);
      return;
    }

    if (result.status === 'LOW_CONFIDENCE') {
      this.onStateChange(this.state, this.state, { alert: 'lowConfidence', reason: result.reason });
      return;
    }

    // FALL_DETECTED：MVP 阶段保留 case 但不处理（补充决策 3）
  }

  // ── 内部方法 ──────────────────────────────────────────────

  _to(newState) {
    const old = this.state;
    this.state = newState;
    console.log(`[Session] ${old} → ${newState}`);
    this.onStateChange(newState, old);
  }

  _trainingDuration() {
    if (!this.sessionStartTime) return 0;
    let d = Date.now() - this.sessionStartTime - this.totalRestMs;
    if (this.state === SessionState.REST && this.restStartTime) {
      d -= Date.now() - this.restStartTime;
    }
    return Math.max(0, d);
  }

  _startStreakTimer() {
    this._stopStreakTimer();
    const interval = Math.min(GAME_CONFIG.streakTimeoutMs / 2, 2000);
    this.streakTimerId = setInterval(() => {
      if (this.state !== SessionState.TRAINING) return;
      if (!this.lastStepTime || this.streak === 0) return;
      if (Date.now() - this.lastStepTime > GAME_CONFIG.streakTimeoutMs) {
        this.streak = 0;
        this.onStepCount(this.totalSteps, 0);
      }
    }, interval);
  }

  _stopStreakTimer() {
    if (this.streakTimerId !== null) {
      clearInterval(this.streakTimerId);
      this.streakTimerId = null;
    }
  }
}

export { SessionManager };
export default SessionManager;
