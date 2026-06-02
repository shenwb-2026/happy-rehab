/**
 * IndexedDB 存储封装
 *
 * 提供可靠的键值对持久化存储，
 * 用于保存校准数据、训练记录和用户设置。
 */

import { STORAGE_CONFIG } from '../config.js';

/** @type {IDBDatabase|null} */
let db = null;

/**
 * 打开数据库连接
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(
      STORAGE_CONFIG.dbName,
      STORAGE_CONFIG.dbVersion
    );

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains('store')) {
        database.createObjectStore('store', { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = (event) => {
      reject(new Error(`IndexedDB 打开失败: ${event.target.error}`));
    };
  });
}

/**
 * 保存数据
 * @param {string} key
 * @param {*} value
 * @returns {Promise<void>}
 */
export async function saveToIndexedDB(key, value) {
  try {
    const database = await openDB();

    return new Promise((resolve, reject) => {
      const tx = database.transaction('store', 'readwrite');
      const store = tx.objectStore('store');
      store.put({ key, value: JSON.parse(JSON.stringify(value)) });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('IndexedDB 写入失败'));
    });
  } catch (err) {
    // 静默失败，降级到 localStorage
    fallbackSetItem(key, value);
    console.warn('[Storage] IndexedDB 不可用，降级到 localStorage');
  }
}

/**
 * 读取数据
 * @param {string} key
 * @returns {Promise<*>}
 */
export async function loadFromIndexedDB(key) {
  try {
    const database = await openDB();

    return new Promise((resolve, reject) => {
      const tx = database.transaction('store', 'readonly');
      const store = tx.objectStore('store');
      const request = store.get(key);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.value : null);
      };
      request.onerror = () => reject(new Error('IndexedDB 读取失败'));
    });
  } catch (err) {
    // 静默失败，降级到 localStorage
    return fallbackGetItem(key);
  }
}

/**
 * 删除数据
 * @param {string} key
 * @returns {Promise<void>}
 */
export async function deleteFromIndexedDB(key) {
  try {
    const database = await openDB();

    return new Promise((resolve, reject) => {
      const tx = database.transaction('store', 'readwrite');
      const store = tx.objectStore('store');
      store.delete(key);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('IndexedDB 删除失败'));
    });
  } catch (err) {
    localStorage.removeItem(STORAGE_CONFIG.keyPrefix + key);
  }
}

/**
 * localStorage 降级写入
 */
function fallbackSetItem(key, value) {
  try {
    localStorage.setItem(
      STORAGE_CONFIG.keyPrefix + key,
      JSON.stringify(value)
    );
  } catch {
    // localStorage 满了
    console.warn('[Storage] localStorage 已满');
  }
}

/**
 * localStorage 降级读取
 */
function fallbackGetItem(key) {
  try {
    const raw = localStorage.getItem(STORAGE_CONFIG.keyPrefix + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * 关闭数据库连接
 */
export function closeDB() {
  if (db) {
    db.close();
    db = null;
  }
}
