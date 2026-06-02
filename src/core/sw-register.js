/**
 * Service Worker 注册模块
 *
 * 在 PWA 环境下注册 vite-plugin-pwa 生成的 Service Worker，
 * 支持自动更新提示。
 */

let updateReadyCallback = null;

/**
 * 注册 Service Worker
 * @returns {Promise<void>}
 */
export async function registerSW() {
  // 开发环境或不支持 SW 时跳过
  if (!('serviceWorker' in navigator)) {
    console.log('[SW] 当前浏览器不支持 Service Worker');
    return;
  }

  try {
    // vite-plugin-pwa 在构建时注入虚拟模块
    // 开发环境直接跳过
    if (import.meta.env.DEV) {
      console.log('[SW] 开发模式，跳过 SW 注册');
      return;
    }

    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });

    console.log('[SW] 注册成功:', registration.scope);

    // 监听更新
    registration.addEventListener('updatefound', () => {
      const installingWorker = registration.installing;
      if (!installingWorker) return;

      installingWorker.addEventListener('statechange', () => {
        if (
          installingWorker.state === 'installed' &&
          navigator.serviceWorker.controller
        ) {
          console.log('[SW] 新版本已就绪，刷新后生效');
          if (updateReadyCallback) {
            updateReadyCallback();
          }
        }
      });
    });

    // 检查已有更新
    if (registration.waiting) {
      console.log('[SW] 已有等待中的新版本');
      if (updateReadyCallback) {
        updateReadyCallback();
      }
    }
  } catch (err) {
    console.error('[SW] 注册失败:', err);
  }
}

/**
 * 设置 SW 更新就绪时的回调
 * @param {() => void} callback
 */
export function onSWUpdateReady(callback) {
  updateReadyCallback = callback;
}

/**
 * 跳过等待并刷新页面
 */
export async function skipWaitingAndRefresh() {
  const registration = await navigator.serviceWorker.ready;
  if (registration.waiting) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    window.location.reload();
  }
}
