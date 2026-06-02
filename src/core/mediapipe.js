/**
 * 快乐康复指导 - MediaPipe 姿态估计封装模块
 *
 * 封装 @mediapipe/tasks-vision 的 PoseLandmarker，
 * 逐帧输出 33 个关键点，通过回调注册机制通知上层。
 *
 * 所有可调参数从 config.js 的 MEDIAPIPE_CONFIG 读取。
 */

import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { MEDIAPIPE_CONFIG } from '../config.js';

/**
 * MediaPipe 姿态检测管理器
 *
 * 职责：
 * - 初始化 PoseLandmarker（加载 WASM + 模型）
 * - 提供 requestAnimationFrame 驱动的逐帧检测循环
 * - 通过回调函数将检测结果（33 个关键点）发送给上层
 * - GPU 初始化失败时自动降级到 CPU 模式
 */
class MediaPipeManager {
  /**
   * @param {Object} config - 配置参数
   * @param {string} [config.wasmPath] - WASM 文件所在目录路径，如 '/mediapipe/'
   * @param {string} [config.modelPath] - 姿态检测模型 task 文件路径
   * @param {Function} [config.onLandmarks] - 每帧关键点回调
   *       回调签名: (landmarks: Array<{x:number,y:number,z:number,visibility:number}> | null) => void
   * @param {Function} [config.onError] - 错误回调 (error: Error) => void
   */
  constructor(config = {}) {
    this.wasmPath = config.wasmPath ?? MEDIAPIPE_CONFIG.wasmPath;
    this.modelPath = config.modelPath ?? MEDIAPIPE_CONFIG.poseModelPath;
    this.onLandmarks = config.onLandmarks ?? null;
    this.onError = config.onError ?? null;

    /** @type {PoseLandmarker|null} MediaPipe 姿态检测器实例 */
    this.poseLandmarker = null;

    /** @type {boolean} 是否已完成初始化 */
    this.initialized = false;

    /** @type {number|null} 动画帧 ID，用于停止循环 */
    this.animationFrameId = null;

    /** @type {number} 上次已处理帧的时间戳（毫秒），用于防止重复处理同一帧 */
    this.lastTimestamp = 0;

    /** @type {boolean} 是否正在运行帧处理循环 */
    this.isRunning = false;
  }

  /**
   * 初始化 PoseLandmarker
   *
   * 操作流程：
   * 1. 加载 Vision WASM 运行时（FilesetResolver）
   * 2. 创建 PoseLandmarker 实例（优先 GPU 模式，失败则降级 CPU）
   * 3. 设置 initialized 标志
   *
   * @returns {Promise<void>}
   * @throws {Error} 初始化失败时抛出中文错误
   */
  async initialize() {
    try {
      // 第一步：加载 Vision WASM 运行时
      const vision = await FilesetResolver.forVisionTasks(this.wasmPath);

      // 第二步：创建 PoseLandmarker（优先 GPU 加速）
      const createOptions = {
        baseOptions: {
          modelAssetPath: this.modelPath,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: MEDIAPIPE_CONFIG.maxPoses,
        minPoseDetectionConfidence: MEDIAPIPE_CONFIG.minPoseDetectionConfidence,
        minPosePresenceConfidence: MEDIAPIPE_CONFIG.minPosePresenceConfidence,
        minPoseTrackingConfidence: MEDIAPIPE_CONFIG.minPoseTrackingConfidence,
      };

      try {
        this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, createOptions);
        console.log('[MediaPipeManager] PoseLandmarker 初始化完成 (GPU 模式)');
      } catch (gpuError) {
        // GPU 初始化失败，降级到 CPU 模式重试
        console.warn('[MediaPipeManager] GPU 初始化失败，降级到 CPU 模式:', gpuError.message);
        createOptions.baseOptions.delegate = 'CPU';
        this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, createOptions);
        console.log('[MediaPipeManager] PoseLandmarker 初始化完成 (CPU 降级模式)');
      }

      this.initialized = true;
    } catch (err) {
      const message = `姿态检测引擎初始化失败: ${err.message || '未知错误'}`;
      console.error(`[MediaPipeManager] ${message}`);
      if (this.onError) {
        this.onError(new Error(message));
      }
      throw new Error(message);
    }
  }

  /**
   * 开始逐帧处理视频画面
   *
   * 使用 requestAnimationFrame 循环：
   * 1. 每帧调用 poseLandmarker.detectForVideo(video, timestamp)
   * 2. 有检测结果时调用 this.onLandmarks(result.landmarks[0] || null)
   * 3. 通过 lastTimestamp 防止重复处理同一帧
   * 4. 连续处理失败（如视频未就绪）时不中断循环，继续下一帧
   *
   * @param {HTMLVideoElement} video - 已就绪的视频元素
   */
  start(video) {
    if (!this.initialized || !this.poseLandmarker) {
      throw new Error('MediaPipe 尚未初始化，请先调用 initialize()');
    }

    if (this.isRunning) {
      console.warn('[MediaPipeManager] 已在运行中，忽略重复 start() 调用');
      return;
    }

    this.isRunning = true;
    this.lastTimestamp = 0;

    /**
     * 逐帧检测循环
     * @param {number} timestamp - requestAnimationFrame 传入的时间戳
     */
    const processFrame = (timestamp) => {
      if (!this.isRunning) return;
      if (!this.poseLandmarker) return;

      // 继续请求下一帧
      this.animationFrameId = requestAnimationFrame(processFrame);

      // 防止重复处理同一帧（video.currentTime 未前进时跳过）
      // 允许时间戳回退场景（如切换视频源）
      if (timestamp <= this.lastTimestamp) {
        return;
      }

      // 检查视频是否就绪
      if (!video || video.readyState < 2) {
        // 视频尚未就绪，跳过本帧但不中断循环
        return;
      }

      try {
        const result = this.poseLandmarker.detectForVideo(video, timestamp);
        this.lastTimestamp = timestamp;

        if (this.onLandmarks) {
          // 提取第一组姿态关键点（只检测 1 人）
          const landmarks = result?.landmarks?.[0] ?? null;
          this.onLandmarks(landmarks);
        }
      } catch (err) {
        // 帧处理失败时记录日志，但不中断循环
        console.warn(`[MediaPipeManager] 帧处理异常: ${err.message}`);
        if (this.onError) {
          this.onError(new Error(`姿态检测帧处理失败: ${err.message}`));
        }
      }
    };

    // 启动循环
    this.animationFrameId = requestAnimationFrame(processFrame);
    console.log('[MediaPipeManager] 逐帧检测循环已启动');
  }

  /**
   * 停止处理循环
   *
   * 取消 requestAnimationFrame，但保留 PoseLandmarker 实例以便重新启动
   */
  stop() {
    this.isRunning = false;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    console.log('[MediaPipeManager] 逐帧检测循环已停止');
  }

  /**
   * 获取当前 PoseLandmarker 实例状态
   *
   * @returns {{ initialized: boolean, running: boolean }}
   */
  getStatus() {
    return {
      initialized: this.initialized,
      running: this.isRunning,
    };
  }

  /**
   * 释放 MediaPipe 资源
   *
   * 关闭 PoseLandmarker 实例，释放 WASM 内存。
   * 调用后需要重新 initialize() 才能使用。
   */
  dispose() {
    this.stop();

    if (this.poseLandmarker) {
      this.poseLandmarker.close();
      this.poseLandmarker = null;
    }

    this.initialized = false;
    this.onLandmarks = null;
    this.onError = null;

    console.log('[MediaPipeManager] 资源已释放');
  }
}

export { MediaPipeManager };
export default MediaPipeManager;
