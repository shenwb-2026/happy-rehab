// 泡泡消除游戏（规格书 9.4 节）
// 纯感官即时反馈——行走→破泡泡→新泡泡。Canvas 2D 全量渲染，无外部图片。
// 美术规范：深紫/深蓝背景，高饱和彩虹色泡泡，2-3px 黑色描边，白色高光。

import { GameInterface } from '../GameInterface.js';
import { GAME_CONFIG } from '../../config.js';

const COLORS = ['#FF6B9D', '#FF8C42', '#FFD93D', '#6BCB77', '#4D96FF', '#B388FF', '#FF4747', '#00D4AA'];
const SPECIAL_EVERY = GAME_CONFIG.bubbleSpecialEvery ?? 5;
const SURPRISE_RATIO = GAME_CONFIG.bubbleSurpriseRatio ?? 0.125;
const STREAK_BONUS_AT = GAME_CONFIG.streakBonusAt ?? 5;

function rand(min, max) { return min + Math.random() * (max - min); }
function lerp(a, b, t) { return a + (b - a) * t; }

class BubblePop extends GameInterface {
  constructor(canvas, soundEngine) {
    super();
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.sound  = soundEngine;

    this._bubbles     = [];
    this._pops        = [];        // 活跃破裂动画
    this._particles   = [];        // 粒子系统
    this._miniPops    = [];        // 连续奖励散落小泡泡
    this._rafId       = null;
    this._lastFrameT  = 0;
    this._isActive    = false;
    this._isResting   = false;
    this._firstStep   = true;      // 是否是第一步（开场仪式）
    this._totalSteps  = 0;
    this._streakCount = 0;
    this._popCount    = 0;         // 已破裂总数（用于特殊泡泡计数）
    this._introPhase  = 0;        // 开场动画进度 0→1
    this._outroActive = false;
    this._outroPops   = [];
    this._outroTimer  = 0;
  }

  // ─── GameInterface 生命周期 ────────────────────────────────

  onSessionStart() {
    this._isActive   = true;
    this._isResting  = false;
    this._firstStep  = true;
    this._totalSteps = 0;
    this._streakCount = 0;
    this._popCount   = 0;
    this._introPhase = 0;
    this._bubbles    = [];
    this._pops       = [];
    this._particles  = [];
    this._miniPops   = [];
    this._outroActive = false;
    // 开场：屏幕暗，等待第一步触发泡泡涌现
    this._startLoop();
  }

  onStep(timestamp, side) {
    if (!this._isActive || this._isResting) return;
    this._totalSteps++;
    this._streakCount++;
    this._popCount++;

    if (this._firstStep) {
      // 第一步：所有泡泡从底部涌现
      this._firstStep = false;
      this._spawnInitialBubbles();
    } else {
      this._ensureBubbleCount();
    }

    // 判断是否是连续奖励步（第 STREAK_BONUS_AT 步）
    const isStreakBonus = (this._streakCount % STREAK_BONUS_AT === 0);

    // 找最近泡泡并破裂
    const target = this._findNearestBubble();
    if (target !== null) {
      const b = this._bubbles[target];
      this._triggerPop(b.x, b.y, b.r, b.color, b.isSurprise, isStreakBonus);
      this._bubbles.splice(target, 1);
      // 底部补充新泡泡
      this._spawnBubble(true);
    }

    this.sound?.playStepSound(this._streakCount);
    if (isStreakBonus) {
      this.sound?.playCelebration();
    }
  }

  onRestStart() {
    this._isResting = true;
  }

  onRestEnd() {
    this._isResting = false;
    this._streakCount = 0;
    this._ensureBubbleCount();
  }

  onSessionEnd() {
    this._isActive   = false;
    this._isResting  = false;
    this._outroActive = true;
    this._outroTimer  = 0;
    // 把剩余泡泡排列成从下到上依次破裂
    this._outroPops = [...this._bubbles]
      .sort((a, b) => b.y - a.y)
      .map((b, i) => ({ ...b, delay: i * 80 }));
    this._bubbles = [];
  }

  getStreakCount() { return this._streakCount; }

  getCanvas() { return this.canvas; }

  destroy() {
    this._isActive = false;
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }

  // ─── 渲染循环 ─────────────────────────────────────────────

  _startLoop() {
    const loop = (now) => {
      if (!this._isActive && !this._outroActive) return;
      this._rafId = requestAnimationFrame(loop);
      const dt = Math.min(now - this._lastFrameT, 50);
      this._lastFrameT = now;
      this._update(dt, now);
      this._draw(now);
    };
    this._lastFrameT = performance.now();
    this._rafId = requestAnimationFrame(loop);
  }

  _update(dt, now) {
    const W = this.canvas.width, H = this.canvas.height;

    // 更新泡泡位置
    if (!this._isResting) {
      for (const b of this._bubbles) {
        b.y -= b.vy * dt * 0.06;
        b.x += Math.sin(now * 0.001 + b.phase) * 0.3;
        if (b.y + b.r < 0) {
          // 超出顶部，重置到底部
          b.y = H + b.r;
          b.x = rand(b.r, W - b.r);
        }
      }
    }

    // 更新破裂动画
    this._pops = this._pops.filter(p => {
      p.elapsed += dt;
      return p.elapsed < p.duration;
    });

    // 更新粒子
    this._particles = this._particles.filter(p => {
      p.x += p.vx * dt * 0.06;
      p.y += p.vy * dt * 0.06;
      p.vy += 0.05;
      p.life -= dt;
      return p.life > 0;
    });

    // 更新散落小泡泡
    this._miniPops = this._miniPops.filter(m => {
      m.x += m.vx * dt * 0.06;
      m.y += m.vy * dt * 0.06;
      m.vy += 0.04;
      m.life -= dt;
      return m.life > 0;
    });

    // 结尾链式破裂
    if (this._outroActive) {
      this._outroTimer += dt;
      for (const b of this._outroPops) {
        if (!b._popped && this._outroTimer >= b.delay) {
          b._popped = true;
          this._triggerPop(b.x, b.y, b.r, b.color, false, false);
          this.sound?.playBubblePop();
        }
      }
      if (this._outroTimer > this._outroPops.length * 80 + 800 &&
          this._pops.length === 0 && this._particles.length === 0) {
        this._outroActive = false;
        if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
      }
    }
  }

  _draw(now) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;

    // 背景
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1a0050');
    bg.addColorStop(1, '#2d0a54');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    if (this._firstStep) {
      // 开场黑暗：显示提示文字
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = `bold ${Math.round(H * 0.04)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('走第一步，泡泡就来啦！', W / 2, H / 2);
      return;
    }

    // 绘制泡泡
    for (const b of this._bubbles) {
      this._drawBubble(ctx, b.x, b.y, b.r, b.color, b.isSurprise, now);
    }

    // 绘制散落小泡泡
    for (const m of this._miniPops) {
      const alpha = m.life / m.maxLife;
      this._drawBubble(ctx, m.x, m.y, m.r * alpha, m.color, false, now);
    }

    // 绘制粒子
    for (const p of this._particles) {
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 绘制破裂动画
    for (const pop of this._pops) {
      this._drawPop(ctx, pop, now);
    }

    // HUD：步数显示（右上角）
    if (this._totalSteps > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = `bold ${Math.round(H * 0.045)}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(`${this._totalSteps} 步`, W - 20, 50);
    }

    // 连续步数进度点（右上角）
    this._drawStreakDots(ctx, W, H);
  }

  // ─── 绘制工具 ─────────────────────────────────────────────

  _drawBubble(ctx, x, y, r, color, isSurprise, now) {
    if (r <= 0) return;
    // 主体
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = Math.max(1.5, r * 0.06);
    ctx.stroke();

    // 白色高光（左上角椭圆光斑）
    ctx.save();
    ctx.translate(x - r * 0.28, y - r * 0.28);
    ctx.scale(1, 0.6);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();
    ctx.restore();

    // 惊喜泡泡：小笑脸
    if (isSurprise) {
      ctx.fillStyle = '#333';
      // 眼睛
      ctx.beginPath(); ctx.arc(x - r * 0.22, y - r * 0.12, r * 0.09, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + r * 0.22, y - r * 0.12, r * 0.09, 0, Math.PI * 2); ctx.fill();
      // 笑容
      ctx.beginPath();
      ctx.arc(x, y + r * 0.08, r * 0.22, 0.1, Math.PI - 0.1);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = Math.max(1.5, r * 0.06);
      ctx.stroke();
    }
  }

  _drawPop(ctx, pop, now) {
    const t = pop.elapsed / pop.duration;
    const { x, y, r, color, isBonus } = pop;

    if (t < 0.3) {
      // 膨胀阶段
      const scale = lerp(1, isBonus ? 2.2 : 1.4, t / 0.3);
      const alpha = 1 - t / 0.3 * 0.5;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, r * scale, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = isBonus ? 5 : 3;
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      // 爆裂光芒放射
      const progress = (t - 0.3) / 0.7;
      const numRays = isBonus ? 12 : 8;
      const maxLen  = r * (isBonus ? 2.5 : 1.8);
      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = 1 - progress;
      for (let i = 0; i < numRays; i++) {
        const angle = (i / numRays) * Math.PI * 2;
        const len   = maxLen * progress;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * r * 0.5, Math.sin(angle) * r * 0.5);
        ctx.lineTo(Math.cos(angle) * len, Math.sin(angle) * len);
        ctx.strokeStyle = color;
        ctx.lineWidth   = isBonus ? 4 : 2.5;
        ctx.lineCap     = 'round';
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  _drawStreakDots(ctx, W, H) {
    const n     = STREAK_BONUS_AT;
    const pos   = this._streakCount % n;
    const dotR  = Math.round(H * 0.022);
    const gap   = dotR * 2.8;
    const startX = W - (n * gap) - 20;
    const dotY  = 30;

    for (let i = 0; i < n; i++) {
      const filled = i < pos;
      const cx = startX + i * gap + dotR;
      ctx.beginPath();
      ctx.arc(cx, dotY, dotR, 0, Math.PI * 2);
      ctx.fillStyle = filled ? '#FFD93D' : 'rgba(255,255,255,0.2)';
      ctx.fill();
      ctx.strokeStyle = filled ? '#e6a800' : 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // ─── 泡泡管理 ─────────────────────────────────────────────

  _spawnInitialBubbles() {
    const W = this.canvas.width, H = this.canvas.height;
    const count = 18;
    for (let i = 0; i < count; i++) {
      const r  = rand(30, 60);
      const b  = {
        x:         rand(r, W - r),
        y:         H + r + rand(0, H * 0.5), // 从屏幕底部下方开始
        r,
        color:     COLORS[Math.floor(Math.random() * COLORS.length)],
        vy:        rand(0.5, 1.2),
        phase:     rand(0, Math.PI * 2),
        isSurprise: Math.random() < SURPRISE_RATIO,
        _introDelay: i * 60,
        _introStart: performance.now(),
      };
      // 为开场动画：泡泡从底部涌现，稍微提前设置位置
      b.y = H + r + (count - i) * 40;
      this._bubbles.push(b);
    }
  }

  _spawnBubble(fromBottom = false) {
    const W = this.canvas.width, H = this.canvas.height;
    const r = rand(28, 62);
    this._bubbles.push({
      x:          rand(r, W - r),
      y:          fromBottom ? H + r * 2 : -r,
      r,
      color:      COLORS[Math.floor(Math.random() * COLORS.length)],
      vy:         rand(0.5, 1.2),
      phase:      rand(0, Math.PI * 2),
      isSurprise: Math.random() < SURPRISE_RATIO,
    });
  }

  _ensureBubbleCount() {
    const target = 15;
    while (this._bubbles.length < target) {
      this._spawnBubble(true);
    }
  }

  _findNearestBubble() {
    if (!this._bubbles.length) return null;
    const cx = this.canvas.width  / 2;
    const cy = this.canvas.height / 2;
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < this._bubbles.length; i++) {
      const b = this._bubbles[i];
      const d = Math.hypot(b.x - cx, b.y - cy);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  _triggerPop(x, y, r, color, isSurprise, isBonus) {
    const duration = isBonus ? 600 : 400;
    this._pops.push({ x, y, r, color, isSurprise, isBonus, elapsed: 0, duration });

    // 发射粒子
    const count = isBonus ? 16 : 8;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rand(-0.3, 0.3);
      const speed = rand(isBonus ? 4 : 2, isBonus ? 9 : 5);
      const maxLife = GAME_CONFIG.particleLifetimeMs ?? 700;
      this._particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1,
        r:  rand(4, isBonus ? 10 : 7),
        color,
        life: maxLife * rand(0.6, 1.0),
        maxLife,
      });
    }

    // 连续奖励：散落 5 个小泡泡
    if (isBonus) {
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const speed = rand(3, 7);
        const life  = 800;
        this._miniPops.push({
          x: x + Math.cos(angle) * r,
          y: y + Math.sin(angle) * r,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2,
          r:  rand(12, 22),
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          life,
          maxLife: life,
        });
      }
    }
  }
}

export { BubblePop };
