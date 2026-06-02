/**
 * Web Audio API 音效引擎 — SoundEngine
 *
 * 所有音效即时合成，无需预加载音频文件。
 * OscillatorNode + GainNode 组合实现包络控制。
 * AudioContext 延迟初始化（首次用户交互时创建，iOS 兼容）。
 * 移动端音量适中（GainNode gain 值 0.3-0.5）。
 */

class SoundEngine {
  constructor() {
    // AudioContext 延迟初始化（等待用户交互）
    this.audioContext = null;
    // 主音量 [0, 1]
    this._volume = 0.35;
    // 是否静音
    this._muted = false;
  }

  /**
   * 确保 AudioContext 已初始化（iOS 要求用户交互后才可用）
   */
  _ensureContext() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  /**
   * 播放步数音效（升调序列）
   *
   * 音高随连续步数递增，给儿童明确的"越来越棒"听觉反馈。
   * 音调序列：C5(523Hz) → E5(659Hz) → G5(784Hz) → A5(880Hz) → C6(1047Hz)
   * 使用正弦波，150ms 持续时间，带快速起音 + 慢速衰减包络。
   *
   * @param {number} streakCount — 当前连续步数（决定音调高低）
   */
  playStepSound(streakCount) {
    this._ensureContext();
    if (this._muted) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // 音调序列索引（0-4，循环）
    const tones = [523, 659, 784, 880, 1047]; // C5, E5, G5, A5, C6
    const index = Math.min((streakCount - 1) % tones.length, tones.length - 1);
    const frequency = tones[Math.max(0, index)];

    const duration = 0.15; // 150ms
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, now);

    // Attack/Decay 包络：快速起音（10ms），慢速衰减
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(this._volume * 0.5, now + 0.01);  // 起音
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);       // 衰减

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  /**
   * 播放泡泡破裂音效
   *
   * 120ms 衰减正弦波（频率随机 600-1000Hz）
   * 配合短白噪声爆发模拟破裂感。
   */
  playBubblePop() {
    this._ensureContext();
    if (this._muted) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;

    const duration = 0.12; // 120ms
    const freq = 600 + Math.random() * 400; // 600-1000Hz 随机

    // 主音：正弦波
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(this._volume * 0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration + 0.01);

    // 噪声爆发模拟破裂质感
    this._playNoiseBurst(now, 0.06, this._volume * 0.15);
  }

  /**
   * 播放庆祝和弦
   *
   * 同时播放 C5+E5+G5+C6 四音叠加（大三和弦）
   * 持续时间 500ms，缓慢衰减。
   */
  playCelebration() {
    this._ensureContext();
    if (this._muted) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // C 大三和弦：C5(523), E5(659), G5(784), C6(1047)
    const frequencies = [523, 659, 784, 1047];
    const duration = 0.5; // 500ms

    for (const freq of frequencies) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(this._volume * 0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + duration + 0.01);
    }

    // 轻微噪音层增加丰满度
    this._playNoiseBurst(now, 0.15, this._volume * 0.05);
  }

  /**
   * 播放 UI 交互音效
   *
   * 短促叮咚声（按钮点击反馈）
   * 双频叠加：1000Hz + 1500Hz，60ms 持续时间
   */
  playUIBeep() {
    this._ensureContext();
    if (this._muted) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;
    const duration = 0.06; // 60ms

    // 双频叮咚
    const frequencies = [1000, 1500];

    for (const freq of frequencies) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(this._volume * 0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + duration + 0.01);
    }
  }

  /**
   * 播放短白噪声爆发
   * @param {number} startTime — 开始时间（AudioContext.currentTime）
   * @param {number} duration — 持续时间（秒）
   * @param {number} volume — 音量 [0, 1]
   */
  _playNoiseBurst(startTime, duration, volume) {
    const ctx = this.audioContext;

    // 创建噪声缓冲区
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1; // 白噪声
    }

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();

    source.buffer = buffer;
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    source.connect(gain);
    gain.connect(ctx.destination);

    source.start(startTime);
    source.stop(startTime + duration + 0.01);
  }

  /**
   * 设置音量
   * @param {number} vol — 音量 [0, 1]
   */
  setVolume(vol) {
    this._volume = Math.max(0, Math.min(1, vol));
  }

  /**
   * 静音切换
   * @param {boolean} muted
   */
  setMuted(muted) {
    this._muted = muted;
  }

  /**
   * 获取静音状态
   * @returns {boolean}
   */
  isMuted() {
    return this._muted;
  }

  /**
   * 释放音频资源
   */
  destroy() {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

export { SoundEngine };
