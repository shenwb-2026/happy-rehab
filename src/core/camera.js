/**
 * 快乐康复指导 - 前置摄像头管理模块
 *
 * 通过 getUserMedia 获取前置摄像头画面，
 * 提供视频流给 MediaPipe 处理。
 *
 * 所有可调参数从 config.js 的 CAMERA_CONFIG 读取。
 */

import { CAMERA_CONFIG } from '../config.js';

/**
 * 摄像头管理器
 * 封装前置摄像头的启动、停止和资源管理
 */
class CameraManager {
  /**
   * @param {Object} [config] - 摄像头配置（可选，默认使用 CAMERA_CONFIG）
   * @param {number} [config.width] - 目标分辨率宽度
   * @param {number} [config.height] - 目标分辨率高度
   * @param {string} [config.facingMode] - 摄像头朝向：'user'（前置）| 'environment'（后置）
   */
  constructor(config = {}) {
    this.config = {
      width: config.width ?? CAMERA_CONFIG.width,
      height: config.height ?? CAMERA_CONFIG.height,
      facingMode: config.facingMode ?? CAMERA_CONFIG.facingMode,
    };

    /** @type {HTMLVideoElement|null} 隐藏的 video 元素，承载摄像头画面 */
    this.videoElement = null;

    /** @type {MediaStream|null} 当前摄像头流 */
    this.stream = null;

    /** @type {boolean} 是否正在运行 */
    this.isRunning = false;
  }

  /**
   * 启动摄像头
   *
   * 内部操作：
   * 1. 检查浏览器是否支持摄像头 API
   * 2. 调用 getUserMedia 获取前置摄像头流
   * 3. 创建隐藏的 <video> 元素，设置 autoplay/playsinline/muted
   * 4. 将 stream 绑定到 video.srcObject
   * 5. 等待 video 加载就绪后 resolve
   *
   * @returns {Promise<HTMLVideoElement>} 返回已自动播放的 video 元素
   * @throws {Error} 权限被拒绝、设备不可用或浏览器不支持时抛出中文错误
   */
  async start() {
    // 检查浏览器支持
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('当前浏览器不支持摄像头访问，请使用最新版 Chrome 或 Edge');
    }

    // 构建约束参数
    const constraints = {
      video: {
        width: { ideal: this.config.width },
        height: { ideal: this.config.height },
        facingMode: this.config.facingMode,
        frameRate: { ideal: 30 },
      },
      audio: false,
    };

    // 请求摄像头权限并获取流
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      // 根据错误类型返回用户友好的中文消息
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error('摄像头权限被拒绝，请在浏览器设置中允许访问摄像头');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        throw new Error('未检测到摄像头设备，请确认设备已连接');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        throw new Error('摄像头被其他应用占用，请关闭其他使用摄像头的程序后重试');
      } else if (err.name === 'OverconstrainedError') {
        throw new Error('摄像头不支持所需分辨率，请尝试更换设备');
      } else if (err.name === 'AbortError') {
        throw new Error('摄像头启动被中断，请刷新页面重试');
      } else {
        throw new Error(`摄像头启动失败: ${err.message || '未知错误'}`);
      }
    }

    // 创建隐藏的 video 元素作为视频源
    this.videoElement = document.createElement('video');
    this.videoElement.setAttribute('playsinline', '');
    this.videoElement.setAttribute('autoplay', '');
    this.videoElement.setAttribute('muted', '');
    this.videoElement.srcObject = this.stream;
    this.videoElement.style.display = 'none';

    // 等待 video 元数据加载完成
    await new Promise((resolve, reject) => {
      this.videoElement.onloadedmetadata = () => {
        resolve();
      };
      this.videoElement.onerror = (e) => {
        reject(new Error('摄像头画面加载失败，请刷新页面重试'));
      };

      // 触发播放
      this.videoElement.play().catch((err) => {
        reject(new Error(`视频播放失败: ${err.message || '未知错误'}`));
      });
    });

    this.isRunning = true;
    console.log(
      `[CameraManager] 摄像头已启动: ${this.videoElement.videoWidth}×${this.videoElement.videoHeight}`
    );

    return this.videoElement;
  }

  /**
   * 停止摄像头并释放所有资源
   *
   * 操作：
   * 1. 停止 MediaStream 的所有轨（track）
   * 2. 解绑 video 元素的 srcObject
   * 3. 置空内部引用以便 GC 回收
   */
  stop() {
    if (this.stream) {
      // 停止每个媒体轨，释放摄像头硬件资源
      this.stream.getTracks().forEach((track) => {
        track.stop();
      });
      this.stream = null;
    }

    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.srcObject = null;
      this.videoElement.removeAttribute('src');
      this.videoElement = null;
    }

    this.isRunning = false;
    console.log('[CameraManager] 摄像头已停止，资源已释放');
  }

  /**
   * 获取当前视频元素引用
   *
   * @returns {HTMLVideoElement|null} 返回视频元素，未启动时返回 null
   */
  getVideoElement() {
    return this.videoElement;
  }

  /**
   * 检查摄像头是否正在运行
   *
   * @returns {boolean}
   */
  isActive() {
    return this.isRunning && !!this.stream && !!this.videoElement;
  }

  /**
   * 获取当前视频实际分辨率
   *
   * @returns {{ width: number, height: number }|null}
   */
  getResolution() {
    if (!this.videoElement) return null;
    return {
      width: this.videoElement.videoWidth,
      height: this.videoElement.videoHeight,
    };
  }
}

export { CameraManager };
export default CameraManager;
