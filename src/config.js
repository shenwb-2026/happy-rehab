/**
 * 快乐康复指导 - 全局配置
 *
 * 所有与检测阈值、游戏参数、摄像头设置相关的魔法数字均集中于此。
 * 按功能域分组，便于调参和后续接入管理后台。
 */

// =========================================================================
// 摄像头与画布
// =========================================================================
export const CAMERA_CONFIG = {
  /** 目标分辨率宽度（横屏基准） */
  width: 1376,
  /** 目标分辨率高度（横屏基准） */
  height: 768,
  /** 摄像头首选 facingMode（'user' = 前置, 'environment' = 后置） */
  facingMode: 'user',
};

// =========================================================================
// MediaPipe 姿态检测
// =========================================================================
export const MEDIAPIPE_CONFIG = {
  /** WASM 文件所在路径（public 目录相对路径） */
  wasmPath: '/mediapipe/',
  /** 姿态检测模型路径 */
  poseModelPath: '/mediapipe/pose_landmarker_lite.task',
  /** 最大同时检测人数 */
  maxPoses: 1,
  /** 姿态检测器运行模式：'VIDEO' | 'LIVE_STREAM' */
  runningMode: 'LIVE_STREAM',
  /** 最小检测置信度 [0, 1] */
  minPoseDetectionConfidence: 0.5,
  /** 最小姿态跟踪置信度 [0, 1] */
  minPoseTrackingConfidence: 0.5,
  /** 最小姿态存在置信度 [0, 1] */
  minPosePresenceConfidence: 0.5,
  /** 是否输出分割掩码 */
  outputSegmentationMasks: false,
};

// =========================================================================
// 步态检测参数（第一周：髋关节信号处理算法）
// 所有参数首次训练后可针对该儿童调优，开发阶段不硬编码到各模块
// =========================================================================
export const DETECTION_CONFIG = {
  // ── 髋关节摆动阈值（肩宽归一化比例）──
  /** 髋关节摆动最小幅度（肩宽比例），低于此值不视为迈步 */
  hipSwingThresholdMin: 0.12,
  /** 髋关节摆动最大幅度（肩宽比例），高于此值可能为异常信号 */
  hipSwingThresholdMax: 0.18,

  // ── 步间隔约束 ──
  /** 最小步间隔（毫秒），强制限制步数检测频率 */
  minStepIntervalMs: 700,

  // ── 低通滤波 ──
  /** 滚动平均帧数（250ms @ 30fps） */
  smoothingFrames: 8,

  // ── 峰值有效性 ──
  /** 峰值最小持续时间（毫秒），过滤震颤噪声 */
  peakDurationMinMs: 120,
  /** 峰值后回到中立的时间窗口（毫秒） */
  peakReturnWindowMs: 1500,

  // ── 跨中线验证 ──
  /** 同侧连续峰值合并时间窗口（毫秒） */
  crosslineTimeWindowMs: 2000,

  // ── 辅助信号验证 ──
  /** 辅助信号同步验证时间窗口（毫秒） */
  auxiliaryValidationWindowMs: 200,

  // ── 启动观察窗口 ──
  /** 训练开始时信号评估窗口（毫秒） */
  signalSelectionWindowMs: 5000,

  // ── 置信度阈值 ──
  /** 髋关节关键点最低置信度 */
  hipConfidenceMin: 0.6,
  /** 通用关键点启用阈值（低于此值禁用该关键点） */
  keyPointConfidenceMin: 0.5,
  /** 连续低置信度帧数，触发 LOW_CONFIDENCE 状态 */
  lowConfidenceFrameThreshold: 10,

  // ── 摔倒检测 ──
  /** 髋高降至校准站立值此比例时判定摔倒/坐下 */
  fallDetectionRatio: 0.4,
};

// =========================================================================
// 校准参数
// =========================================================================
export const CALIBRATION_CONFIG = {
  /** 校准提示持续时间（ms） */
  promptDurationMs: 3000,
  /** 校准采集帧数 */
  sampleFrames: 30,
  /** 校准允许的最大姿态波动（像素标准差），超过则提示重新校准 */
  maxPoseVariance: 5.0,
  /** 默认基准关节（用于初始化归一化参考） */
  referenceJoints: [11, 12, 23, 24], // 左右肩、左右髋
};

// =========================================================================
// 游戏通用配置
// =========================================================================
export const GAME_CONFIG = {
  /** 默认游戏时长（ms） */
  defaultDurationMs: 60_000,
  /** 难度等级：'easy' | 'normal' | 'hard' */
  defaultDifficulty: 'normal',

  /** 泡泡游戏 - BubblePop */
  bubblePop: {
    /** 泡泡生成间隔（ms） */
    spawnIntervalMs: 1200,
    /** 同时最大泡泡数 */
    maxBubbles: 8,
    /** 泡泡半径（像素） */
    bubbleRadius: 50,
    /** 泡泡移动速度范围（像素/帧） */
    bubbleSpeedMin: 1.5,
    bubbleSpeedMax: 4.0,
    /** 泡泡颜色列表 */
    colors: ['#FF6B6B', '#4ECDC4', '#FFE66D', '#A78BFA', '#34D399', '#F472B6'],
    /** 击中泡泡需要的挥手距离阈值（像素） */
    hitDistanceThreshold: 60,
    /** 得分：普通泡泡 */
    scorePerBubble: 10,
    /** 得分：特殊泡泡（金泡泡） */
    scorePerGoldenBubble: 30,
  },

  /** 伙伴旅程 - CompanionJourney */
  companionJourney: {
    /** 目标动作列表 */
    targetActions: ['raise_left_hand', 'raise_right_hand', 'raise_both_hands', 'kick_left', 'kick_right', 'jump', 'squat', 'clap'],
    /** 动作提示显示时间（ms） */
    actionPromptDurationMs: 4000,
    /** 动作间休息间隔（ms） */
    restIntervalMs: 1500,
    /** 每轮动作数 */
    actionsPerRound: 5,
    /** 通过判定相似度阈值 */
    passSimilarityThreshold: 0.7,
    /** 星星评分区间 */
    starThresholds: {
      one: 0.5,
      two: 0.7,
      three: 0.85,
    },
  },
};

// =========================================================================
// 音频配置
// =========================================================================
export const AUDIO_CONFIG = {
  /** 是否启用音效 */
  enabled: true,
  /** 主音量 [0, 1] */
  masterVolume: 0.7,
  /** 音效文件映射（key → public 目录路径） */
  sounds: {
    success: '/audio/success.mp3',
    fail: '/audio/fail.mp3',
    click: '/audio/click.mp3',
    bubblePop: '/audio/bubble-pop.mp3',
    countdown: '/audio/countdown.mp3',
    cheer: '/audio/cheer.mp3',
  },
};

// =========================================================================
// UI 配置
// =========================================================================
export const UI_CONFIG = {
  /** 主题色 */
  colors: {
    primary: '#7C5CFC',
    secondary: '#4ECDC4',
    success: '#34D399',
    warning: '#FBBF24',
    danger: '#F472B6',
    dark: '#0f0f23',
    darker: '#1a1a2e',
    text: '#FFFFFF',
    textMuted: '#94A3B8',
    overlay: 'rgba(15, 15, 35, 0.85)',
  },
  /** 按钮圆角半径（px） */
  borderRadius: 12,
  /** 字体栈 */
  fontFamily: "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
  /** 大号字体 */
  fontSizeLarge: 28,
  /** 中号字体 */
  fontSizeMedium: 20,
  /** 小号字体 */
  fontSizeSmall: 14,
};

// =========================================================================
// 存储配置
// =========================================================================
export const STORAGE_CONFIG = {
  /** localStorage 键名前缀 */
  keyPrefix: 'hr_',
  /** 存储键名 */
  keys: {
    settings: 'hr_settings',
    progress: 'hr_progress',
    records: 'hr_records',
    calibration: 'hr_calibration',
  },
  /** IndexedDB 数据库名 */
  dbName: 'HappyRehabDB',
  /** 数据库版本 */
  dbVersion: 1,
};

// =========================================================================
// 会话配置
// =========================================================================
export const SESSION_CONFIG = {
  /** 每日建议训练时长（分钟） */
  dailyGoalMinutes: 15,
  /** 单次训练最大时长（ms） */
  maxSessionDurationMs: 10 * 60_000,
  /** 自动保存间隔（ms） */
  autoSaveIntervalMs: 30_000,
};

// =========================================================================
// 调试开关
// =========================================================================
export const DEBUG_CONFIG = {
  /** 是否在 Canvas 上绘制骨骼连线 */
  drawSkeleton: false,
  /** 是否显示 FPS */
  showFPS: false,
  /** 是否在控制台输出检测日志 */
  verboseLogging: false,
  /** 是否使用虚拟摄像头（无摄像头时模拟数据） */
  useMockCamera: false,
};
