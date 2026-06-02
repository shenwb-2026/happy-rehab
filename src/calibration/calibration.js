/**
 * 校准模块
 *
 * 引导用户在开始训练前进行基准姿态校准，
 * 采集关键关节的静止参考位置，用于后续检测的归一化。
 */

import { CALIBRATION_CONFIG } from '../config.js';

/**
 * @typedef {Object} CalibrationData
 * @property {Array} referenceLandmarks - 基准关键点
 * @property {number} shoulderWidth - 肩宽（归一化）
 * @property {number} height - 身高（归一化）
 * @property {number} timestamp - 校准时间
 */

/** @type {CalibrationData|null} */
let calibrationData = null;

/** 校准状态 */
let calibrationState = 'idle'; // 'idle' | 'prompting' | 'collecting' | 'done'

/** 采集缓冲区 */
let sampleBuffer = [];
let sampleCount = 0;

/** 回调 */
let onProgress = null;
let onComplete = null;

/**
 * 开始校准流程
 * @param {Object} options
 * @param {(progress: number) => void} [options.onProgress]
 * @param {(data: CalibrationData) => void} [options.onComplete]
 */
export function startCalibration({ onProgress: progressCb, onComplete: completeCb } = {}) {
  onProgress = progressCb || null;
  onComplete = completeCb || null;
  sampleBuffer = [];
  sampleCount = 0;
  calibrationState = 'prompting';

  // 提示阶段后自动进入采集
  setTimeout(() => {
    calibrationState = 'collecting';
  }, CALIBRATION_CONFIG.promptDurationMs);
}

/**
 * 输入一帧 landmarks 进行校准采集
 * @param {Array} landmarks
 * @returns {{ progress: number, done: boolean }}
 */
export function feedCalibrationFrame(landmarks) {
  if (calibrationState !== 'collecting' || !landmarks || landmarks.length < 33) {
    return { progress: 0, done: false };
  }

  sampleBuffer.push(landmarks);
  sampleCount++;

  const progress = Math.min(1, sampleCount / CALIBRATION_CONFIG.sampleFrames);
  if (onProgress) onProgress(progress);

  if (sampleCount >= CALIBRATION_CONFIG.sampleFrames) {
    calibrationData = computeCalibration(sampleBuffer);
    calibrationState = 'done';

    if (onComplete) onComplete(calibrationData);
    return { progress: 1, done: true };
  }

  return { progress, done: false };
}

/**
 * 从样本帧计算校准数据
 * @param {Array[]} samples
 * @returns {CalibrationData}
 */
function computeCalibration(samples) {
  // 对每帧的每个关键点取平均值
  const avgLandmarks = [];
  const numJoints = samples[0].length;

  for (let j = 0; j < numJoints; j++) {
    let sumX = 0, sumY = 0, sumZ = 0, sumV = 0;
    for (const sample of samples) {
      const lm = sample[j];
      sumX += lm.x;
      sumY += lm.y;
      sumZ += lm.z;
      sumV += lm.visibility;
    }
    avgLandmarks.push({
      x: sumX / samples.length,
      y: sumY / samples.length,
      z: sumZ / samples.length,
      visibility: sumV / samples.length,
    });
  }

  // 计算肩宽（11=左肩, 12=右肩）
  const ls = avgLandmarks[11];
  const rs = avgLandmarks[12];
  const shoulderWidth = Math.sqrt((rs.x - ls.x) ** 2 + (rs.y - ls.y) ** 2);

  // 计算身高（0=鼻子, 28=右脚踝 的大致估计）
  const nose = avgLandmarks[0];
  const la = avgLandmarks[27];
  const ra = avgLandmarks[28];
  const avgAnkleY = (la.y + ra.y) / 2;
  const height = avgAnkleY - nose.y;

  return {
    referenceLandmarks: avgLandmarks,
    shoulderWidth,
    height: Math.abs(height),
    timestamp: Date.now(),
  };
}

/**
 * 获取当前校准数据
 * @returns {CalibrationData|null}
 */
export function getCalibrationData() {
  return calibrationData;
}

/**
 * 是否已校准
 * @returns {boolean}
 */
export function isCalibrated() {
  return calibrationState === 'done' && !!calibrationData;
}

/**
 * 获取当前校准状态
 * @returns {string}
 */
export function getCalibrationState() {
  return calibrationState;
}

/**
 * 重置校准
 */
export function resetCalibration() {
  calibrationData = null;
  calibrationState = 'idle';
  sampleBuffer = [];
  sampleCount = 0;
  onProgress = null;
  onComplete = null;
}

/**
 * 检查姿态波动是否过大，需要重新校准
 * @param {Array} landmarks
 * @param {CalibrationData} calibData
 * @returns {number} 偏差值
 */
export function checkPoseVariance(landmarks, calibData) {
  if (!calibData) return Infinity;

  const refs = CALIBRATION_CONFIG.referenceJoints;
  let totalVariance = 0;

  for (const idx of refs) {
    const curr = landmarks[idx];
    const ref = calibData.referenceLandmarks[idx];
    totalVariance += Math.sqrt(
      (curr.x - ref.x) ** 2 + (curr.y - ref.y) ** 2
    );
  }

  return totalVariance / refs.length;
}
