/**
 * DTW 模板匹配检测器（第二迭代实现）
 *
 * 当前为第一周开发阶段，此文件仅提供空骨架以支持模块接口设计。
 * 第二迭代将在信号处理检测器验证通过后，实现完整的 DTW 模板匹配算法。
 *
 * 设计目标（规格书 7.3 节）：
 *   - 点击式校准：治疗师点击屏幕标注步态，生成步态模板
 *   - 滑动窗口 DTW 匹配：实时数据流与模板库计算 DTW 距离
 *   - 模板持续优化：高置信度步数自动加入模板库
 *   - 姿态矫正基础：量化当前步态与最佳模板的维度偏差
 */

import { DetectorInterface } from './DetectorInterface.js';

class DTWDetector extends DetectorInterface {
  constructor() {
    super();
    // 模板库将在第二迭代实现
    // this._templates = [];
    // this._recording = [];
    // this._isRecording = false;
  }

  /**
   * 逐帧处理（第二迭代实现）
   *
   * @param {Array<{x:number, y:number, z:number, visibility:number}>} landmarks
   * @returns {DetectorResult}
   */
  processFrame(landmarks) {
    // 空骨架：第一周不实现 DTW 检测
    return { status: 'NO_STEP' };
  }

  /**
   * 设置校准参数（第二迭代实现）
   *
   * @param {CalibrationParams} params
   */
  setCalibration(params) {
    // 第二迭代实现：存储站立基准参数（摔倒检测用）
  }

  /**
   * 重置内部状态（第二迭代实现）
   */
  reset() {
    // 第二迭代实现：清空滑动窗口、录制缓冲等
  }
}

export { DTWDetector };
