// 快乐康复指导 · UI 管理器
// 管理所有 HTML DOM 界面的显示/隐藏和状态更新。
// 不包含游戏 Canvas 渲染，仅管理 DOM 层。

class UIManager {
  /**
   * @param {Object} cbs
   * @param {Function} cbs.onStartCalibration
   * @param {Function} cbs.onGameSelected     (gameId: 'bubble'|'companion')
   * @param {Function} cbs.onStartRest
   * @param {Function} cbs.onEndRest
   * @param {Function} cbs.onEndSession
   * @param {Function} cbs.onCharSelected     (charId: 'rabbit'|'fox'|'dino')
   * @param {Function} cbs.onAgain
   */
  constructor(cbs = {}) {
    this._cbs = {
      onStartCalibration: cbs.onStartCalibration ?? (() => {}),
      onGameSelected:     cbs.onGameSelected     ?? (() => {}),
      onStartRest:        cbs.onStartRest        ?? (() => {}),
      onEndRest:          cbs.onEndRest          ?? (() => {}),
      onEndSession:       cbs.onEndSession       ?? (() => {}),
      onCharSelected:     cbs.onCharSelected     ?? (() => {}),
      onAgain:            cbs.onAgain            ?? (() => {}),
    };

    this._timerInterval  = null;
    this._trainingStart  = 0;
    this._warningTimeout = null;

    this._bindAll();
  }

  // ── 界面切换 ──────────────────────────────────────────────

  showHome() {
    this._showOnly('screen-home');
  }

  showCalibration() {
    this._showOnly('screen-calibration');
    this._setStatus('');
    this._hideEl('calibration-countdown');
    this._hideEl('btn-start-training');
    this._showEl('btn-start-calibration');
  }

  showCalibrationCountdown(n) {
    const el = document.getElementById('calibration-countdown');
    if (!el) return;
    el.textContent = n;
    el.classList.remove('hidden');
    this._setStatus('请保持站立静止...');
  }

  hideCalibrationCountdown() {
    this._hideEl('calibration-countdown');
  }

  showCalibrationReady(params) {
    this._setStatus(`✅ 校准完成！肩宽 ${params.shoulderWidth} px`);
    this._hideEl('btn-start-calibration');
    this._showEl('btn-start-training');
  }

  updateCalibrationPreview(stream) {
    let container = document.getElementById('calibration-video-container');
    if (!container) return;
    let video = container.querySelector('video');
    if (!video) {
      video = document.createElement('video');
      video.setAttribute('playsinline', '');
      video.setAttribute('autoplay', '');
      video.setAttribute('muted', '');
      video.style.cssText = 'width:100%;height:100%;object-fit:cover;transform:scaleX(-1);';
      container.appendChild(video);
    }
    video.srcObject = stream;
  }

  updateConfidenceIndicators(landmarks) {
    const map = {
      'conf-left-hip':   23,
      'conf-right-hip':  24,
      'conf-left-knee':  25,
      'conf-right-knee': 26,
    };
    for (const [id, idx] of Object.entries(map)) {
      const el = document.getElementById(id);
      if (!el) continue;
      const vis = landmarks?.[idx]?.visibility ?? 0;
      el.className = 'conf-dot ' + (vis >= 0.7 ? 'good' : vis >= 0.5 ? 'medium' : 'poor');
    }
  }

  showGameSelection() {
    this._showOnly('screen-game-select');
    this._renderGamePreviews();
  }

  showTraining() {
    this._showOnly('screen-training');
    this._trainingStart = Date.now();
    this._startTimer();
    this._hideEl('warning-banner');
  }

  showRest() {
    this._showOnly('screen-rest');
    this._stopTimer();
  }

  showSessionSummary(summary) {
    this._showOnly('screen-summary');
    this._stopTimer();

    const mins = Math.floor(summary.durationMs / 60000);
    const secs = Math.floor((summary.durationMs % 60000) / 1000);

    this._setText('summary-total-steps', `${summary.totalSteps}`);
    this._setText('summary-duration',    `${mins}分${secs}秒`);
    this._setText('summary-max-streak',  `${summary.maxStreak}`);
  }

  // ── HUD 更新 ──────────────────────────────────────────────

  updateHUD({ steps, streak }) {
    // HUD 由游戏 Canvas 自己渲染，这里只更新计时器（已由 _startTimer 处理）
    // 如未来需要 DOM HUD 可在此扩展
  }

  showLowConfidenceWarning(reason) {
    const el = document.getElementById('warning-banner');
    if (!el) return;
    el.textContent = `⚠️ ${reason ?? '请调整摄像头位置'}`;
    el.classList.remove('hidden');
    clearTimeout(this._warningTimeout);
    this._warningTimeout = setTimeout(() => {
      el.classList.add('hidden');
    }, 3000);
  }

  hideLowConfidenceWarning() {
    this._hideEl('warning-banner');
  }

  // ── 内部方法 ──────────────────────────────────────────────

  _bindAll() {
    this._on('btn-start-calibration', 'click', () => {
      this._cbs.onStartCalibration();
    });

    this._on('btn-start-training', 'click', () => {
      // 由 main.js 处理：enterGameSelect
      this._cbs.onStartCalibration._startTraining?.();
    });

    this._on('btn-select-bubble', 'click', () => this._cbs.onGameSelected('bubble'));
    this._on('btn-select-companion', 'click', () => this._cbs.onGameSelected('companion'));

    // 整个游戏卡片可点击
    document.querySelectorAll('.game-card').forEach(card => {
      card.addEventListener('click', () => {
        const gameId = card.dataset.game;
        if (gameId) this._cbs.onGameSelected(gameId);
      });
    });

    this._on('btn-rest', 'click', () => this._cbs.onStartRest());
    this._on('btn-end',  'click', () => this._cbs.onEndSession());
    this._on('btn-continue', 'click', () => this._cbs.onEndRest());

    this._on('btn-again', 'click', () => {
      this._cbs.onAgain();
    });
    this._on('btn-home', 'click', () => {
      this._cbs.onAgain();
    });
  }

  _on(id, evt, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(evt, fn);
  }

  _showOnly(screenId) {
    document.querySelectorAll('#ui-layer .screen').forEach(s => {
      s.classList.toggle('hidden', s.id !== screenId);
    });
  }

  _showEl(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  }

  _hideEl(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  }

  _setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  _setStatus(text) {
    const el = document.getElementById('calibration-status');
    if (el) el.textContent = text;
  }

  _startTimer() {
    this._stopTimer();
    const el = document.getElementById('hud-timer');
    if (!el) return;
    this._timerInterval = setInterval(() => {
      const elapsed = Date.now() - this._trainingStart;
      const m = Math.floor(elapsed / 60000);
      const s = Math.floor((elapsed % 60000) / 1000);
      el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }, 1000);
  }

  _stopTimer() {
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
  }

  // ── 游戏选择界面预览 ──────────────────────────────────────

  _renderGamePreviews() {
    this._renderBubblePreview();
    this._renderCompanionPreview();
  }

  _renderBubblePreview() {
    const canvas = document.getElementById('preview-bubble');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1a0050'); bg.addColorStop(1, '#2d0a54');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    const colors = ['#FF6B9D','#FFD93D','#6BCB77','#4D96FF','#B388FF','#FF8C42'];
    const bubbles = [
      {x:60,y:80,r:36},{x:160,y:50,r:28},{x:230,y:100,r:40},{x:80,y:150,r:24},{x:180,y:155,r:32},{x:270,y:60,r:22},
    ];
    bubbles.forEach((b, i) => {
      const c = colors[i % colors.length];
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
      ctx.fillStyle = c; ctx.fill(); ctx.strokeStyle='#000'; ctx.lineWidth=2.5; ctx.stroke();
      // highlight
      ctx.save(); ctx.translate(b.x - b.r*0.28, b.y - b.r*0.28); ctx.scale(1, 0.6);
      ctx.beginPath(); ctx.arc(0, 0, b.r*0.32, 0, Math.PI*2);
      ctx.fillStyle='rgba(255,255,255,0.55)'; ctx.fill(); ctx.restore();
    });
  }

  _renderCompanionPreview() {
    const canvas = document.getElementById('preview-companion');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;

    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#87CEEB'); sky.addColorStop(1, '#B0E0FF');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    // Ground
    ctx.fillStyle = '#5CB85C'; ctx.fillRect(0, H*0.75, W, H*0.25);
    // Simple rabbit
    const cx = W/2, cy = H*0.6;
    ctx.fillStyle='#fff';
    // body
    ctx.beginPath(); ctx.ellipse(cx, cy+10, 22, 28, 0, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle='#111'; ctx.lineWidth=2; ctx.stroke();
    // head
    ctx.beginPath(); ctx.ellipse(cx, cy-20, 20, 19, 0, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle='#111'; ctx.lineWidth=2; ctx.stroke();
    // ears
    for (const s of [-1,1]) {
      ctx.beginPath(); ctx.ellipse(cx+s*10, cy-50, 5, 17, s*0.2, 0, Math.PI*2);
      ctx.fillStyle='#fff'; ctx.fill(); ctx.strokeStyle='#111'; ctx.lineWidth=1.5; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx+s*10, cy-50, 2.5, 10, s*0.2, 0, Math.PI*2);
      ctx.fillStyle='#FFB6C1'; ctx.fill();
    }
    // eyes
    for (const s of [-1,1]) {
      ctx.beginPath(); ctx.arc(cx+s*7, cy-23, 5.5, 0, Math.PI*2);
      ctx.fillStyle='#333'; ctx.fill();
      ctx.beginPath(); ctx.arc(cx+s*7+s*1.5, cy-25, 2, 0, Math.PI*2);
      ctx.fillStyle='#fff'; ctx.fill();
    }
    // Stars
    ctx.fillStyle='#FFD93D';
    for (const [sx,sy] of [[20,20],[260,30],[130,15]]) {
      ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI*2); ctx.fill();
    }
  }
}

export { UIManager };
export default UIManager;
