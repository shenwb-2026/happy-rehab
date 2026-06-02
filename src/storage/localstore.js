// 快乐康复指导 · 本地存储封装
// 所有 localStorage 读写通过此模块，键名遵循 hrg.<字段> 规范。

import { STORAGE_CONFIG } from '../config.js';

const PREFIX = STORAGE_CONFIG.keyPrefix ?? 'hrg.';
const VER_KEY = PREFIX + 'meta.version';
const STORE_VER = 1;

class LocalStore {
  static init() {
    const v = localStorage.getItem(VER_KEY);
    if (v === null) {
      localStorage.setItem(VER_KEY, String(STORE_VER));
    }
  }

  // ── 校准参数 ──────────────────────────────────────────────

  static saveCalibration(params) {
    LocalStore._set('calibration.params', { ...params, updatedAt: Date.now() });
  }

  static getCalibration() {
    return LocalStore._get('calibration.params');
  }

  // ── 角色选择 ──────────────────────────────────────────────

  static saveCharacter(id) {
    LocalStore._set('companion.character', id);
  }

  static getCharacter() {
    return LocalStore._get('companion.character');
  }

  // ── 累计步数 ──────────────────────────────────────────────

  static addTotalSteps(n) {
    const cur = LocalStore.getTotalSteps();
    const next = cur + (n || 0);
    LocalStore._set('progress.totalSteps', next);
    return next;
  }

  static getTotalSteps() {
    return LocalStore._get('progress.totalSteps') ?? 0;
  }

  // ── 当前场景 ──────────────────────────────────────────────

  static saveScene(sceneId) {
    LocalStore._set('progress.currentScene', sceneId);
  }

  static getScene() {
    return LocalStore._get('progress.currentScene') ?? 'forest';
  }

  // ── 训练总结 ──────────────────────────────────────────────

  static saveSessionSummary(summary) {
    LocalStore._set('sessions.lastSummary', { ...summary, timestamp: Date.now() });
  }

  static getLastSummary() {
    return LocalStore._get('sessions.lastSummary');
  }

  // ── 内部方法 ──────────────────────────────────────────────

  static _set(key, val) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(val));
    } catch(e) {
      console.warn('[LocalStore] 写入失败', key, e.message);
    }
  }

  static _get(key) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? null : JSON.parse(raw);
    } catch(e) {
      return null;
    }
  }
}

LocalStore.init();

export { LocalStore };
export default LocalStore;
