/**
 * UI 管理器 — UIManager
 *
 * 职责：管理所有 HTML DOM 界面的切换（校准、游戏选择、训练、休息、总结）。
 * 不包含游戏 Canvas 渲染，仅管理 DOM 显示层的创建和切换。
 *
 * UI 界面列表：
 * - 校准界面 (Calibration)
 * - 游戏选择界面 (Game Selection)
 * - 训练 HUD 叠加层 (Training HUD)
 * - 休息界面 (Rest)
 * - 训练总结界面 (Session Summary)
 */

import { UI_CONFIG } from '../config.js';

// =========================================================================
// UIManager 类
// =========================================================================

class UIManager {
  /**
   * @param {Object} deps - 依赖注入回调
   * @param {Function} deps.onStartCalibration - 用户点击"开始校准"
   * @param {Function} deps.onStartTraining - 用户点击"开始训练"（选好游戏后）
   * @param {Function} deps.onStartRest - 治疗师点击"休息"
   * @param {Function} deps.onEndRest - 儿童点击"继续"
   * @param {Function} deps.onEndSession - 治疗师点击"结束训练"
   * @param {Function} deps.onGameSelected - 游戏被选择 (gameId: 'bubble'|'companion')
   */
  constructor(deps = {}) {
    /** @type {Function} 开始校准回调 */
    this.onStartCalibration = deps.onStartCalibration ?? (() => {});
    /** @type {Function} 开始训练回调 */
    this.onStartTraining = deps.onStartTraining ?? (() => {});
    /** @type {Function} 休息开始回调 */
    this.onStartRest = deps.onStartRest ?? (() => {});
    /** @type {Function} 休息结束回调 */
    this.onEndRest = deps.onEndRest ?? (() => {});
    /** @type {Function} 结束训练回调 */
    this.onEndSession = deps.onEndSession ?? (() => {});
    /** @type {Function} 游戏选择回调 */
    this.onGameSelected = deps.onGameSelected ?? (() => {});

    /** @type {string} 当前选中的游戏 ID */
    this._selectedGameId = null;

    /** @type {string|null} 当前显示的界面名称 */
    this._currentScreen = null;

    /** @type {HTMLElement|null} UI 层容器 */
    this._uiLayer = null;

    /** @type {HTMLCanvasElement|null} 泡泡游戏预览 Canvas */
    this._bubblePreviewCanvas = null;

    /** @type {HTMLCanvasElement|null} 伙伴之旅预览 Canvas */
    this._companionPreviewCanvas = null;

    /** @type {number|null} 训练计时器定时器 ID */
    this._timerIntervalId = null;

    /** @type {number} 训练开始时间戳 */
    this._trainingStartTime = 0;

    // 延迟创建 UI 层（等待 DOM 就绪）
    this._ensureUILayer();
  }

  // =========================================================================
  // UI 层初始化
  // =========================================================================

  /**
   * 确保 UI 层 DOM 容器存在
   */
  _ensureUILayer() {
    if (this._uiLayer) return;

    this._uiLayer = document.getElementById('ui-layer');
    if (!this._uiLayer) {
      console.warn('[UIManager] 找不到 #ui-layer 元素，请在 index.html 中添加');
      return;
    }

    this._bindEvents();
  }

  /**
   * 绑定所有 UI 事件
   */
  _bindEvents() {
    if (!this._uiLayer) return;

    // 校准界面 — 开始校准按钮
    const btnStartCalibration = document.getElementById('btn-start-calibration');
    if (btnStartCalibration) {
      btnStartCalibration.addEventListener('click', () => {
        this.onStartCalibration();
      });
    }

    // 校准界面 — 开始训练按钮（校准完成后）
    const btnStartTraining = document.getElementById('btn-start-training');
    if (btnStartTraining) {
      btnStartTraining.addEventListener('click', () => {
        this.onStartTraining();
      });
    }

    // 游戏选择 — 泡泡消除选择按钮
    const btnSelectBubble = document.getElementById('btn-select-bubble');
    if (btnSelectBubble) {
      btnSelectBubble.addEventListener('click', () => {
        this._selectedGameId = 'bubble';
        this._highlightCard('bubble');
        this.onGameSelected('bubble');
      });
    }

    // 游戏选择 — 陪伴之旅选择按钮
    const btnSelectCompanion = document.getElementById('btn-select-companion');
    if (btnSelectCompanion) {
      btnSelectCompanion.addEventListener('click', () => {
        this._selectedGameId = 'companion';
        this._highlightCard('companion');
        this.onGameSelected('companion');
      });
    }

    // 训练界面 — 休息按钮
    const btnRest = document.getElementById('btn-rest');
    if (btnRest) {
      btnRest.addEventListener('click', () => {
        this.onStartRest();
      });
    }

    // 训练界面 — 结束按钮（长按）
    const btnEnd = document.getElementById('btn-end');
    if (btnEnd) {
      let longPressTimer = null;
      btnEnd.addEventListener('mousedown', () => {
        longPressTimer = setTimeout(() => {
          if (confirm('确定要结束本次训练吗？')) {
            this.onEndSession();
          }
        }, 1500);
      });
      btnEnd.addEventListener('mouseup', () => {
        clearTimeout(longPressTimer);
      });
      btnEnd.addEventListener('mouseleave', () => {
        clearTimeout(longPressTimer);
      });
      // 移动端
      btnEnd.addEventListener('touchstart', () => {
        longPressTimer = setTimeout(() => {
          if (confirm('确定要结束本次训练吗？')) {
            this.onEndSession();
          }
        }, 1500);
      });
      btnEnd.addEventListener('touchend', () => {
        clearTimeout(longPressTimer);
      });
    }

    // 休息界面 — 继续按钮
    const btnContinue = document.getElementById('btn-continue');
    if (btnContinue) {
      btnContinue.addEventListener('click', () => {
        this.onEndRest();
      });
    }

    // 总结界面 — 再来一次按钮
    const btnAgain = document.getElementById('btn-again');
    if (btnAgain) {
      btnAgain.addEventListener('click', () => {
        // 重置，重新显示校准界面
        this.showCalibration();
      });
    }

    // 总结界面 — 返回首页按钮
    const btnHome = document.getElementById('btn-home');
    if (btnHome) {
      btnHome.addEventListener('click', () => {
        // 重新加载页面
        window.location.reload();
      });
    }
  }

  // =========================================================================
  // 界面切换
  // =========================================================================

  /**
   * 切换显示某个界面，隐藏其他
   *
   * @param {string} screenId - 界面 ID（不含 'screen-' 前缀的部分）
   */
  _showScreen(screenId) {
    if (this._currentScreen === screenId) return;
    this._currentScreen = screenId;

    // 隐藏所有界面
    const allScreens = this._uiLayer.querySelectorAll('.screen');
    allScreens.forEach((s) => s.classList.add('hidden'));

    // 显示目标界面
    const target = document.getElementById(`screen-${screenId}`);
    if (target) {
      target.classList.remove('hidden');
      // 触发淡入动画
      target.style.animation = 'fadeIn 300ms ease forwards';
    }
  }

  // =========================================================================
  // 校准界面
  // =========================================================================

  /**
   * 显示校准界面
   */
  showCalibration() {
    this._showScreen('calibration');

    // 隐藏"开始训练"按钮
    const btnStartTraining = document.getElementById('btn-start-training');
    const btnStartCalibration = document.getElementById('btn-start-calibration');
    const countdownEl = document.getElementById('calibration-countdown');
    const statusEl = document.getElementById('calibration-status');

    if (btnStartTraining) btnStartTraining.classList.add('hidden');
    if (btnStartCalibration) btnStartCalibration.classList.remove('hidden');
    if (countdownEl) countdownEl.classList.add('hidden');
    if (statusEl) statusEl.textContent = '';
  }

  /**
   * 更新校准界面的摄像头预览
   *
   * @param {MediaStream} videoStream - 摄像头视频流
   */
  updateCalibrationPreview(videoStream) {
    const container = document.getElementById('calibration-video-container');
    if (!container) return;

    // 创建或获取 video 元素
    let videoEl = container.querySelector('video');
    if (!videoEl) {
      videoEl = document.createElement('video');
      videoEl.setAttribute('playsinline', '');
      videoEl.setAttribute('autoplay', '');
      videoEl.setAttribute('muted', '');
      videoEl.style.width = '100%';
      videoEl.style.height = '100%';
      videoEl.style.objectFit = 'cover';
      videoEl.style.borderRadius = '12px';
      container.innerHTML = '';
      container.appendChild(videoEl);
    }

    videoEl.srcObject = videoStream;
    videoEl.play().catch(() => {});
  }

  /**
   * 更新校准界面的置信度指示器
   *
   * @param {Array<{x:number, y:number, z:number, visibility:number}>} landmarks - MediaPipe 关键点
   */
  updateConfidenceIndicators(landmarks) {
    if (!landmarks || landmarks.length < 27) return;

    const indicators = [
      { id: 'conf-left-hip', value: landmarks[23]?.visibility ?? 0 },
      { id: 'conf-right-hip', value: landmarks[24]?.visibility ?? 0 },
      { id: 'conf-left-knee', value: landmarks[25]?.visibility ?? 0 },
      { id: 'conf-right-knee', value: landmarks[26]?.visibility ?? 0 },
    ];

    for (const { id, value } of indicators) {
      const el = document.getElementById(id);
      if (!el) continue;
      // 颜色：>=0.7 绿色，>=0.5 黄色，<0.5 红色
      if (value >= 0.7) {
        el.style.backgroundColor = '#34D399';
      } else if (value >= 0.5) {
        el.style.backgroundColor = '#FBBF24';
      } else {
        el.style.backgroundColor = '#F472B6';
      }
      // 大小随置信度变化
      const scale = 0.7 + value * 0.3;
      el.style.transform = `scale(${scale})`;
    }
  }

  /**
   * 显示校准倒计时
   *
   * @param {number} seconds - 剩余秒数
   */
  showCalibrationCountdown(seconds) {
    const el = document.getElementById('calibration-countdown');
    if (!el) return;

    el.classList.remove('hidden');
    el.textContent = String(seconds);
    // 缩放脉冲动画
    el.style.animation = 'none';
    el.offsetHeight; // 触发回流
    el.style.animation = 'pulseScale 1s ease infinite';
  }

  /**
   * 隐藏校准倒计时
   */
  hideCalibrationCountdown() {
    const el = document.getElementById('calibration-countdown');
    if (el) {
      el.classList.add('hidden');
      el.style.animation = 'none';
    }
  }

  /**
   * 校准完成，显示就绪状态
   *
   * @param {{ shoulderWidth: number, hipHeight: number }} [params] - 校准结果
   */
  showCalibrationReady(params) {
    const btnStartCalibration = document.getElementById('btn-start-calibration');
    const btnStartTraining = document.getElementById('btn-start-training');
    const statusEl = document.getElementById('calibration-status');

    if (btnStartCalibration) btnStartCalibration.classList.add('hidden');
    if (btnStartTraining) btnStartTraining.classList.remove('hidden');

    // 显示校准结果
    if (statusEl) {
      const lines = [];
      lines.push('<span style="color:#34D399;font-size:32px;">✓ 就绪</span>');
      if (params) {
        if (params.shoulderWidth) lines.push(`肩宽: ${Math.round(params.shoulderWidth)}px`);
        if (params.hipHeight) lines.push(`髋高: ${Math.round(params.hipHeight * 100)}%`);
      }
      statusEl.innerHTML = lines.join('<br>');
    }

    this.hideCalibrationCountdown();
  }

  // =========================================================================
  // 游戏选择界面
  // =========================================================================

  /**
   * 显示游戏选择界面
   */
  showGameSelection() {
    this._showScreen('game-select');
    this._selectedGameId = null;

    // 取消所有高亮
    this._highlightCard(null);

    // 绘制预览 Canvas
    this._drawBubblePreview();
    this._drawCompanionPreview();
  }

  /**
   * 高亮选中的游戏卡片
   *
   * @param {string|null} gameId - 游戏 ID，null 取消所有高亮
   */
  _highlightCard(gameId) {
    const cards = document.querySelectorAll('.game-card');
    cards.forEach((card) => {
      card.classList.remove('selected');
      card.style.boxShadow = 'none';
    });

    if (gameId) {
      const selected = document.querySelector(`[data-game="${gameId}"]`);
      if (selected) {
        selected.classList.add('selected');
        selected.style.boxShadow = '0 0 20px rgba(124, 92, 252, 0.6), 0 0 40px rgba(124, 92, 252, 0.3)';
      }
    }
  }

  /**
   * 绘制泡泡消除游戏预览
   */
  _drawBubblePreview() {
    const canvas = document.getElementById('preview-bubble');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // 背景
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#0f0f23');
    bgGrad.addColorStop(1, '#1a1a2e');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // 绘制几个彩色泡泡
    const bubbles = [
      { x: w * 0.3, y: h * 0.45, r: 28, color: '#FF6B6B' },
      { x: w * 0.6, y: h * 0.3, r: 22, color: '#4ECDC4' },
      { x: w * 0.45, y: h * 0.65, r: 25, color: '#FFE66D' },
      { x: w * 0.75, y: h * 0.55, r: 20, color: '#A78BFA' },
      { x: w * 0.2, y: h * 0.7, r: 18, color: '#34D399' },
      { x: w * 0.55, y: h * 0.8, r: 24, color: '#F472B6' },
    ];

    for (const b of bubbles) {
      // 外光晕
      const glowGrad = ctx.createRadialGradient(b.x, b.y, b.r * 0.5, b.x, b.y, b.r * 1.3);
      glowGrad.addColorStop(0, b.color);
      glowGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 1.3, 0, Math.PI * 2);
      ctx.fill();

      // 主体
      const bodyGrad = ctx.createRadialGradient(b.x - b.r * 0.25, b.y - b.r * 0.25, b.r * 0.1, b.x, b.y, b.r);
      bodyGrad.addColorStop(0, '#ffffff');
      bodyGrad.addColorStop(0.35, b.color);
      bodyGrad.addColorStop(1, b.color + '44');
      ctx.fillStyle = bodyGrad;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();

      // 高光
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.beginPath();
      ctx.ellipse(b.x - b.r * 0.25, b.y - b.r * 0.3, b.r * 0.3, b.r * 0.12, -Math.PI / 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // 底部"概念图"标记
    ctx.fillStyle = 'rgba(148,163,184,0.4)';
    ctx.font = '10px "PingFang SC", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('概念图', w - 8, h - 8);
  }

  /**
   * 绘制陪伴之旅游戏预览
   */
  _drawCompanionPreview() {
    const canvas = document.getElementById('preview-companion');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // 背景
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#1a3a1a');
    bgGrad.addColorStop(1, '#2d5a27');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // 地面
    ctx.fillStyle = 'rgba(40,80,40,0.6)';
    ctx.fillRect(0, h * 0.78, w, h * 0.22);

    // 路径瓷砖
    const emojis = ['🌸', '🍄', '🌿', '🌻'];
    for (let i = 0; i < 6; i++) {
      ctx.font = '18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emojis[i % emojis.length], w * 0.15 + i * 55, h * 0.78);
    }

    // 画一个简单的狐狸角色
    const cx = w * 0.35;
    const cy = h * 0.52;

    // 身体
    ctx.fillStyle = '#ff8c42';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 5, 24, 28, 0, 0, Math.PI * 2);
    ctx.fill();

    // 肚皮
    ctx.fillStyle = '#ffe0c0';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 8, 15, 20, 0, 0, Math.PI * 2);
    ctx.fill();

    // 头
    ctx.fillStyle = '#ff8c42';
    ctx.beginPath();
    ctx.arc(cx, cy - 18, 16, 0, Math.PI * 2);
    ctx.fill();

    // 耳朵
    ctx.fillStyle = '#ff8c42';
    ctx.beginPath();
    ctx.moveTo(cx - 9, cy - 30);
    ctx.lineTo(cx - 5, cy - 50);
    ctx.lineTo(cx + 5, cy - 30);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy - 30);
    ctx.lineTo(cx + 5, cy - 50);
    ctx.lineTo(cx + 9, cy - 30);
    ctx.closePath();
    ctx.fill();

    // 眼睛
    ctx.fillStyle = '#2d1b69';
    ctx.beginPath();
    ctx.arc(cx - 5, cy - 20, 3, 0, Math.PI * 2);
    ctx.arc(cx + 5, cy - 20, 3, 0, Math.PI * 2);
    ctx.fill();

    // 鼻子
    ctx.fillStyle = '#2d1b69';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 14, 3, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // 尾巴
    ctx.fillStyle = '#ff8c42';
    ctx.beginPath();
    ctx.moveTo(cx - 15, cy + 10);
    ctx.quadraticCurveTo(cx - 30, cy, cx - 34, cy + 18);
    ctx.quadraticCurveTo(cx - 28, cy + 15, cx - 13, cy + 25);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx - 34, cy + 15, 4, 0, Math.PI * 2);
    ctx.fill();

    // 底部"概念图"标记
    ctx.fillStyle = 'rgba(148,163,184,0.4)';
    ctx.font = '10px "PingFang SC", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('概念图', w - 8, h - 8);
  }

  // =========================================================================
  // 训练界面
  // =========================================================================

  /**
   * 显示训练界面（HUD 叠加层）
   */
  showTraining() {
    this._showScreen('training');

    // 隐藏低置信度警告
    this.hideLowConfidenceWarning();

    // 隐藏摔倒警告
    this.hideFallWarning();

    // 重置 HUD
    this.updateHUD({ steps: 0, streak: 0, hunger: 0 });

    // 启动计时器
    this._startTimer();
  }

  /**
   * 启动训练计时器
   */
  _startTimer() {
    this._stopTimer();
    this._trainingStartTime = Date.now();
    this._timerIntervalId = setInterval(() => {
      const elapsed = Date.now() - this._trainingStartTime;
      this._updateTimerDisplay(elapsed);
    }, 1000);
  }

  /**
   * 停止训练计时器
   */
  _stopTimer() {
    if (this._timerIntervalId !== null) {
      clearInterval(this._timerIntervalId);
      this._timerIntervalId = null;
    }
  }

  /**
   * 更新计时器显示
   *
   * @param {number} elapsedMs - 经过的毫秒数
   */
  _updateTimerDisplay(elapsedMs) {
    const timerEl = document.getElementById('hud-timer');
    if (!timerEl) return;

    const totalSec = Math.floor(elapsedMs / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    timerEl.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  /**
   * 更新 HUD 显示
   *
   * @param {{ steps?: number, streak?: number, hunger?: number }} stats
   */
  updateHUD(stats) {
    // 步数
    if (stats.steps !== undefined) {
      const stepsEl = document.getElementById('hud-steps');
      if (stepsEl) stepsEl.innerHTML = `👣 ${stats.steps}步`;
    }

    // 连续步数
    if (stats.streak !== undefined) {
      const streakEl = document.getElementById('hud-streak');
      if (streakEl) {
        if (stats.streak > 0) {
          streakEl.classList.remove('hidden');
          streakEl.textContent = `🔥 连${stats.streak}步`;
        } else {
          streakEl.classList.add('hidden');
        }
      }
    }

    // 饥饿值
    if (stats.hunger !== undefined) {
      const hungerEl = document.getElementById('hud-hunger');
      if (hungerEl) hungerEl.textContent = `❤️ ${stats.hunger}%`;
    }
  }

  // =========================================================================
  // 低置信度警告
  // =========================================================================

  /**
   * 显示低置信度警告
   *
   * @param {string} [reason] - 警告原因
   */
  showLowConfidenceWarning(reason) {
    const banner = document.getElementById('warning-banner');
    if (!banner) return;

    banner.classList.remove('hidden');
    banner.textContent = reason || '⚠️ 请调整摄像头位置';
    banner.style.animation = 'slideDown 300ms ease forwards';
  }

  /**
   * 隐藏低置信度警告
   */
  hideLowConfidenceWarning() {
    const banner = document.getElementById('warning-banner');
    if (!banner) return;

    banner.classList.add('hidden');
    banner.style.animation = 'none';
  }

  // =========================================================================
  // 摔倒警告
  // =========================================================================

  /**
   * 显示摔倒/坐下检测提示
   */
  showFallWarning() {
    const overlay = document.getElementById('fall-overlay');
    if (!overlay) return;

    overlay.classList.remove('hidden');
    overlay.style.animation = 'fadeIn 300ms ease forwards';
  }

  /**
   * 隐藏摔倒警告
   */
  hideFallWarning() {
    const overlay = document.getElementById('fall-overlay');
    if (!overlay) return;

    overlay.classList.add('hidden');
    overlay.style.animation = 'none';
  }

  // =========================================================================
  // 休息界面
  // =========================================================================

  /**
   * 显示休息界面
   */
  showRest() {
    this._showScreen('rest');

    // 暂停计时器
    this._stopTimer();
  }

  // =========================================================================
  // 训练总结界面
  // =========================================================================

  /**
   * 显示训练总结界面
   *
   * @param {{ totalSteps: number, durationMs: number, maxStreak: number }} summary - 训练总结
   */
  showSessionSummary(summary) {
    this._showScreen('summary');

    // 停止计时器
    this._stopTimer();

    const { totalSteps = 0, durationMs = 0, maxStreak = 0 } = summary || {};

    // 更新统计值
    const totalStepsEl = document.getElementById('summary-total-steps');
    const durationEl = document.getElementById('summary-duration');
    const maxStreakEl = document.getElementById('summary-max-streak');

    if (totalStepsEl) totalStepsEl.textContent = String(totalSteps);

    if (durationEl) {
      const min = Math.floor(durationMs / 60000);
      const sec = Math.floor((durationMs % 60000) / 1000);
      durationEl.textContent = `${min}分${sec}秒`;
    }

    if (maxStreakEl) maxStreakEl.textContent = String(maxStreak);
  }

  // =========================================================================
  // 查询方法
  // =========================================================================

  /**
   * 获取当前显示的界面名称
   *
   * @returns {string|null}
   */
  getCurrentScreen() {
    return this._currentScreen;
  }

  /**
   * 获取当前选中的游戏 ID
   *
   * @returns {string|null}
   */
  getSelectedGameId() {
    return this._selectedGameId;
  }

  /**
   * 销毁 UI 管理器，清理资源
   */
  destroy() {
    this._stopTimer();
    this._currentScreen = null;
    this._selectedGameId = null;
    this._uiLayer = null;
  }
}

export { UIManager };
export default UIManager;
