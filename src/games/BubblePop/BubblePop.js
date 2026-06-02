/**
 * 泡泡消除游戏 — BubblePop
 *
 * 纯感官即时反馈游戏。屏幕布满缓慢上浮的彩色泡泡，
 * 行走一步 → 最近泡泡破裂 → 新泡泡生成。
 *
 * 适配训练初期情绪激动、无法理解剧情、低头看脚行走的儿童；
 * 全屏高对比度设计，余光也能感知反馈。
 * 认知负荷极低，仅需感知"行走→破泡泡"的简单因果。
 *
 * 所有视觉由 Canvas 2D 代码绘制，无外部图片资源。
 */

import { GameInterface } from '../GameInterface.js';
import { GAME_CONFIG } from '../../config.js';

// ─── 常量 ─────────────────────────────────────────────────────
/** 泡泡颜色（霓虹彩虹色） */
const BUBBLE_COLORS = [
  '#ff6b9d',  // 霓虹粉
  '#ff8c42',  // 橙
  '#ffd93d',  // 黄
  '#6bcb77',  // 绿
  '#4d96ff',  // 蓝
  '#b388ff',  // 紫
];

/** 泡泡直径范围（像素） */
const BUBBLE_SIZE_MIN = 40;
const BUBBLE_SIZE_MAX = 70;

/** 上浮速度范围（px/帧 @ 60fps） */
const BUBBLE_SPEED_MIN = 0.3;
const BUBBLE_SPEED_MAX = 0.8;

/** 屏幕泡泡数量范围 */
const BUBBLE_COUNT_MIN = 15;
const BUBBLE_COUNT_MAX = 20;

/** 连续步数奖励步数 */
const STREAK_BONUS_AT = GAME_CONFIG.streakBonusAt || 5;

/** 惊喜泡泡概率 */
const SURPRISE_RATIO = 0.125; // 约 1/8

/** 破裂动画阶段 */
const POP_PHASE = { INFLATE: 'inflate', BURST: 'burst', PARTICLES: 'particles' };

/** 破裂动画时长（毫秒） */
const POP_DURATION = {
  inflate: 80,    // 膨胀阶段
  burst: 200,     // 散开阶段
  particles: 600, // 粒子渐隐阶段
};

// ─── 泡泡消除游戏类 ──────────────────────────────────────────

class BubblePop extends GameInterface {
  /**
   * @param {HTMLCanvasElement} canvas — 游戏画布
   * @param {Object} soundEngine — SoundEngine 实例（用于播放音效）
   */
  constructor(canvas, soundEngine) {
    super();
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.soundEngine = soundEngine;

    /** 泡泡池 */
    this.bubbles = [];

    /** 活跃的破裂动画列表 */
    this.activePops = [];

    /** 内部连续步数计数器 */
    this.streakCount = 0;

    /** 总步数 */
    this.totalSteps = 0;

    /** 训练是否活跃 */
    this.isActive = false;

    /** 是否在休息模式 */
    this.isResting = false;

    /** requestAnimationFrame ID */
    this._rafId = null;

    /** 上次帧时间戳 */
    this._lastFrameTime = 0;

    /** Canvas 缩放比例 */
    this._scale = 1;

    /** 是否已初始化 */
    this._initialized = false;
  }

  // ─── 生命周期 ──────────────────────────────────────────────

  /**
   * 开场仪式：所有泡泡从底部同时上浮填充屏幕（1.5秒）
   * 强化"第一步即触发反馈"的因果感知
   */
  onSessionStart() {
    this._ensureCanvasSize();
    this.isActive = true;
    this.isResting = false;
    this.streakCount = 0;
    this.totalSteps = 0;

    // 清空旧状态
    this.bubbles = [];
    this.activePops = [];

    // 从底部生成初始泡泡
    this._initBubbles();

    // 启动渲染循环
    this._startRenderLoop();
  }

  /**
   * 步数事件响应（必须在 500ms 内完成视听反馈）
   * @param {number} timestamp — 步数时间戳
   * @param {'left'|'right'} side — 迈步侧
   */
  onStep(timestamp, side) {
    if (!this.isActive || this.isResting) return;

    this.totalSteps++;
    this.streakCount++;

    // 判断是否为连续奖励步
    const isStreakBonus = (this.streakCount > 0 && this.streakCount % STREAK_BONUS_AT === 0);

    // 选择目标泡泡（最接近视口中心的泡泡）
    const target = this._pickTargetBubble();

    if (target) {
      if (isStreakBonus) {
        // 连续奖励：2倍尺寸超大破裂 + 散落5个小泡泡
        this._triggerSuperPop(target);
      } else {
        // 标准破裂
        this._triggerPop(target);
      }
    }

    // 生成新泡泡补充
    this._spawnBubble();
  }

  /**
   * 休息模式：暂停破裂，维持泡泡上浮
   */
  onRestStart() {
    this.isResting = true;
  }

  /**
   * 恢复行走奖励循环
   */
  onRestEnd() {
    this.isResting = false;
  }

  /**
   * 收尾仪式：所有剩余泡泡链式破裂（2秒），屏幕布满色彩后渐暗
   * @returns {{ totalSteps: number, streakCount: number }}
   */
  onSessionEnd() {
    this.isActive = false;

    // 链式破裂所有剩余泡泡
    this._chainPopAll();

    // 停止渲染循环
    this._stopRenderLoop();

    return {
      totalSteps: this.totalSteps,
      streakCount: this.streakCount,
    };
  }

  /** @returns {number} */
  getStreakCount() {
    return this.streakCount;
  }

  /** @returns {HTMLCanvasElement} */
  getCanvas() {
    return this.canvas;
  }

  /** 清理资源 */
  destroy() {
    this._stopRenderLoop();
    this.bubbles = [];
    this.activePops = [];
    this.isActive = false;
  }

  // ─── 泡泡初始化 ────────────────────────────────────────────

  /**
   * 初始化泡泡池：创建 15-20 个泡泡，从底部开始随机分布
   */
  _initBubbles() {
    const count = BUBBLE_COUNT_MIN + Math.floor(Math.random() * (BUBBLE_COUNT_MAX - BUBBLE_COUNT_MIN + 1));
    const w = this.canvas.width;
    const h = this.canvas.height;

    for (let i = 0; i < count; i++) {
      this.bubbles.push(this._createBubble(w, h));
    }
  }

  /**
   * 创建单个泡泡
   * @param {number} canvasW — 画布宽度
   * @param {number} canvasH — 画布高度
   * @returns {Object} 泡泡对象
   */
  _createBubble(canvasW, canvasH) {
    const diameter = BUBBLE_SIZE_MIN + Math.random() * (BUBBLE_SIZE_MAX - BUBBLE_SIZE_MIN);
    const radius = diameter / 2;

    // 是否为惊喜泡泡（约 1/8 概率）
    const isSurprise = Math.random() < SURPRISE_RATIO;

    return {
      x: Math.random() * canvasW,
      y: canvasH + radius + Math.random() * canvasH * 0.5, // 从底部下方开始，分散初始位置
      radius,
      color: BUBBLE_COLORS[Math.floor(Math.random() * BUBBLE_COLORS.length)],
      speed: BUBBLE_SPEED_MIN + Math.random() * (BUBBLE_SPEED_MAX - BUBBLE_SPEED_MIN),
      alpha: 0.7 + Math.random() * 0.3,
      wobbleOffset: Math.random() * Math.PI * 2,
      wobbleSpeed: (Math.random() - 0.5) * 0.01,
      // 表情（可选的 kawaii 风格）
      hasFace: Math.random() < 0.4,
      faceStyle: Math.floor(Math.random() * 4), // 4种表情变体
      // 惊喜泡泡标记
      isSurprise,
      // 淡入状态（新泡泡从底部淡入）
      fadeIn: 0,
      fadeInSpeed: 0.02 + Math.random() * 0.03,
    };
  }

  // ─── 破裂系统 ──────────────────────────────────────────────

  /**
   * 选择目标泡泡：最接近视口中心的泡泡
   */
  _pickTargetBubble() {
    if (this.bubbles.length === 0) return null;

    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;

    let closest = null;
    let minDist = Infinity;

    for (const bubble of this.bubbles) {
      const dx = bubble.x - cx;
      const dy = bubble.y - cy;
      const dist = dx * dx + dy * dy;
      if (dist < minDist) {
        minDist = dist;
        closest = bubble;
      }
    }

    return closest;
  }

  /**
   * 从泡泡池中移除指定泡泡
   */
  _removeBubble(bubble) {
    const index = this.bubbles.indexOf(bubble);
    if (index !== -1) {
      this.bubbles.splice(index, 1);
    }
  }

  /**
   * 标准破裂效果
   */
  _triggerPop(bubble) {
    this._removeBubble(bubble);

    // 创建破裂动画
    this.activePops.push({
      x: bubble.x,
      y: bubble.y,
      radius: bubble.radius,
      color: bubble.color,
      isSuper: false,
      isSurprise: bubble.isSurprise,
      phase: POP_PHASE.INFLATE,
      startTime: performance.now(),
      scale: 1.0,
      alpha: 1.0,
      // 粒子
      particles: [],
      // 惊喜泡泡的星星粒子
      starParticles: bubble.isSurprise ? this._createStarParticles(bubble) : [],
    });

    // 播放破裂音效
    if (this.soundEngine) {
      this.soundEngine.playBubblePop();
    }
  }

  /**
   * 超大破裂效果（连续奖励）
   */
  _triggerSuperPop(bubble) {
    this._removeBubble(bubble);

    this.activePops.push({
      x: bubble.x,
      y: bubble.y,
      radius: bubble.radius,
      color: bubble.color,
      isSuper: true,
      isSurprise: false,
      phase: POP_PHASE.INFLATE,
      startTime: performance.now(),
      scale: 1.0,
      alpha: 1.0,
      particles: [],
      starParticles: [],
    });

    // 散落5个小泡泡
    for (let i = 0; i < 5; i++) {
      const angle = (Math.PI * 2 * i) / 5 + Math.random() * 1;
      const speed = 1.5 + Math.random() * 2;
      this.activePops.push({
        x: bubble.x,
        y: bubble.y,
        radius: 8 + Math.random() * 12,
        color: BUBBLE_COLORS[i % BUBBLE_COLORS.length],
        isSuper: false,
        isSurprise: true,
        phase: POP_PHASE.PARTICLES,
        startTime: performance.now(),
        scale: 1.0,
        alpha: 1.0,
        particles: [],
        starParticles: [],
        // 散落小泡泡运动参数
        scatterAngle: angle,
        scatterSpeed: speed,
        scatterGravity: 0.05,
        vy: -speed * 0.5,
      });
    }

    // 播放庆祝音效
    if (this.soundEngine) {
      this.soundEngine.playCelebration();
    }
  }

  /**
   * 创建惊喜星星粒子
   */
  _createStarParticles(bubble) {
    const particles = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 * i) / 6;
      particles.push({
        angle,
        speed: 1 + Math.random() * 1.5,
        size: 3 + Math.random() * 5,
        alpha: 1.0,
        alphaDecay: 0.01 + Math.random() * 0.02,
      });
    }
    return particles;
  }

  /**
   * 链式破裂所有泡泡（收尾仪式）
   */
  _chainPopAll() {
    const delay = 60; // 每个泡泡间隔 60ms
    const bubbles = [...this.bubbles];
    this.bubbles = [];

    // 不阻塞主线程，分散在多个帧中播放
    const triggerBatch = (startIndex) => {
      if (startIndex >= bubbles.length) return;

      const end = Math.min(startIndex + 3, bubbles.length);
      for (let i = startIndex; i < end; i++) {
        const bubble = bubbles[i];
        this.activePops.push({
          x: bubble.x,
          y: bubble.y,
          radius: bubble.radius,
          color: bubble.color,
          isSuper: false,
          isSurprise: false,
          phase: POP_PHASE.BURST,
          startTime: performance.now() + delay * (i - startIndex),
          scale: 1.0,
          alpha: 0.6,
          particles: [],
          starParticles: [],
        });
      }

      setTimeout(() => triggerBatch(startIndex + 3), delay * 3 + 20);
    };

    triggerBatch(0);

    // 链式破裂结束后渐暗 → 完成在渲染循环中处理
  }

  // ─── 泡泡管理 ──────────────────────────────────────────────

  /**
   * 生成新泡泡补充到池中
   */
  _spawnBubble() {
    const w = this.canvas.width;
    const h = this.canvas.height;

    if (this.bubbles.length < BUBBLE_COUNT_MAX) {
      const bubble = this._createBubble(w, h);
      bubble.y = h + bubble.radius; // 从底部生成
      this.bubbles.push(bubble);
    }
  }

  // ─── 渲染循环 ──────────────────────────────────────────────

  /**
   * 启动 requestAnimationFrame 渲染循环
   */
  _startRenderLoop() {
    if (this._rafId) return;
    this._lastFrameTime = performance.now();

    const loop = (timestamp) => {
      if (!this.isActive) return;
      this._renderLoop(timestamp);
      this._rafId = requestAnimationFrame(loop);
    };

    this._rafId = requestAnimationFrame(loop);
  }

  /** 停止渲染循环 */
  _stopRenderLoop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /**
   * 渲染循环（每帧）
   * - 清空画布
   * - 更新每个泡泡位置（y -= speed）
   * - 泡泡到达屏幕顶部时回到底部重新随机 x
   * - 绘制每个泡泡
   * - 播放活跃破裂动画
   * - 保持屏幕始终有 15-20 个泡泡
   */
  _renderLoop(timestamp) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const dt = timestamp - this._lastFrameTime;
    this._lastFrameTime = timestamp;

    // ── 清屏：深蓝紫渐变背景 ──
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#0f0f23');
    bgGrad.addColorStop(1, '#1a1a2e');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // ── 更新和绘制泡泡 ──
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const bubble = this.bubbles[i];

      // 上浮
      bubble.y -= bubble.speed;

      // 左右摇晃
      bubble.wobbleOffset += bubble.wobbleSpeed;
      bubble.x += Math.sin(bubble.wobbleOffset) * 0.3;

      // 淡入效果
      if (bubble.fadeIn < 1) {
        bubble.fadeIn += bubble.fadeInSpeed;
      }

      // 到达屏幕顶部 → 回到底部
      if (bubble.y + bubble.radius < -10) {
        bubble.y = h + bubble.radius + Math.random() * 50;
        bubble.x = Math.random() * w;
        bubble.fadeIn = 0; // 重新淡入
      }

      // 边界保护
      bubble.x = Math.max(bubble.radius, Math.min(w - bubble.radius, bubble.x));

      // 绘制泡泡
      this._drawBubble(ctx, bubble);
    }

    // ── 补充泡泡（保持 15-20 个） ──
    if (this.bubbles.length < BUBBLE_COUNT_MIN) {
      const needed = BUBBLE_COUNT_MIN - this.bubbles.length;
      for (let n = 0; n < needed; n++) {
        this._spawnBubble();
      }
    }

    // ── 更新和绘制破裂动画 ──
    for (let i = this.activePops.length - 1; i >= 0; i--) {
      const pop = this.activePops[i];
      this._updatePopAnimation(pop, timestamp);
      this._drawPopAnimation(ctx, pop, timestamp);

      // 清理已完成的动画
      if (pop.alpha <= 0 && pop.phase === POP_PHASE.PARTICLES) {
        this.activePops.splice(i, 1);
      }
    }

    // ── 如果游戏已结束且所有动画完成，绘制渐暗效果 ──
    if (!this.isActive && this.activePops.length === 0) {
      ctx.fillStyle = 'rgba(15, 15, 35, 0.85)';
      ctx.fillRect(0, 0, w, h);

      // 显示步数
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold ${32 * this._scale}px "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`训练完成！总步数: ${this.totalSteps}`, w / 2, h / 2);

      ctx.font = `${20 * this._scale}px "PingFang SC", sans-serif`;
      ctx.fillText(`最高连续: ${this.streakCount} 步`, w / 2, h / 2 + 40);
    }
  }

  // ─── 绘制泡泡 ──────────────────────────────────────────────

  /**
   * 绘制单个泡泡：圆形 + 白色高光反射 + 半透明光晕 + 可选表情
   */
  _drawBubble(ctx, bubble) {
    ctx.save();
    ctx.globalAlpha = bubble.alpha * bubble.fadeIn;

    const { x, y, radius, color } = bubble;

    // ── 外光晕 ──
    const glowGrad = ctx.createRadialGradient(x, y, radius * 0.7, x, y, radius * 1.4);
    glowGrad.addColorStop(0, color);
    glowGrad.addColorStop(0.5, color + '44');
    glowGrad.addColorStop(1, 'transparent');

    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.4, 0, Math.PI * 2);
    ctx.fill();

    // ── 泡泡主体 ──
    const bodyGrad = ctx.createRadialGradient(
      x - radius * 0.25, y - radius * 0.25, radius * 0.1,
      x, y, radius
    );
    bodyGrad.addColorStop(0, '#ffffff');
    bodyGrad.addColorStop(0.35, color);
    bodyGrad.addColorStop(0.7, color + 'cc');
    bodyGrad.addColorStop(1, color + '66');

    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // ── 白色半月形高光反射 ──
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.ellipse(
      x - radius * 0.25, y - radius * 0.3,
      radius * 0.35, radius * 0.15,
      -Math.PI / 6, 0, Math.PI * 2
    );
    ctx.fill();

    // 小高光点
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.beginPath();
    ctx.arc(x - radius * 0.3, y - radius * 0.35, radius * 0.1, 0, Math.PI * 2);
    ctx.fill();

    // ── 表情（kawaii 风格）──
    if (bubble.hasFace) {
      this._drawFace(ctx, x, y, radius, bubble.faceStyle);
    }

    // ── 惊喜泡泡标记：小星星 ──
    if (bubble.isSurprise) {
      this._drawTinyStar(ctx, x + radius * 0.6, y - radius * 0.6, radius * 0.2);
    }

    ctx.restore();
  }

  /**
   * 绘制 kawaii 表情
   * @param {number} style — 表情风格（0-3）
   */
  _drawFace(ctx, x, y, radius, style) {
    ctx.fillStyle = '#2d1b69';
    const eyeSize = radius * 0.12;
    const eyeY = y - radius * 0.1;
    const eyeOffsetX = radius * 0.28;

    if (style === 0) {
      // 标准笑眼：小圆点 + 微笑弧线
      ctx.beginPath();
      ctx.arc(x - eyeOffsetX, eyeY, eyeSize, 0, Math.PI * 2);
      ctx.arc(x + eyeOffsetX, eyeY, eyeSize, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#2d1b69';
      ctx.lineWidth = Math.max(1.5, radius * 0.08);
      ctx.beginPath();
      ctx.arc(x, y + radius * 0.15, radius * 0.2, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();

    } else if (style === 1) {
      // 开心眯眼：弧线眼
      ctx.strokeStyle = '#2d1b69';
      ctx.lineWidth = Math.max(1.5, radius * 0.07);
      ctx.beginPath();
      ctx.arc(x - eyeOffsetX, eyeY, eyeSize * 1.2, Math.PI, 0);
      ctx.arc(x + eyeOffsetX, eyeY, eyeSize * 1.2, Math.PI, 0);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y + radius * 0.12, radius * 0.22, 0.05 * Math.PI, 0.95 * Math.PI);
      ctx.stroke();

    } else if (style === 2) {
      // 惊讶：大圆眼 + O 嘴
      ctx.beginPath();
      ctx.arc(x - eyeOffsetX, eyeY, eyeSize * 1.5, 0, Math.PI * 2);
      ctx.arc(x + eyeOffsetX, eyeY, eyeSize * 1.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y + radius * 0.25, radius * 0.15, 0, Math.PI * 2);
      ctx.fill();

    } else if (style === 3) {
      // 眨眼：一只眼闭 + 微笑
      ctx.beginPath();
      ctx.arc(x - eyeOffsetX, eyeY, eyeSize, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#2d1b69';
      ctx.lineWidth = Math.max(1.5, radius * 0.07);
      ctx.beginPath();
      ctx.arc(x + eyeOffsetX, eyeY, eyeSize * 1.2, Math.PI, 0);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y + radius * 0.1, radius * 0.25, 0.05 * Math.PI, 0.95 * Math.PI);
      ctx.stroke();
    }
  }

  /**
   * 绘制小星星
   */
  _drawTinyStar(ctx, x, y, size) {
    const points = 5;
    const innerR = size * 0.4;
    const outerR = size;

    ctx.fillStyle = '#ffd93d';
    ctx.globalAlpha = 0.8;
    ctx.beginPath();

    for (let i = 0; i < points * 2; i++) {
      const angle = (Math.PI * 2 * i) / (points * 2) - Math.PI / 2;
      const r = i % 2 === 0 ? outerR : innerR;
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }

    ctx.closePath();
    ctx.fill();
  }

  // ─── 破裂动画 ──────────────────────────────────────────────

  /**
   * 更新破裂动画状态
   */
  _updatePopAnimation(pop, timestamp) {
    const elapsed = timestamp - pop.startTime;

    if (pop.phase === POP_PHASE.INFLATE) {
      // 膨胀阶段：scale 1.0 → 1.4（或 2.0 超大破裂）
      const maxScale = pop.isSuper ? 2.0 : 1.4;
      const progress = Math.min(1, elapsed / POP_DURATION.inflate);
      pop.scale = 1.0 + (maxScale - 1.0) * this._easeOutQuad(progress);

      if (elapsed >= POP_DURATION.inflate) {
        pop.phase = POP_PHASE.BURST;
        pop.startTime = timestamp;
        pop.scale = maxScale;
        this._generatePopParticles(pop);
      }

    } else if (pop.phase === POP_PHASE.BURST) {
      // 散开阶段：环状爆裂渐隐
      const progress = Math.min(1, elapsed / POP_DURATION.burst);
      pop.alpha = 1 - progress;

      // 更新粒子
      for (const p of pop.particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.alpha = Math.max(0, p.alpha - p.alphaDecay);
      }

      // 更新星星粒子
      for (const sp of pop.starParticles) {
        sp.alpha = Math.max(0, sp.alpha - sp.alphaDecay);
        sp.x = pop.x + Math.cos(sp.angle) * sp.speed * sp.alpha * 30;
        sp.y = pop.y + Math.sin(sp.angle) * sp.speed * sp.alpha * 30;
      }

      if (elapsed >= POP_DURATION.burst) {
        pop.phase = POP_PHASE.PARTICLES;
        pop.startTime = timestamp;
      }

    } else if (pop.phase === POP_PHASE.PARTICLES) {
      // 粒子渐隐阶段
      const progress = Math.min(1, elapsed / POP_DURATION.particles);

      // 散落小泡泡特殊处理
      if (pop.scatterAngle !== undefined) {
        pop.scatterAngle += 0.03;
        pop.x += Math.cos(pop.scatterAngle) * pop.scatterSpeed;
        pop.y += pop.vy;
        pop.vy += pop.scatterGravity;
        pop.alpha = 1 - progress;
      }

      // 更新粒子
      for (const p of pop.particles) {
        p.x += p.vx * 0.3;
        p.y += p.vy * 0.3 + 0.02;
        p.alpha = Math.max(0, p.alpha - p.alphaDecay * 2);
      }

      // 更新星星粒子
      for (const sp of pop.starParticles) {
        sp.alpha = Math.max(0, sp.alpha - sp.alphaDecay * 2);
      }
    }
  }

  /**
   * 生成破裂粒子
   */
  _generatePopParticles(pop) {
    const count = pop.isSuper ? 12 : 8;
    const spread = pop.isSuper ? 2.5 : 1.5;

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.3;
      const speed = spread + Math.random() * 1.5;

      pop.particles.push({
        x: pop.x,
        y: pop.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2 + Math.random() * 4,
        color: BUBBLE_COLORS[Math.floor(Math.random() * BUBBLE_COLORS.length)],
        alpha: 0.9,
        alphaDecay: 0.01 + Math.random() * 0.02,
      });
    }
  }

  /**
   * 绘制破裂动画
   */
  _drawPopAnimation(ctx, pop, timestamp) {
    ctx.save();

    if (pop.phase === POP_PHASE.INFLATE) {
      // 膨胀泡泡
      const r = pop.radius * pop.scale;
      ctx.globalAlpha = 0.7;

      // 外光晕
      const glowGrad = ctx.createRadialGradient(pop.x, pop.y, r * 0.5, pop.x, pop.y, r * 1.2);
      glowGrad.addColorStop(0, pop.color);
      glowGrad.addColorStop(1, 'transparent');

      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(pop.x, pop.y, r * 1.2, 0, Math.PI * 2);
      ctx.fill();

    } else if (pop.phase === POP_PHASE.BURST) {
      // 环状爆裂
      const ringR = pop.radius * pop.scale + 20;
      ctx.globalAlpha = pop.alpha * 0.8;

      // 白色环
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(pop.x, pop.y, ringR, 0, Math.PI * 2);
      ctx.stroke();

      // 彩色环
      ctx.strokeStyle = pop.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pop.x, pop.y, ringR * 0.7, 0, Math.PI * 2);
      ctx.stroke();

    } else if (pop.phase === POP_PHASE.PARTICLES) {
      if (pop.scatterAngle !== undefined) {
        // 散落小泡泡
        ctx.globalAlpha = pop.alpha;
        ctx.fillStyle = pop.color;
        ctx.beginPath();
        ctx.arc(pop.x, pop.y, pop.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 绘制粒子（所有阶段共享）
    for (const p of pop.particles) {
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // 绘制星星粒子
    for (const sp of pop.starParticles) {
      if (sp.alpha > 0) {
        ctx.globalAlpha = sp.alpha;
        this._drawTinyStar(ctx, sp.x || pop.x, sp.y || pop.y, sp.size);
      }
    }

    ctx.restore();
  }

  // ─── 工具方法 ──────────────────────────────────────────────

  /**
   * 确保画布尺寸正确
   */
  _ensureCanvasSize() {
    const rect = this.canvas.parentElement
      ? this.canvas.parentElement.getBoundingClientRect()
      : { width: this.canvas.width, height: this.canvas.height };

    const targetW = 1376;
    const targetH = 768;
    const scaleX = rect.width / targetW;
    const scaleY = rect.height / targetH;
    this._scale = Math.min(scaleX, scaleY);

    this.canvas.width = rect.width || targetW;
    this.canvas.height = rect.height || targetH;
  }

  /** easeOutQuad 缓动函数 */
  _easeOutQuad(t) {
    return t * (2 - t);
  }
}

export { BubblePop };
