/**
 * 陪伴之旅游戏 — CompanionJourney
 *
 * 养成叙事类游戏。适配喜欢情感互动、养成角色、积累成就感的儿童。
 *
 * 核心机制：
 * - 陪伴角色（狐狸/兔子/恐龙）固定在屏幕中央
 * - 每一步触发弹跳动画 + 粒子 + 路径瓷砖生成
 * - 连续步数系统 + 饥饿值进度条
 * - 场景解锁：森林→海滩→太空（跨训练累计步数）
 * - 训练仪式：开场打哈欠 + 收尾庆祝入睡
 *
 * 所有角色和场景由 Canvas 2D 代码绘制，无外部图片资源。
 */

import { GameInterface } from '../GameInterface.js';
import { GAME_CONFIG } from '../../config.js';

// ─── 常量 ─────────────────────────────────────────────────────
const STREAK_BONUS_AT = GAME_CONFIG.streakBonusAt || 5;
const STREAK_TIMEOUT_MS = GAME_CONFIG.streakTimeoutMs || 5000;
const HUNGER_PER_STEP = GAME_CONFIG.hungerIncreasePerStep || 5;
const BOUNCE_DURATION_MS = GAME_CONFIG.bounceAnimationMs || 350;
const PARTICLE_LIFETIME_MS = GAME_CONFIG.particleLifetimeMs || 700;
const STREAK_DANCE_MS = GAME_CONFIG.streakDanceMs || 2000;
const BONUS_TILES = GAME_CONFIG.streakBonusTiles || 5;
const SCENE_UNLOCK_STEPS = 50;

/** 场景主题列表 */
const SCENES = ['forest', 'beach', 'space'];

/** 角色定义 */
const CHARACTERS = {
  fox: { name: '狐狸', color: '#ff8c42', earColor: '#e6732e' },
  rabbit: { name: '兔子', color: '#ffb3d9', earColor: '#ff8cc8' },
  dino: { name: '恐龙', color: '#6bcb77', earColor: '#4aad5c' },
};

/** 场景主题瓷砖类型 */
const SCENE_TILES = {
  forest: ['🌸', '🍄', '🪨', '🌿', '🌻'],
  beach: ['🐚', '⭐', '🪨', '🌊', '🦀'],
  space: ['⭐', '🌙', '🪨', '🪐', '💫'],
};

/** 场景背景色 */
const SCENE_COLORS = {
  forest: { top: '#1a3a1a', bottom: '#2d5a27' },
  beach: { top: '#1a3a4a', bottom: '#4a7a8a' },
  space: { top: '#0a0a2e', bottom: '#1a1a4e' },
};

// ─── 陪伴之旅游戏类 ──────────────────────────────────────────

class CompanionJourney extends GameInterface {
  /**
   * @param {HTMLCanvasElement} canvas — 游戏画布
   * @param {Object} soundEngine — SoundEngine 实例
   */
  constructor(canvas, soundEngine) {
    super();
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.soundEngine = soundEngine;

    // ── 角色状态 ──
    this._character = 'fox';
    this._characterDef = CHARACTERS.fox;

    // ── 场景状态 ──
    this._currentScene = 'forest';
    this._pathTiles = [];
    this._scrollOffset = 0;

    // ── 游戏状态 ──
    this.totalSteps = 0;
    this.streakCount = 0;
    this._hunger = 0;
    this._lastStepTime = 0;
    this._streakTimeoutId = null;
    this._isActive = false;
    this._isResting = false;

    // ── 动画状态 ──
    this._animations = {
      bounce: null,
      dance: null,
      intro: null,
      outro: null,
    };
    this._particles = [];
    this._streakDots = [];

    // ── 渲染 ──
    this._rafId = null;
    this._lastFrameTime = 0;
    this._scale = 1;
    this._breathPhase = 0;
    this._totalAccumSteps = 0;
    this._sceneUnlocked = null;

    this._loadPersistedData();
  }

  // ─── localStorage 持久化 ───────────────────────────────────

  _loadPersistedData() {
    try {
      const character = localStorage.getItem('hrg.companion.character');
      if (character && CHARACTERS[character]) {
        this._character = character;
        this._characterDef = CHARACTERS[character];
      }
      const steps = localStorage.getItem('hrg.progress.totalSteps');
      this._totalAccumSteps = steps ? parseInt(steps, 10) || 0 : 0;
      const scene = localStorage.getItem('hrg.progress.currentScene');
      if (scene && SCENES.includes(scene)) this._currentScene = scene;
    } catch (e) { /* 静默 */ }
  }

  _savePersistedData() {
    try {
      this._totalAccumSteps += this.totalSteps;
      localStorage.setItem('hrg.progress.totalSteps', String(this._totalAccumSteps));
      if (this._totalAccumSteps >= SCENE_UNLOCK_STEPS * 2
        && this._totalAccumSteps - this.totalSteps < SCENE_UNLOCK_STEPS * 2) {
        this._sceneUnlocked = 'space';
        this._currentScene = 'space';
      } else if (this._totalAccumSteps >= SCENE_UNLOCK_STEPS
        && this._totalAccumSteps - this.totalSteps < SCENE_UNLOCK_STEPS) {
        this._sceneUnlocked = 'beach';
        this._currentScene = 'beach';
      }
      localStorage.setItem('hrg.progress.currentScene', this._currentScene);
    } catch (e) { /* 静默 */ }
  }

  // ─── 生命周期 ──────────────────────────────────────────────

  onSessionStart() {
    this._ensureCanvasSize();
    this._isActive = true;
    this._isResting = false;
    this.totalSteps = 0;
    this.streakCount = 0;
    this._hunger = 0;
    this._particles = [];
    this._pathTiles = [];
    this._scrollOffset = 0;
    this._streakDots = [];
    this._sceneUnlocked = null;
    for (let i = 0; i < 10; i++) this._addPathTile();
    this._animations.intro = { phase: 'yawn', startTime: performance.now() };
    this._startRenderLoop();
  }

  onStep(timestamp, side) {
    if (!this._isActive || this._isResting) return;
    const now = timestamp || performance.now();
    this.totalSteps++;
    this.streakCount++;
    this._lastStepTime = now;
    this._updateStreakDots();
    this._animations.bounce = { startTime: now, duration: BOUNCE_DURATION_MS };
    this._emitParticles(now);
    this._addPathTile();
    this._hunger = Math.min(100, this._hunger + HUNGER_PER_STEP);
    if (this.soundEngine) this.soundEngine.playStepSound(this.streakCount);
    if (this.streakCount > 0 && this.streakCount % STREAK_BONUS_AT === 0) {
      this._triggerStreakBonus(now);
    }
    this._resetStreakTimeout();
    this._scrollOffset += 40;
    if (this._scrollOffset > 80) {
      this._scrollOffset = 0;
      this._pathTiles = this._pathTiles.filter(t => t.screenX > -120);
    }
  }

  onRestStart() {
    this._isResting = true;
    if (this._streakTimeoutId) { clearTimeout(this._streakTimeoutId); this._streakTimeoutId = null; }
  }

  onRestEnd() {
    this._isResting = false;
    this._resetStreakTimeout();
  }

  onSessionEnd() {
    this._isActive = false;
    this._animations.outro = { phase: 'celebrate', startTime: performance.now() };
    this._savePersistedData();
    if (this._streakTimeoutId) { clearTimeout(this._streakTimeoutId); this._streakTimeoutId = null; }
    return { totalSteps: this.totalSteps, streakCount: this.streakCount };
  }

  getStreakCount() { return this.streakCount; }
  getCanvas() { return this.canvas; }

  destroy() {
    this._stopRenderLoop();
    this._particles = [];
    this._pathTiles = [];
    this._isActive = false;
    if (this._streakTimeoutId) clearTimeout(this._streakTimeoutId);
  }

  // ─── 连续步数 ──────────────────────────────────────────────

  _updateStreakDots() {
    const filled = this.streakCount % STREAK_BONUS_AT;
    this._streakDots = [];
    for (let i = 0; i < STREAK_BONUS_AT; i++) {
      this._streakDots.push({ filled: i < filled, flashing: false });
    }
  }

  _triggerStreakBonus(now) {
    this._streakDots = this._streakDots.map(() => ({ filled: true, flashing: true }));
    this._animations.dance = { startTime: now, duration: STREAK_DANCE_MS };
    if (this.soundEngine) this.soundEngine.playCelebration();
    for (let i = 0; i < BONUS_TILES; i++) this._addPathTile();
  }

  _resetStreakTimeout() {
    if (this._streakTimeoutId) clearTimeout(this._streakTimeoutId);
    this._streakTimeoutId = setTimeout(() => {
      this.streakCount = 0;
      this._streakDots = [];
      this._streakTimeoutId = null;
    }, STREAK_TIMEOUT_MS);
  }

  // ─── 路径瓷砖 ──────────────────────────────────────────────

  _addPathTile() {
    const tiles = SCENE_TILES[this._currentScene] || SCENE_TILES.forest;
    const emoji = tiles[Math.floor(Math.random() * tiles.length)];
    this._pathTiles.push({
      emoji,
      screenX: this.canvas.width * 0.15 + this._pathTiles.length * 60,
      baseY: this.canvas.height * 0.78 + Math.random() * 20,
      size: 24 + Math.random() * 8,
    });
  }

  // ─── 粒子 ──────────────────────────────────────────────────

  _emitParticles(now) {
    const cx = this.canvas.width * 0.3;
    const cy = this.canvas.height * 0.52;
    const cols = ['#ff6b9d', '#ff8c42', '#ffd93d', '#6bcb77', '#4d96ff', '#b388ff', '#ff6b9d', '#ff8c42'];
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8 + (Math.random() - 0.5) * 0.4;
      const speed = 2 + Math.random() * 3;
      this._particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1,
        size: 4 + Math.random() * 6,
        color: cols[i % cols.length],
        alpha: 1,
        alphaDecay: 1 / (PARTICLE_LIFETIME_MS / 16),
        startTime: now,
      });
    }
  }

  // ─── 渲染循环 ──────────────────────────────────────────────

  _startRenderLoop() {
    if (this._rafId) return;
    this._lastFrameTime = performance.now();
    const loop = (ts) => {
      if (!this._isActive && !this._animations.outro) return;
      this._renderLoop(ts);
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  _stopRenderLoop() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }

  _renderLoop(timestamp) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    this._lastFrameTime = timestamp;
    this._drawBackground(ctx, w, h);
    this._drawPathTiles(ctx);
    this._drawCharacter(ctx, timestamp);
    this._drawParticles(ctx);
    this._drawStreakDots(ctx, w, h);
    this._drawHungerBar(ctx, w);
    if (this._animations.outro) this._drawOutro(ctx, w, h, timestamp);
  }

  // ─── 背景 ──────────────────────────────────────────────────

  _drawBackground(ctx, w, h) {
    const c = SCENE_COLORS[this._currentScene] || SCENE_COLORS.forest;
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, c.top); bg.addColorStop(1, c.bottom);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

    if (this._currentScene === 'forest') this._drawForestBG(ctx, w, h);
    else if (this._currentScene === 'beach') this._drawBeachBG(ctx, w, h);
    else if (this._currentScene === 'space') this._drawSpaceBG(ctx, w, h);

    ctx.fillStyle = this._currentScene === 'space' ? 'rgba(20,20,60,0.8)' : 'rgba(40,80,40,0.6)';
    ctx.fillRect(0, h * 0.82, w, h * 0.18);
  }

  _drawForestBG(ctx, w, h) {
    ctx.fillStyle = 'rgba(30,60,30,0.3)';
    for (let i = 0; i < 5; i++) {
      const tx = w * 0.1 + i * w * 0.2, th = h * 0.4 + Math.sin(i * 2) * 30;
      ctx.beginPath(); ctx.moveTo(tx - 40, h * 0.82); ctx.lineTo(tx, th); ctx.lineTo(tx + 40, h * 0.82); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    for (let i = 0; i < 3; i++) {
      const cx = w * 0.2 + i * w * 0.35, cy = h * 0.15 + Math.sin(i) * 20;
      ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.arc(cx + 25, cy - 10, 25, 0, Math.PI * 2); ctx.arc(cx - 20, cy + 5, 20, 0, Math.PI * 2); ctx.fill();
    }
  }

  _drawBeachBG(ctx, w, h) {
    ctx.strokeStyle = 'rgba(100,180,220,0.3)'; ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const by = h * 0.25 + i * 20;
      ctx.beginPath(); ctx.moveTo(0, by);
      for (let x = 0; x < w; x += 20) ctx.lineTo(x, by + Math.sin(x * 0.02 + i) * 8);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(200,180,140,0.15)';
    for (let i = 0; i < 15; i++) { ctx.beginPath(); ctx.arc(Math.random() * w, h * 0.78 + Math.random() * h * 0.22, 1.5, 0, Math.PI * 2); ctx.fill(); }
  }

  _drawSpaceBG(ctx, w, h) {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 40; i++) {
      const sx = (i * 137 + 31) % w, sy = (i * 73 + 17) % (h * 0.7), ss = 1 + (i % 3);
      ctx.beginPath(); ctx.arc(sx, sy, ss, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(160,100,255,0.15)'; ctx.beginPath(); ctx.arc(w * 0.85, h * 0.15, 50, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,150,100,0.1)'; ctx.beginPath(); ctx.arc(w * 0.75, h * 0.3, 30, 0, Math.PI * 2); ctx.fill();
  }

  // ─── 路径瓷砖 ──────────────────────────────────────────────

  _drawPathTiles(ctx) {
    const w = this.canvas.width;
    for (const tile of this._pathTiles) {
      const x = tile.screenX - this._scrollOffset;
      if (x < -60 || x > w + 60) continue;
      ctx.save();
      ctx.font = `${tile.size}px "PingFang SC", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(tile.emoji, x, tile.baseY);
      ctx.restore();
    }
    if (this._scrollOffset > 0 && !this._isResting) {
      this._scrollOffset *= 0.95;
      if (this._scrollOffset < 0.1) this._scrollOffset = 0;
    }
  }

  // ─── 角色绘制 ──────────────────────────────────────────────

  _drawCharacter(ctx, timestamp) {
    const cx = this.canvas.width * 0.3;
    const cy = this.canvas.height * 0.52;
    let scale = 1.0;
    let offsetY = 0;

    // 开场仪式
    if (this._animations.intro) {
      const intro = this._animations.intro;
      const elapsed = timestamp - intro.startTime;
      if (intro.phase === 'yawn' && elapsed < 1000) {
        offsetY = Math.sin(elapsed / 1000 * Math.PI) * -5;
      } else if (intro.phase === 'yawn') {
        intro.phase = 'stretch'; intro.startTime = timestamp;
      } else if (intro.phase === 'stretch' && elapsed < 1000) {
        scale = 1.0 + Math.sin(elapsed / 1000 * Math.PI) * 0.08;
      } else if (intro.phase === 'stretch') {
        intro.phase = 'wave'; intro.startTime = timestamp;
      } else if (intro.phase === 'wave' && elapsed >= 1000) {
        this._animations.intro = null;
      }
    }

    // 弹跳动画
    if (this._animations.bounce) {
      const b = this._animations.bounce;
      const elapsed = timestamp - b.startTime;
      if (elapsed < b.duration) {
        scale += Math.sin((elapsed / b.duration) * Math.PI) * 0.15;
      } else { this._animations.bounce = null; }
    }

    // 舞蹈动画（旋转 + 弹跳，直接在本函数内处理）
    if (this._animations.dance) {
      const d = this._animations.dance;
      const elapsed = timestamp - d.startTime;
      if (elapsed < d.duration) {
        const progress = elapsed / d.duration;
        scale += Math.sin(progress * Math.PI * 4) * 0.1;
        const rotation = Math.sin(progress * Math.PI * 4) * 0.15;
        ctx.save(); ctx.translate(cx, cy + offsetY); ctx.rotate(rotation); ctx.scale(scale, scale);
        this._drawCharacterBody(ctx, 0, 0, timestamp); ctx.restore();
        return;
      } else { this._animations.dance = null; }
    }

    // 呼吸
    if (!this._animations.bounce && !this._animations.dance) {
      this._breathPhase += 0.03;
      scale += Math.sin(this._breathPhase) * 0.02;
    }

    ctx.save(); ctx.translate(cx, cy + offsetY); ctx.scale(scale, scale);
    this._drawCharacterBody(ctx, 0, 0, timestamp);

    // 挥手
    if (this._animations.intro && this._animations.intro.phase === 'wave') {
      const we = timestamp - this._animations.intro.startTime;
      ctx.save(); ctx.translate(30, -40); ctx.rotate(Math.sin(we * 0.015) * 0.4);
      ctx.fillStyle = this._characterDef.color;
      ctx.beginPath(); ctx.ellipse(0, 0, 12, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  _drawCharacterBody(ctx, x, y, timestamp) {
    if (this._character === 'fox') this._drawFox(ctx, x, y);
    else if (this._character === 'rabbit') this._drawRabbit(ctx, x, y);
    else if (this._character === 'dino') this._drawDino(ctx, x, y);
    if (!this._animations.bounce && !this._animations.dance) this._drawTail(ctx, x, y, timestamp);
  }

  _drawFox(ctx, x, y) {
    // 身体
    ctx.fillStyle = '#ff8c42';
    ctx.beginPath(); ctx.ellipse(x, y + 10, 35, 40, 0, 0, Math.PI * 2); ctx.fill();
    // 肚皮
    ctx.fillStyle = '#ffe0c0';
    ctx.beginPath(); ctx.ellipse(x, y + 15, 22, 28, 0, 0, Math.PI * 2); ctx.fill();
    // 头
    ctx.fillStyle = '#ff8c42';
    ctx.beginPath(); ctx.arc(x, y - 25, 22, 0, Math.PI * 2); ctx.fill();
    // 尖脸
    ctx.fillStyle = '#ffe0c0';
    ctx.beginPath(); ctx.moveTo(x - 12, y - 30); ctx.lineTo(x, y - 5); ctx.lineTo(x + 12, y - 30); ctx.closePath(); ctx.fill();
    // 耳朵
    ctx.fillStyle = '#ff8c42';
    ctx.beginPath(); ctx.moveTo(x - 12, y - 42); ctx.lineTo(x - 6, y - 70); ctx.lineTo(x + 8, y - 42); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 8, y - 42); ctx.lineTo(x + 6, y - 70); ctx.lineTo(x + 12, y - 42); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffb380';
    ctx.beginPath(); ctx.moveTo(x - 9, y - 44); ctx.lineTo(x - 5, y - 60); ctx.lineTo(x + 4, y - 44); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 4, y - 44); ctx.lineTo(x + 5, y - 60); ctx.lineTo(x + 9, y - 44); ctx.closePath(); ctx.fill();
    // 眼睛
    ctx.fillStyle = '#2d1b69';
    ctx.beginPath(); ctx.arc(x - 8, y - 28, 4, 0, Math.PI * 2); ctx.arc(x + 8, y - 28, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x - 7, y - 29, 1.5, 0, Math.PI * 2); ctx.arc(x + 9, y - 29, 1.5, 0, Math.PI * 2); ctx.fill();
    // 鼻子
    ctx.fillStyle = '#2d1b69';
    ctx.beginPath(); ctx.ellipse(x, y - 20, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
    // 嘴
    ctx.strokeStyle = '#2d1b69'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y - 16, 6, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
    // 脚
    ctx.fillStyle = '#e6732e';
    ctx.beginPath(); ctx.ellipse(x - 14, y + 45, 12, 7, 0, 0, Math.PI * 2); ctx.ellipse(x + 14, y + 45, 12, 7, 0, 0, Math.PI * 2); ctx.fill();
  }

  _drawRabbit(ctx, x, y) {
    ctx.fillStyle = '#ffb3d9';
    ctx.beginPath(); ctx.ellipse(x, y + 8, 32, 38, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe0f0';
    ctx.beginPath(); ctx.ellipse(x, y + 12, 20, 26, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffb3d9';
    ctx.beginPath(); ctx.arc(x, y - 22, 24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffb3d9';
    ctx.beginPath(); ctx.ellipse(x - 8, y - 68, 8, 25, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 8, y - 68, 8, 25, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd9e9';
    ctx.beginPath(); ctx.ellipse(x - 8, y - 66, 4, 18, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 8, y - 66, 4, 18, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2d1b69';
    ctx.beginPath(); ctx.arc(x - 9, y - 24, 4.5, 0, Math.PI * 2); ctx.arc(x + 9, y - 24, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x - 8, y - 25, 1.5, 0, Math.PI * 2); ctx.arc(x + 10, y - 25, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff6b9d';
    ctx.beginPath(); ctx.ellipse(x, y - 16, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2d1b69'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x - 3, y - 11, 4, 1.1 * Math.PI, 1.9 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + 3, y - 11, 4, 1.1 * Math.PI, 1.9 * Math.PI); ctx.stroke();
    ctx.fillStyle = 'rgba(255,100,150,0.3)';
    ctx.beginPath(); ctx.ellipse(x - 14, y - 16, 6, 4, 0, 0, Math.PI * 2); ctx.ellipse(x + 14, y - 16, 6, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff8cc8';
    ctx.beginPath(); ctx.ellipse(x - 12, y + 42, 11, 6, 0, 0, Math.PI * 2); ctx.ellipse(x + 12, y + 42, 11, 6, 0, 0, Math.PI * 2); ctx.fill();
  }

  _drawDino(ctx, x, y) {
    ctx.fillStyle = '#6bcb77';
    ctx.beginPath(); ctx.ellipse(x, y + 10, 34, 42, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#a8e6a3';
    ctx.beginPath(); ctx.ellipse(x, y + 14, 20, 28, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6bcb77';
    ctx.beginPath(); ctx.arc(x, y - 24, 21, 0, Math.PI * 2); ctx.fill();
    // 小角
    ctx.fillStyle = '#4aad5c';
    ctx.beginPath(); ctx.moveTo(x - 6, y - 44); ctx.lineTo(x - 2, y - 58); ctx.lineTo(x + 2, y - 44); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 2, y - 44); ctx.lineTo(x + 6, y - 58); ctx.lineTo(x + 12, y - 44); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 12, y - 44); ctx.lineTo(x - 8, y - 55); ctx.lineTo(x - 4, y - 44); ctx.closePath(); ctx.fill();
    // 背脊
    ctx.fillStyle = '#4aad5c';
    ctx.beginPath(); ctx.moveTo(x - 15, y - 18); ctx.lineTo(x - 8, y - 38); ctx.lineTo(x, y - 20); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 5, y - 19); ctx.lineTo(x + 2, y - 42); ctx.lineTo(x + 8, y - 20); ctx.fill();
    ctx.fillStyle = '#2d1b69';
    ctx.beginPath(); ctx.arc(x - 8, y - 28, 4, 0, Math.PI * 2); ctx.arc(x + 8, y - 28, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x - 7, y - 29, 1.5, 0, Math.PI * 2); ctx.arc(x + 9, y - 29, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2d1b69';
    ctx.beginPath(); ctx.ellipse(x, y - 19, 3.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2d1b69'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y - 15, 5, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
    // 腮红
    ctx.fillStyle = 'rgba(255,100,100,0.25)';
    ctx.beginPath(); ctx.ellipse(x - 14, y - 20, 5, 3.5, 0, 0, Math.PI * 2); ctx.ellipse(x + 14, y - 20, 5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4aad5c';
    ctx.beginPath(); ctx.ellipse(x - 14, y + 46, 12, 7, 0, 0, Math.PI * 2); ctx.ellipse(x + 14, y + 46, 12, 7, 0, 0, Math.PI * 2); ctx.fill();
  }

  _drawTail(ctx, x, y, timestamp) {
    const wobble = Math.sin(timestamp * 0.003 + this._breathPhase) * 8;
    ctx.fillStyle = this._characterDef.color;
    if (this._character === 'fox') {
      ctx.beginPath();
      ctx.moveTo(x - 20, y + 15);
      ctx.quadraticCurveTo(x - 45, y + 5 + wobble, x - 50, y + 25);
      ctx.quadraticCurveTo(x - 40, y + 20, x - 18, y + 35);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(x - 50, y + 22 + wobble * 0.5, 5, 0, Math.PI * 2); ctx.fill();
    } else if (this._character === 'rabbit') {
      ctx.beginPath(); ctx.arc(x - 25, y + 20 + wobble, 8, 0, Math.PI * 2); ctx.fill();
    } else if (this._character === 'dino') {
      ctx.beginPath(); ctx.moveTo(x + 18, y + 10);
      ctx.quadraticCurveTo(x + 45, y + 5 + wobble, x + 48, y + 25);
      ctx.quadraticCurveTo(x + 35, y + 20, x + 16, y + 35);
      ctx.closePath(); ctx.fill();
    }
  }

  // ─── 粒子绘制 ──────────────────────────────────────────────

  _drawParticles(ctx) {
    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p = this._particles[i];
      p.x += p.vx; p.y += p.vy; p.alpha -= p.alphaDecay;
      if (p.alpha <= 0) { this._particles.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // ─── 连续步数进度标识 ──────────────────────────────────────

  _drawStreakDots(ctx, w, h) {
    if (this._streakDots.length === 0) return;
    const dotR = 10, spacing = 14, totalW = this._streakDots.length * (dotR * 2 + spacing) - spacing;
    let startX = w / 2 - totalW / 2;
    const topY = 40;
    for (const dot of this._streakDots) {
      const cx = startX + dotR;
      if (dot.flashing) {
        const phase = Math.sin(performance.now() * 0.01) * 0.5 + 0.5;
        ctx.fillStyle = `rgba(255, 215, 0, ${0.5 + phase * 0.5})`;
        ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 8;
      } else if (dot.filled) {
        ctx.fillStyle = '#ffd93d';
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
      }
      ctx.beginPath(); ctx.arc(cx, topY, dotR, 0, Math.PI * 2); ctx.fill();
      if (!dot.filled) {
        ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx, topY, dotR, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.shadowBlur = 0;
      startX += dotR * 2 + spacing;
    }
  }

  // ─── 饥饿值进度条 ──────────────────────────────────────────

  _drawHungerBar(ctx, w) {
    const barW = 120, barH = 10, rx = w - barW - 20, ry = 30;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath(); this._roundRect(ctx, rx, ry, barW, barH, 5); ctx.fill();
    ctx.fillStyle = this._hunger >= 100 ? '#ffd93d' : '#6bcb77';
    ctx.beginPath(); this._roundRect(ctx, rx, ry, barW * (this._hunger / 100), barH, 5); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '12px "PingFang SC", sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(`❤️ ${this._hunger}%`, rx + barW, ry - 4);
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ─── 收尾仪式 ──────────────────────────────────────────────

  _drawOutro(ctx, w, h, timestamp) {
    const outro = this._animations.outro;
    const elapsed = timestamp - outro.startTime;

    if (outro.phase === 'celebrate' && elapsed < 1000) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffd93d';
      ctx.font = `bold ${28 * this._scale}px "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('太棒了！✨', w / 2, h * 0.3);
      // 庆祝粒子
      for (let i = 0; i < 10; i++) {
        const px = w / 2 + Math.cos(elapsed * 0.005 + i * 0.7) * 100;
        const py = h * 0.3 + Math.sin(elapsed * 0.005 + i * 0.7) * 50;
        ctx.fillStyle = ['#ff6b9d','#ffd93d','#6bcb77','#4d96ff'][i % 4];
        ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
      }
    } else if (outro.phase === 'celebrate') {
      outro.phase = 'showSteps'; outro.startTime = timestamp;
    } else if (outro.phase === 'showSteps' && elapsed < 2000) {
      ctx.fillStyle = 'rgba(15,15,35,0.7)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${32 * this._scale}px "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`走了 ${this.totalSteps} 步！`, w / 2, h * 0.4);
      ctx.font = `${22 * this._scale}px "PingFang SC", sans-serif`;
      ctx.fillText(`最高连续 ${this.streakCount} 步`, w / 2, h * 0.48);
      if (this._sceneUnlocked) {
        ctx.fillStyle = '#ffd93d';
        ctx.fillText(`🎉 解锁新场景：${this._sceneUnlocked === 'beach' ? '海滩 🏖️' : '太空 🚀'}`, w / 2, h * 0.56);
      }
    } else if (outro.phase === 'showSteps') {
      outro.phase = 'sleep'; outro.startTime = timestamp;
    } else if (outro.phase === 'sleep') {
      ctx.fillStyle = 'rgba(15,15,35,0.85)';
      ctx.fillRect(0, 0, w, h);
      // 绘制蜷缩入睡的角色
      const cx = w * 0.5, cy = h * 0.55;
      ctx.save(); ctx.translate(cx, cy);
      ctx.fillStyle = this._characterDef.color;
      ctx.beginPath(); ctx.ellipse(0, 0, 28, 22, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2d1b69'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(-6, -4, 2, 0, Math.PI, false); ctx.stroke();
      ctx.beginPath(); ctx.arc(6, -4, 2, 0, Math.PI, false); ctx.stroke();
      ctx.fillStyle = '#2d1b69';
      ctx.beginPath(); ctx.ellipse(0, 2, 3, 1.5, 0, 0, Math.PI * 2); ctx.fill();
      // Zzz
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '14px sans-serif'; ctx.textAlign = 'left';
      const zAlpha = Math.sin(elapsed * 0.003) * 0.3 + 0.5;
      ctx.globalAlpha = zAlpha;
      ctx.fillText('Z', 20 + Math.sin(elapsed * 0.002) * 5, -10);
      ctx.font = '11px sans-serif';
      ctx.fillText('z', 30 + Math.sin(elapsed * 0.003) * 3, -28);
      ctx.fillText('z', 38 + Math.sin(elapsed * 0.004) * 2, -42);
      ctx.restore();
    }
  }

  // ─── 工具方法 ──────────────────────────────────────────────

  _ensureCanvasSize() {
    const rect = this.canvas.parentElement
      ? this.canvas.parentElement.getBoundingClientRect()
      : { width: this.canvas.width, height: this.canvas.height };
    this.canvas.width = rect.width || 1376;
    this.canvas.height = rect.height || 768;
    this._scale = Math.min(this.canvas.width / 1376, this.canvas.height / 768);
  }
}

export { CompanionJourney };
