/**
 * 检测器抽象基类
 *
 * 所有步态检测器（SignalDetector、DTWDetector 等）必须继承此类。
 * 提供统一的生命周期接口：逐帧处理 → 校准 → 重置。
 * 游戏层通过此接口调用，无需感知底层算法是信号处理还是 DTW 模板匹配。
 */

/**
 * 步数检测结果
 *
 * @typedef {Object} DetectorResult
 * @property {'STEP'|'NO_STEP'|'LOW_CONFIDENCE'|'FALL_DETECTED'} status
 *           检测器状态
 * @property {number} [timestamp]
 *           status=STEP 时的时间戳（毫秒）
 * @property {'left'|'right'} [side]
 *           status=STEP 时的迈步侧
 * @property {string} [reason]
 *           status=LOW_CONFIDENCE 时的原因描述
 */

/**
 * 校准参数
 *
 * @typedef {Object} CalibrationParams
 * @property {number} hipNeutralX
 *           髋关节中点中立 X 坐标（归一化 0-1）
 * @property {number} shoulderWidthPx
 *           像素级肩宽（用于归一化摆动幅度）
 * @property {number} standingHipY
 *           站立髋关节 Y 坐标（归一化，摔倒检测基准）
 * @property {number} baselineTremorAmplitude
 *           基线震颤幅度（归一化，噪声阈值）
 */

class DetectorInterface {
  /**
   * 逐帧处理关键点，返回检测结果
   *
   * 每一帧摄像头画面经 MediaPipe 处理后调用此方法。
   * 子类必须重写，实现具体检测算法。
   *
   * @param {Array<{x:number, y:number, z:number, visibility:number}>} landmarks
   *        MediaPipe 输出的 33 个归一化关键点
   * @returns {DetectorResult}
   */
  processFrame(landmarks) {
    throw new Error('未实现：子类必须重写 processFrame() 方法');
  }

  /**
   * 传入校准阶段采集的基准参数
   *
   * 校准完成后由 session.js 调用，传入站立基准测量值。
   * 校准参数用于摆动幅度归一化、摔倒检测基准等。
   *
   * @param {CalibrationParams} params
   */
  setCalibration(params) {
    throw new Error('未实现：子类必须重写 setCalibration() 方法');
  }

  /**
   * 重置内部状态
   *
   * 训练结束或重新校准前调用，清空所有缓冲区、计数器。
   * 保留校准参数不变（重新校准由 setCalibration 覆盖）。
   */
  reset() {
    throw new Error('未实现：子类必须重写 reset() 方法');
  }
}

export { DetectorInterface };
