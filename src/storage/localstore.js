/**
 * 本地存储管理器 — LocalStore
 *
 * 统一封装所有 localStorage 读写操作，
 * 提供类型安全、默认值、版本迁移和键名前缀管理。
 *
 * 注意：此人只有 localStorage 封装，不包含 IndexedDB。
 * IndexedDB 操作请使用 indexeddb.js。
 */

import { STORAGE_CONFIG } from '../config.js';

// =========================================================================
// 常量
// =========================================================================

/** localStorage 键名前缀 */
const KEY_PREFIX = STORAGE_CONFIG.keyPrefix || 'hr_';

/** 当前存储版本号，用于数据迁移 */
const STORE_VERSION = 1;

/** 版本键名 */
const VERSION_KEY = `${KEY_PREFIX}version`;

// =========================================================================
// 存储管理器
// =========================================================================

class LocalStore {
  /**
   * 初始化：检查版本号，执行数据迁移
   *
   * 如果版本号不匹配，说明存储结构有变更，需要执行迁移。
   * 当前版本仅做版本标记，未来可扩展迁移逻辑。
   */
  static init() {
    const storedVersion = LocalStore._getRaw(VERSION_KEY);

    if (storedVersion === null) {
      // 首次使用，标记当前版本
      LocalStore._setRaw(VERSION_KEY, STORE_VERSION);
      console.log(`[LocalStore] 初始化完成，版本: ${STORE_VERSION}`);
      return;
    }

    const version = parseInt(storedVersion, 10);
    if (version < STORE_VERSION) {
      console.log(`[LocalStore] 版本迁移: ${version} → ${STORE_VERSION}`);
      // 迁移逻辑（未来扩展）
      LocalStore._setRaw(VERSION_KEY, STORE_VERSION);
    }
  }

  // =========================================================================
  // 校准参数
  // =========================================================================

  /**
   * 保存校准参数
   *
   * @param {Object} params
   * @param {number} params.hipNeutralX - 髋关节中立 X 坐标
   * @param {number} params.shoulderWidthPx - 像素级肩宽
   * @param {number} params.baselineTremorAmplitude - 基线震颤幅度
   * @param {number} params.standingHipY - 站立髋关节 Y 坐标
   */
  static saveCalibration(params) {
    LocalStore._save('calibration', {
      ...params,
      savedAt: Date.now(),
    });
  }

  /**
   * 读取校准参数，不存在返回 null
   *
   * @returns {Object|null}
   */
  static getCalibration() {
    return LocalStore._load('calibration');
  }

  // =========================================================================
  // 同伴角色
  // =========================================================================

  /**
   * 保存同伴角色选择
   *
   * @param {string} characterId - 角色标识: 'fox' | 'rabbit' | 'dino'
   */
  static saveCharacter(characterId) {
    LocalStore._save('character', characterId);
  }

  /**
   * 读取同伴角色选择
   *
   * @returns {string|null} 角色标识，不存在返回 null
   */
  static getCharacter() {
    return LocalStore._load('character');
  }

  // =========================================================================
  // 累加步数
  // =========================================================================

  /**
   * 累加总步数
   *
   * @param {number} count - 本次增加的步数
   * @returns {number} 累加后的总步数
   */
  static addTotalSteps(count) {
    const current = LocalStore.getTotalSteps();
    const total = current + count;
    LocalStore._save('totalSteps', total);
    return total;
  }

  /**
   * 读取总步数
   *
   * @returns {number} 总步数，若无记录返回 0
   */
  static getTotalSteps() {
    const value = LocalStore._load('totalSteps');
    return typeof value === 'number' ? value : 0;
  }

  // =========================================================================
  // 场景进度
  // =========================================================================

  /**
   * 保存/更新当前场景
   *
   * @param {string} sceneId - 场景标识: 'forest' | 'beach' | 'space'
   */
  static saveScene(sceneId) {
    LocalStore._save('scene', sceneId);
  }

  /**
   * 读取当前场景
   *
   * @returns {string|null} 场景标识，不存在返回 null
   */
  static getScene() {
    return LocalStore._load('scene');
  }

  // =========================================================================
  // 训练总结
  // =========================================================================

  /**
   * 保存训练总结
   *
   * @param {{ totalSteps: number, durationMs: number, maxStreak: number }} summary
   */
  static saveSessionSummary(summary) {
    // 保留最近 10 次训练记录
    const history = LocalStore._load('summaryHistory') || [];
    history.push({
      ...summary,
      timestamp: Date.now(),
    });

    // 保留最近 10 条
    while (history.length > 10) {
      history.shift();
    }

    LocalStore._save('summaryHistory', history);
    LocalStore._save('lastSummary', summary);
  }

  /**
   * 读取最近一次训练总结
   *
   * @returns {Object|null}
   */
  static getLastSummary() {
    return LocalStore._load('lastSummary');
  }

  /**
   * 读取训练历史记录
   *
   * @returns {Array<Object>}
   */
  static getSessionHistory() {
    return LocalStore._load('summaryHistory') || [];
  }

  // =========================================================================
  // 清除数据
  // =========================================================================

  /**
   * 清除所有康复训练相关数据
   *
   * 仅清除 hr_ 前缀的键，不触碰其他域的数据。
   */
  static clearAll() {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(KEY_PREFIX)) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }

    console.log(`[LocalStore] 已清除 ${keysToRemove.length} 项数据`);
  }

  // =========================================================================
  // 内部方法
  // =========================================================================

  /**
   * 通用保存方法
   *
   * @param {string} key - 短键名（不含前缀）
   * @param {*} value - 可序列化的值
   */
  static _save(key, value) {
    try {
      localStorage.setItem(
        KEY_PREFIX + key,
        JSON.stringify(value)
      );
    } catch (err) {
      console.warn(`[LocalStore] localStorage 写入失败 (${key}):`, err.message);
    }
  }

  /**
   * 通用读取方法
   *
   * @param {string} key - 短键名（不含前缀）
   * @returns {*|null}
   */
  static _load(key) {
    try {
      const raw = localStorage.getItem(KEY_PREFIX + key);
      if (raw === null) return null;
      return JSON.parse(raw);
    } catch (err) {
      console.warn(`[LocalStore] localStorage 读取失败 (${key}):`, err.message);
      return null;
    }
  }

  /**
   * 底层原始值读取（不解析 JSON）
   *
   * @param {string} key - 完整键名
   * @returns {string|null}
   */
  static _getRaw(key) {
    return localStorage.getItem(key);
  }

  /**
   * 底层原始值写入
   *
   * @param {string} key - 完整键名
   * @param {*} value
   */
  static _setRaw(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (err) {
      console.warn(`[LocalStore] 原始写入失败 (${key}):`, err.message);
    }
  }
}

// 模块加载时自动初始化
LocalStore.init();

export { LocalStore };
export default LocalStore;
