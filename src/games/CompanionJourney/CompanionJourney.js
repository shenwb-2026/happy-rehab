// 陪伴之旅游戏（规格书 9.3 节）
// 养成叙事类——行走→角色弹跳+粒子+路径瓷砖生成。Canvas 2D 全量渲染，无外部图片。
// 美术规范：天蓝色背景，圆润卡通角色，2-3px 黑色描边，大双高光眼睛。

import { GameInterface } from '../GameInterface.js';
import { GAME_CONFIG } from '../../config.js';
import { LocalStore } from '../../storage/localstore.js';

const STREAK_BONUS_AT  = GAME_CONFIG.streakBonusAt          ?? 5;
const STREAK_TIMEOUT   = GAME_CONFIG.streakTimeoutMs         ?? 5000;
const HUNGER_PER_STEP  = GAME_CONFIG.hungerIncreasePerStep   ?? 5;
const BOUNCE_MS        = GAME_CONFIG.bounceAnimationMs       ?? 350;
const PARTICLE_MS      = GAME_CONFIG.particleLifetimeMs      ?? 700;
const DANCE_MS         = GAME_CONFIG.streakDanceMs           ?? 2000;
const BONUS_TILES      = GAME_CONFIG.streakBonusTiles        ?? 5;
const SCENE_UNLOCK     = GAME_CONFIG.sceneUnlockSteps        ?? [50, 100];

// 音调序列（连续步数越多音调越高）
const STEP_TONES = [523, 659, 784, 880, 1047]; // C5 E5 G5 A5 C6

// ─── 场景定义 ─────────────────────────────────────────────────
const SCENE_BG = {
  forest: { top: '#87CEEB', bottom: '#B0E0FF', ground: '#5CB85C' },
  beach:  { top: '#87CEEB', bottom: '#B0E0FF', ground: '#F5DEB3' },
  space:  { top: '#0a0a2e', bottom: '#1a1a4e', ground: '#2a2a5e' },
};

// ─── 场景瓷砖（补充决策 2） ────────────────────────────────────
const TILE_DEFS = {
  forest: [
    { bg: '#5CB85C', draw: drawFlower  },
    { bg: '#FFD93D', draw: drawStar    },
    { bg: '#E84040', draw: drawMushroom },
    { bg: '#8BC34A', draw: drawGrass   },
  ],
  beach: [
    { bg: '#FF9800', draw: drawShell   },
    { bg: '#FF6B8A', draw: drawCrab    },
    { bg: '#FFCC02', draw: drawSun     },
    { bg: '#29B6F6', draw: drawWave    },
  ],
  space: [
    { bg: '#9C27B0', draw: drawPlanet  },
    { bg: '#3F51B5', draw: drawRocket  },
    { bg: '#1A237E', draw: drawMoon    },
    { bg: '#00BCD4', draw: drawAlien   },
  ],
};

// ─── 角色定义 ──────────────────────────────────────────────────
const CHAR_DEFS = {
  rabbit: { body: '#FFFFFF', ear: '#FFB6C1',   nose: '#FFB6C1'  },
  fox:    { body: '#FF8C42', ear: '#FFFFFF',   nose: '#e66022'  },
  dino:   { body: '#6BCB77', ear: '#4aad5c',   nose: '#4aad5c'  },
};

function rand(min, max) { return min + Math.random() * (max - min); }
function lerp(a, b, t) { return a + (b - a) * t; }
function easeOut(t) { return 1 - (1 - t) * (1 - t); }

// ─── 主类 ─────────────────────────────────────────────────────
class CompanionJourney extends GameInterface {
  constructor(canvas, soundEngine) {
    super();
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.sound  = soundEngine;

    // 从本地存储加载角色和场景
    this._characterId = LocalStore.getCharacter() ?? 'rabbit';
    this._char        = CHAR_DEFS[this._characterId] ?? CHAR_DEFS.rabbit;
    this._scene       = this._computeScene();
    this._totalAccum  = LocalStore.getTotalSteps() ?? 0;

    // 游戏状态
    this._hunger      = 0;
    this._streakCount = 0;
    this._totalSteps  = 0;
    this._isActive    = false;
    this._isResting   = false;

    // 路径瓷砖（{ tileIdx, x }）
    this._tiles       = [];
    this._tileOffset  = 0;  // 瓷砖整体偏移（用于视差）

    // 动画
    this._bounceAnim   = null;   // { startTime, duration }
    this._danceAnim    = null;   // { startTime, duration }
    this._introAnim    = null;   // { startTime, phase: 'yawn'|'wave'|done }
    this._outroAnim    = null;   // { startTime }
    this._particles    = [];
    this._streakFlash  = 0;      // 连续步数闪烁倒计时
    this._breathPhase  = 0;

    this._rafId       = null;
    this._lastFrameT  = 0;

    // 云朵（装饰）
    this._clouds = Array.from({ length: 4 }, () => ({
      x: rand(0, 1), y: rand(0.05, 0.3), w: rand(0.08, 0.18), speed: rand(0.00005, 0.0001),
    }));
  }

  // ─── GameInterface 生命周期 ────────────────────────────────

  onSessionStart() {
    this._isActive    = true;
    this._isResting   = false;
    this._hunger      = 0;
    this._streakCount = 0;
    this._totalSteps  = 0;
    this._tiles       = [];
    this._tileOffset  = 0;
    this._particles   = [];
    this._bounceAnim  = null;
    this._danceAnim   = null;
    this._streakFlash = 0;
    this._scene       = this._computeScene();
    this._char        = CHAR_DEFS[this._characterId] ?? CHAR_DEFS.rabbit;
    // 开场仪式：打哈欠→伸懒腰→挥手（3秒）
    this._introAnim  = { startTime: performance.now(), duration: 3000 };
    this._outroAnim  = null;
    this._startLoop();
  }

  onStep(timestamp, side) {
    if (!this._isActive || this._isResting) return;
    const now = performance.now();

    this._totalSteps++;
    this._streakCount++;
    this._totalAccum++;
    this._hunger = Math.min(100, this._hunger + HUNGER_PER_STEP);

    // 添加路径瓷砖
    this._addTile(1);

    // 弹跳动画
    this._bounceAnim = { startTime: now, duration: BOUNCE_MS };

    // 发射粒子
    this._emitParticles(this.canvas.width / 2, this.canvas.height * 0.35, 8);

    // 播放音效（连续步数决定音调）
    this.sound?.playStepSound(this._streakCount);

    // 连续步数奖励
    if (this._streakCount % STREAK_BONUS_AT === 0) {
      this._danceAnim  = { startTime: now, duration: DANCE_MS };
      this._streakFlash = 800;
      this._addTile(BONUS_TILES);
      this.sound?.playCelebration();
      // 额外粒子
      this._emitParticles(this.canvas.width / 2, this.canvas.height * 0.35, 16, true);
    }

    // 饥饿值满了：额外庆祝粒子
    if (this._hunger >= 100) {
      this._hunger = 0;
      this._emitParticles(this.canvas.width / 2, this.canvas.height * 0.35, 20, true);
      this.sound?.playCelebration();
    }

    // 检查场景解锁
    const unlocked = this._checkSceneUnlock();
    if (unlocked) {
      this._scene = unlocked;
      LocalStore.saveScene(unlocked);
    }
  }

  onRestStart() {
    this._isResting   = true;
    this._bounceAnim  = null;
    this._danceAnim   = null;
  }

  onRestEnd() {
    this._isResting   = false;
  }

  onSessionEnd() {
    this._isActive   = false;
    this._isResting  = false;
    this._outroAnim  = { startTime: performance.now(), duration: 3000 };
    // 保存累计步数
    LocalStore.addTotalSteps(this._totalSteps);
  }

  getStreakCount() { return this._streakCount; }
  getCanvas()      { return this.canvas; }

  destroy() {
    this._isActive = false;
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }

  // ─── 渲染循环 ─────────────────────────────────────────────

  _startLoop() {
    const loop = (now) => {
      const keepGoing = this._isActive || !!this._outroAnim;
      if (!keepGoing && !this._particles.length && !this._pops?.length) return;
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
    this._breathPhase += dt * 0.002;

    // 云移动
    for (const c of this._clouds) {
      c.x += c.speed * dt;
      if (c.x > 1.2) c.x = -c.w;
    }

    // 粒子
    this._particles = this._particles.filter(p => {
      p.x  += p.vx * dt * 0.06;
      p.y  += p.vy * dt * 0.06;
      p.vy += 0.06;
      p.life -= dt;
      return p.life > 0;
    });

    // 连续步数闪烁倒计时
    if (this._streakFlash > 0) this._streakFlash -= dt;

    // 出场动画结束时停止循环
    if (this._outroAnim) {
      const elapsed = now - this._outroAnim.startTime;
      if (elapsed > this._outroAnim.duration + 500 && !this._particles.length) {
        this._outroAnim = null;
        if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
      }
    }
  }

  _draw(now) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const sc = SCENE_BG[this._scene] ?? SCENE_BG.forest;

    // ── 背景天空 ──
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, sc.top);
    sky.addColorStop(0.75, sc.bottom);
    sky.addColorStop(1, sc.ground);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // ── 云朵（太空场景不显示） ──
    if (this._scene !== 'space') {
      for (const c of this._clouds) {
        this._drawCloud(ctx, c.x * W, c.y * H, c.w * W);
      }
    } else {
      // 太空：画几颗星星
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      for (let i = 0; i < 30; i++) {
        const sx = ((i * 137.5 + 17) % 1) * W;
        const sy = ((i * 0.618) % 0.7) * H;
        ctx.beginPath();
        ctx.arc(sx, sy, 1.5 + (i % 3), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ── 地面与路径瓷砖 ──
    const groundY = H * 0.78;
    ctx.fillStyle = sc.ground;
    ctx.fillRect(0, groundY, W, H - groundY);
    this._drawTiles(ctx, W, H, groundY);

    // ── 粒子 ──
    for (const p of this._particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ── 角色 ──
    const charCX = W / 2;
    const charCY = groundY - 20;
    let charScale = 1;

    const introT = this._introAnim
      ? Math.min(1, (now - this._introAnim.startTime) / this._introAnim.duration)
      : 1;
    const bounceT = this._bounceAnim
      ? Math.min(1, (now - this._bounceAnim.startTime) / this._bounceAnim.duration)
      : 0;
    const danceT = this._danceAnim
      ? Math.min(1, (now - this._danceAnim.startTime) / this._danceAnim.duration)
      : 0;
    const outroT = this._outroAnim
      ? Math.min(1, (now - this._outroAnim.startTime) / this._outroAnim.duration)
      : 0;

    // 弹跳：scale 1→1.15→1
    const bounceScale = bounceT > 0
      ? 1 + 0.15 * Math.sin(bounceT * Math.PI)
      : 1;
    // 呼吸
    const breathScale = 1 + Math.sin(this._breathPhase) * 0.015;
    // 舞蹈（上下跳动）
    const danceOffY = danceT > 0 && danceT < 1
      ? -30 * Math.abs(Math.sin(danceT * Math.PI * 4))
      : 0;
    // 收尾（入睡：缓慢蹲下）
    const outroScale = outroT > 0.5 ? lerp(1, 0.75, easeOut((outroT - 0.5) * 2)) : 1;

    charScale = bounceScale * breathScale * outroScale;

    // 开场：从底部弹入
    const introOffY = introT < 1 ? (1 - easeOut(introT)) * 80 : 0;

    this._drawCharacter(ctx, charCX, charCY + introOffY + danceOffY, charScale, {
      isResting:  this._isResting,
      isDancing:  danceT > 0 && danceT < 1,
      isSleeping: outroT > 0.7,
      bounceT,
    });

    if (this._bounceAnim && now - this._bounceAnim.startTime > BOUNCE_MS) {
      this._bounceAnim = null;
    }
    if (this._danceAnim && now - this._danceAnim.startTime > DANCE_MS) {
      this._danceAnim = null;
    }
    if (this._introAnim && introT >= 1) {
      this._introAnim = null;
    }

    // ── HUD ──
    this._drawHUD(ctx, W, H);
  }

  // ─── 绘制角色 ─────────────────────────────────────────────

  _drawCharacter(ctx, cx, cy, scale, state) {
    const s     = scale * Math.min(this.canvas.width, this.canvas.height) * 0.00065;
    const char  = this._char;
    const { isResting, isDancing, isSleeping, bounceT } = state;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);

    // 身体
    ctx.beginPath();
    ctx.ellipse(0, 30, 42, 55, 0, 0, Math.PI * 2);
    ctx.fillStyle = char.body;
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 3;
    ctx.stroke();

    // 耳朵（兔子：长耳；狐狸：三角耳；恐龙：头顶鳍）
    if (this._characterId === 'rabbit') {
      this._drawRabbitEars(ctx, char);
    } else if (this._characterId === 'fox') {
      this._drawFoxEars(ctx, char);
    } else {
      this._drawDinoFin(ctx, char);
    }

    // 头部
    ctx.beginPath();
    ctx.ellipse(0, -32, 38, 36, 0, 0, Math.PI * 2);
    ctx.fillStyle = char.body;
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 3;
    ctx.stroke();

    // 表情
    if (isSleeping || isResting) {
      this._drawFaceSleep(ctx);
    } else if (isDancing || bounceT > 0) {
      this._drawFaceHappy(ctx);
    } else {
      this._drawFaceNormal(ctx);
    }

    // 手臂
    this._drawArms(ctx, char, isDancing, bounceT);

    ctx.restore();
  }

  _drawRabbitEars(ctx, char) {
    for (const side of [-1, 1]) {
      const tilt = side * 0.2;
      ctx.save();
      ctx.translate(side * 20, -70);
      ctx.rotate(tilt);
      ctx.beginPath(); ctx.ellipse(0, 0, 10, 32, 0, 0, Math.PI * 2);
      ctx.fillStyle = char.body; ctx.fill();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, 2, 5, 20, 0, 0, Math.PI * 2);
      ctx.fillStyle = char.ear; ctx.fill();
      ctx.restore();
    }
  }

  _drawFoxEars(ctx, char) {
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * 28, -62);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(side * 18, -28); ctx.lineTo(side * 0, -24);
      ctx.closePath();
      ctx.fillStyle = char.body; ctx.fill();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 2.5; ctx.stroke();
      // 黑色耳尖
      ctx.beginPath();
      ctx.moveTo(0, -10); ctx.lineTo(side * 18, -28); ctx.lineTo(side * 12, -16);
      ctx.closePath();
      ctx.fillStyle = '#222'; ctx.fill();
      ctx.restore();
    }
  }

  _drawDinoFin(ctx, char) {
    // 头顶三角鳍
    const pts = [[-20, -65], [-8, -90], [0, -75], [8, -95], [20, -70]];
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const [px, py] of pts.slice(1)) ctx.lineTo(px, py);
    ctx.closePath();
    ctx.fillStyle = char.ear; ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.stroke();
  }

  _drawFaceNormal(ctx) {
    // 眼睛（大圆眼 + 双高光）
    for (const side of [-1, 1]) {
      const ex = side * 14;
      ctx.beginPath(); ctx.arc(ex, -36, 11, 0, Math.PI * 2);
      ctx.fillStyle = '#333'; ctx.fill();
      ctx.beginPath(); ctx.arc(ex + side * 2, -39, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.beginPath(); ctx.arc(ex + side * 4, -40, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
    }
    // 鼻子
    ctx.beginPath(); ctx.arc(0, -26, 5, 0, Math.PI * 2);
    ctx.fillStyle = this._char.nose; ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
    // 嘴
    ctx.beginPath(); ctx.arc(0, -20, 10, 0.15, Math.PI - 0.15);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2.5; ctx.stroke();
  }

  _drawFaceHappy(ctx) {
    // 眯眼（弯月）
    for (const side of [-1, 1]) {
      const ex = side * 14;
      ctx.beginPath(); ctx.arc(ex, -36, 11, Math.PI, 0);
      ctx.strokeStyle = '#333'; ctx.lineWidth = 3; ctx.stroke();
    }
    // 大张嘴露小牙
    ctx.beginPath(); ctx.arc(0, -22, 12, 0.2, Math.PI - 0.2);
    ctx.fillStyle = '#e05050'; ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2.5; ctx.stroke();
    // 两颗小牙
    ctx.fillStyle = '#fff';
    ctx.fillRect(-7, -26, 5, 8);
    ctx.fillRect(2, -26, 5, 8);
  }

  _drawFaceSleep(ctx) {
    // 半闭眼（横线）
    for (const side of [-1, 1]) {
      const ex = side * 14;
      ctx.beginPath();
      ctx.moveTo(ex - 8, -36); ctx.lineTo(ex + 8, -36);
      ctx.strokeStyle = '#333'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();
      // 下眼皮弧
      ctx.beginPath(); ctx.arc(ex, -36, 8, 0, Math.PI);
      ctx.strokeStyle = '#aaa'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // 安静小嘴
    ctx.beginPath(); ctx.arc(0, -22, 5, 0.3, Math.PI - 0.3);
    ctx.strokeStyle = '#aaa'; ctx.lineWidth = 2; ctx.stroke();
  }

  _drawArms(ctx, char, isDancing, bounceT) {
    const armAngle = isDancing ? Math.sin(performance.now() * 0.01) * 0.8 : (bounceT > 0 ? -0.5 : 0.3);
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * 36, 5);
      ctx.rotate(side * armAngle);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.quadraticCurveTo(side * 20, 5, side * 30, -10);
      ctx.lineWidth   = 16;
      ctx.lineCap     = 'round';
      ctx.strokeStyle = char.body; ctx.stroke();
      ctx.lineWidth   = 3;
      ctx.strokeStyle = '#111'; ctx.stroke();
      ctx.restore();
    }
  }

  // ─── 绘制辅助 ─────────────────────────────────────────────

  _drawCloud(ctx, x, y, w) {
    const h = w * 0.45;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(x, y, w * 0.5, h * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + w * 0.28, y + h * 0.1, w * 0.3, h * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x - w * 0.28, y + h * 0.1, w * 0.28, h * 0.38, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  _drawTiles(ctx, W, H, groundY) {
    const tileSize = Math.round(H * 0.075);
    const y = groundY + (H - groundY - tileSize) / 2;

    for (let i = 0; i < this._tiles.length; i++) {
      const t   = this._tiles[i];
      const x   = t.x + this._tileOffset;
      if (x + tileSize < 0 || x > W) continue;
      const def = TILE_DEFS[this._scene]?.[t.tileIdx % (TILE_DEFS[this._scene]?.length ?? 4)];
      if (!def) continue;
      drawTile(ctx, x, y, tileSize, def);
    }

    // 裁剪过远的瓷砖（优化性能）
    this._tiles = this._tiles.filter(t => t.x + this._tileOffset > -tileSize * 2);
  }

  _drawHUD(ctx, W, H) {
    // 饥饿值进度条
    const barW = Math.round(W * 0.18);
    const barH = 18;
    const barX = 20;
    const barY = 20;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 9);
    ctx.fill();
    const pct = this._hunger / 100;
    const fillColors = ['#FF6B6B', '#FFD93D', '#6BCB77'];
    const ci = Math.floor(pct * 2.99);
    ctx.fillStyle = fillColors[ci] ?? '#6BCB77';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW * pct, barH, 9);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 9);
    ctx.stroke();

    // 心形图标
    ctx.font = `${Math.round(H * 0.03)}px sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText('❤️', barX + barW + 6, barY + barH - 1);

    // 连续步数进度点（右上角）
    const n = STREAK_BONUS_AT;
    const pos = this._streakCount % n;
    const flash = this._streakFlash > 0;
    const dotR = Math.round(H * 0.022);
    const gap  = dotR * 2.8;
    const startX = W - (n * gap) - 20;
    const dotY   = 30;

    for (let i = 0; i < n; i++) {
      const filled = i < pos || (flash && pos === 0);
      const cx = startX + i * gap + dotR;
      ctx.beginPath();
      ctx.arc(cx, dotY, dotR, 0, Math.PI * 2);
      ctx.fillStyle = filled ? '#FFD93D' : 'rgba(255,255,255,0.25)';
      ctx.fill();
      ctx.strokeStyle = filled ? '#e6a800' : 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 步数文字
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `bold ${Math.round(H * 0.042)}px sans-serif`;
    ctx.textAlign = 'right';
    if (this._totalSteps > 0) {
      ctx.fillText(`${this._totalSteps} 步`, W - 20, 55);
    }
  }

  // ─── 游戏逻辑 ─────────────────────────────────────────────

  _addTile(count) {
    const W = this.canvas.width;
    const tileSize = Math.round(this.canvas.height * 0.075);
    const defs = TILE_DEFS[this._scene] ?? TILE_DEFS.forest;
    let lastX = this._tiles.length
      ? Math.max(...this._tiles.map(t => t.x)) + tileSize + 4
      : W * 0.6;

    for (let i = 0; i < count; i++) {
      this._tiles.push({
        tileIdx: Math.floor(Math.random() * defs.length),
        x: lastX + i * (tileSize + 4),
      });
    }

    // 缓慢向左滚动
    this._tileOffset -= tileSize * 0.6;
  }

  _emitParticles(x, y, count, big = false) {
    const colors = ['#FF6B9D', '#FFD93D', '#6BCB77', '#4D96FF', '#FF8C42', '#B388FF'];
    for (let i = 0; i < count; i++) {
      const angle = rand(-Math.PI, Math.PI);
      const speed = rand(big ? 4 : 2, big ? 10 : 6);
      const life  = PARTICLE_MS * rand(0.6, 1.0);
      this._particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        r:  rand(big ? 5 : 3, big ? 10 : 6),
        color: colors[Math.floor(Math.random() * colors.length)],
        life,
        maxLife: life,
      });
    }
  }

  _computeScene() {
    const total = LocalStore.getTotalSteps() ?? 0;
    const thresholds = Array.isArray(SCENE_UNLOCK) ? SCENE_UNLOCK : [50, 100];
    if (total >= (thresholds[1] ?? 100)) return 'space';
    if (total >= (thresholds[0] ?? 50))  return 'beach';
    return 'forest';
  }

  _checkSceneUnlock() {
    const thresholds = Array.isArray(SCENE_UNLOCK) ? SCENE_UNLOCK : [50, 100];
    if (this._totalAccum >= (thresholds[1] ?? 100) && this._scene !== 'space') return 'space';
    if (this._totalAccum >= (thresholds[0] ?? 50)  && this._scene === 'forest') return 'beach';
    return null;
  }
}

// ─── 瓷砖绘制工具函数 ────────────────────────────────────────

function drawTile(ctx, x, y, size, def) {
  const r = Math.round(size * 0.18);
  // 底色
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, r);
  ctx.fillStyle = def.bg;
  ctx.fill();
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  // 图标
  const cx = x + size / 2, cy = y + size / 2;
  ctx.save();
  def.draw(ctx, cx, cy, size * 0.5);
  ctx.restore();
}

function drawFlower(ctx, cx, cy, s) {
  const petals = 5;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * s * 0.42, cy + Math.sin(a) * s * 0.42, s * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = '#FF9EB5'; ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(cx, cy, s * 0.24, 0, Math.PI * 2);
  ctx.fillStyle = '#FFD93D'; ctx.fill();
  ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
}

function drawStar(ctx, cx, cy, s) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const b = a + Math.PI / 5;
    ctx.lineTo(cx + Math.cos(a) * s * 0.9, cy + Math.sin(a) * s * 0.9);
    ctx.lineTo(cx + Math.cos(b) * s * 0.4, cy + Math.sin(b) * s * 0.4);
  }
  ctx.closePath();
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
}

function drawMushroom(ctx, cx, cy, s) {
  // 帽子
  ctx.beginPath(); ctx.arc(cx, cy - s * 0.1, s * 0.7, Math.PI, 0); ctx.closePath();
  ctx.fillStyle = '#E84040'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
  // 白点
  for (const [dx, dy] of [[-0.28, -0.3], [0.22, -0.45], [0, -0.1]]) {
    ctx.beginPath(); ctx.arc(cx + dx * s, cy + dy * s, s * 0.13, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
  }
  // 柄
  ctx.beginPath(); ctx.rect(cx - s * 0.2, cy - s * 0.1, s * 0.4, s * 0.55);
  ctx.fillStyle = '#F5DEB3'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
}

function drawGrass(ctx, cx, cy, s) {
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  for (const [dx, dy] of [[-0.3, 0.3], [0, -0.1], [0.3, 0.3]]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * s, cy + 0.4 * s);
    ctx.quadraticCurveTo(cx + dx * s * 1.1, cy + dy * s, cx + dx * s, cy - 0.4 * s + dy * s);
    ctx.stroke();
  }
}

function drawShell(ctx, cx, cy, s) {
  ctx.beginPath(); ctx.arc(cx, cy, s * 0.7, Math.PI, 0); ctx.closePath();
  ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
  for (let i = 0; i < 5; i++) {
    const a = Math.PI + (i / 4) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * s * 0.7, cy + Math.sin(a) * s * 0.7);
    ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1; ctx.stroke();
  }
}

function drawCrab(ctx, cx, cy, s) {
  ctx.beginPath(); ctx.ellipse(cx, cy, s * 0.55, s * 0.38, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#FF6B8A'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
  // 钳子
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + side * s * 0.8, cy, s * 0.22, 0, Math.PI * 2);
    ctx.strokeStyle = '#FF6B8A'; ctx.lineWidth = 6; ctx.stroke();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  // 眼睛
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.arc(cx + side * s * 0.22, cy - s * 0.22, s * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = '#111'; ctx.fill();
  }
}

function drawSun(ctx, cx, cy, s) {
  ctx.beginPath(); ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * s * 0.52, cy + Math.sin(a) * s * 0.52);
    ctx.lineTo(cx + Math.cos(a) * s * 0.9, cy + Math.sin(a) * s * 0.9);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();
  }
}

function drawWave(ctx, cx, cy, s) {
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  for (const oy of [-s * 0.15, s * 0.15]) {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.7, cy + oy);
    ctx.bezierCurveTo(cx - s * 0.3, cy + oy - s * 0.3, cx + s * 0.3, cy + oy + s * 0.3, cx + s * 0.7, cy + oy);
    ctx.stroke();
  }
}

function drawPlanet(ctx, cx, cy, s) {
  ctx.beginPath(); ctx.arc(cx, cy, s * 0.5, 0, Math.PI * 2);
  ctx.fillStyle = '#D1C4E9'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(-0.4);
  ctx.beginPath(); ctx.ellipse(0, 0, s * 0.85, s * 0.22, 0, 0, Math.PI * 2);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
  ctx.restore();
}

function drawRocket(ctx, cx, cy, s) {
  ctx.beginPath(); ctx.ellipse(cx, cy, s * 0.28, s * 0.62, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
  // 翼
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * s * 0.28, cy + s * 0.2);
    ctx.lineTo(cx + side * s * 0.6, cy + s * 0.62);
    ctx.lineTo(cx + side * s * 0.28, cy + s * 0.55);
    ctx.closePath();
    ctx.fillStyle = '#90CAF9'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  // 火焰
  ctx.beginPath();
  ctx.ellipse(cx, cy + s * 0.72, s * 0.16, s * 0.25, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#FF8C42'; ctx.fill();
}

function drawMoon(ctx, cx, cy, s) {
  ctx.beginPath(); ctx.arc(cx, cy, s * 0.65, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx + s * 0.3, cy - s * 0.1, s * 0.52, 0, Math.PI * 2);
  ctx.fillStyle = '#1A237E'; ctx.fill();
}

function drawAlien(ctx, cx, cy, s) {
  ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.1, s * 0.5, s * 0.62, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#B2DFDB'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
  // 触角
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * s * 0.25, cy - s * 0.45);
    ctx.quadraticCurveTo(cx + side * s * 0.55, cy - s * 0.9, cx + side * s * 0.5, cy - s * 1.0);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + side * s * 0.5, cy - s * 1.0, s * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = '#FFD93D'; ctx.fill();
  }
  // 三只眼睛
  for (const [dx, dy] of [[-0.22, -0.1], [0.22, -0.1], [0, -0.35]]) {
    ctx.beginPath(); ctx.ellipse(cx + dx * s, cy + dy * s, s * 0.14, s * 0.18, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#111'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx + dx * s + s * 0.06, cy + dy * s - s * 0.06, s * 0.05, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
  }
}

export { CompanionJourney };
