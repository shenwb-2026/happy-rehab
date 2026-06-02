# 快乐康复指导 · 技术决策记录 v1.1

**项目**：Happy Rehabilitation Guidance（快乐康复指导）｜**规格书版本**：v1.2｜**记录日期**：2026-06-02

本文档为开发启动前的技术决策汇总，是后续编码与迭代的重要参考依据。

---

## 1. 技术栈决策

| 决策项 | 选定方案 | 理由 |
|---|---|---|
| **框架** | Vanilla JS（无框架） | 游戏循环 + 实时信号处理场景，框架带来摩擦多于收益；游戏模块生命周期方法天然适合 OOP 接口 |
| **构建工具** | Vite | 原生 ESM，PWA 插件生态完善（vite-plugin-pwa），开发体验好 |
| **姿态检测库** | MediaPipe Tasks Vision（`@mediapipe/tasks-vision`） | Google 主推新版，性能优于旧版；WASM 文件打包进 PWA（满足离线要求，不走 CDN） |
| **动画渲染** | Canvas 2D API | 粒子/泡泡场景帧级控制；中低端安卓同时 20-30 个 DOM 元素动画有掉帧风险 |
| **音频** | Web Audio API 合成音效，**手机外放** | 无需下载音频文件；MVP 阶段使用手机扬声器；若诊室嘈杂后续可追加蓝牙扬声器方案（需补偿约 100-200ms 蓝牙延迟）|
| **数据存储** | localStorage | 设备绑定，无服务器，离线优先 |
| **PWA 缓存策略** | **方案A：WASM 全量打包**，放入 `public/mediapipe/`，Vite 构建时打包，Service Worker 预缓存 | 完全离线可用，无需网络；首次安装约 8-15MB，一次性代价 |

---

## 2. 测试设备

**目标手机：Redmi K50**

- 芯片：Snapdragon 870
- 前置摄像头：2000万像素
- WebGL + WASM 性能：预期充裕，30fps 可达
- 支架固定高度：**约 60cm**（小腿至腰部，髋/膝关键点最佳可见范围）

> Q2 已决策：支架固定高度 60cm，与测试设备安装方案一致。
> Q3 已决策：音频输出使用手机外放，MVP 阶段不配置外置蓝牙扬声器。

---

## 3. 项目结构

```
happy-rehab/
├── public/
│   ├── mediapipe/              # WASM 文件（全量离线打包，不走 CDN）
│   │   ├── pose_landmarker_full.task
│   │   └── vision_wasm_*.js / *.wasm
│   └── icons/                  # PWA 图标
│
├── src/
│   ├── core/
│   │   ├── camera.js           # getUserMedia 封装，前置摄像头初始化
│   │   ├── mediapipe.js        # MediaPipe Tasks Vision 初始化与帧回调
│   │   └── session.js          # 训练会话状态机（idle/calibrating/training/rest/ended）
│   │
│   ├── detection/
│   │   ├── DetectorInterface.js   # 可替换接口定义（抽象基类）
│   │   ├── SignalDetector.js      # 第一周：髋关节信号处理算法
│   │   └── DTWDetector.js         # 第二迭代：DTW 模板匹配器（先建空骨架）
│   │
│   ├── games/
│   │   ├── GameInterface.js       # 游戏模块接口定义（生命周期方法）
│   │   ├── CompanionJourney/      # 游戏1：陪伴之旅
│   │   │   ├── index.js
│   │   │   ├── renderer.js        # Canvas 渲染（角色、粒子、路径瓷砖）
│   │   │   └── assets.js          # 角色图形（纯代码绘制，无外部图片依赖）
│   │   └── BubblePop/             # 游戏2：泡泡消消
│   │       ├── index.js
│   │       └── renderer.js
│   │
│   ├── calibration/
│   │   ├── StandingBaseline.js    # 第一周校准：5秒静止采集基准参数
│   │   └── DTWCalibration.js      # 第二迭代校准（先建空骨架）
│   │
│   ├── audio/
│   │   └── SoundEngine.js         # Web Audio API 封装
│   │                              # 升调序列（C5/E5/G5/A5/C6）、破裂音、庆祝和弦
│   │
│   ├── ui/
│   │   ├── CalibrationUI.js       # 校准界面：实时骨骼叠加、置信度条、方向引导
│   │   ├── GameSelect.js          # 游戏选择界面（每次训练重新选）
│   │   ├── RestMode.js            # 休息模式：超大"继续"按钮
│   │   └── SessionSummary.js      # 训练总结：总步数、时长、最高连续步数
│   │
│   ├── storage/
│   │   └── LocalStore.js          # localStorage 统一封装（见第 5 节）
│   │
│   ├── config.js                  # 所有可调参数集中配置（见第 6 节）
│   ├── sw.js                      # Service Worker（vite-plugin-pwa 管理）
│   ├── main.js                    # 应用入口
│   └── index.html
│
├── vite.config.js
├── package.json
└── README.md
```

---

## 4. 核心接口约定

### 4.1 数据流

```
摄像头画面（30fps）
       │
       ▼
  mediapipe.js
  MediaPipe Tasks Vision（WASM + WebGL）
  输出：33个关键点 NormalizedLandmark[]（含 x/y/z/visibility）
       │
       ▼
  DetectorInterface.processFrame(landmarks)
  ┌─────────────────────────────────────────┐
  │  第一周：SignalDetector                  │
  │  - 髋关节水平中点滚动平均                 │
  │  - 峰值检测 + 跨中线验证                  │
  │  - 辅助信号（肩部、膝关节）验证            │
  └─────────────────────────────────────────┘
  输出：StepEvent { timestamp, side } | DetectorStatus
       │
       ├──── status = 'LOW_CONFIDENCE' ──▶  CalibrationUI 显示治疗师提示
       │
       ├──── status = 'FALL_DETECTED'  ──▶  session.js 暂停检测，游戏层播放休息动画
       │
       └──── status = 'STEP'           ──▶
                  │
                  ▼
            session.js（训练会话状态机）
            状态：idle / calibrating / training / rest / ended
                  │
                  ▼（仅 training 状态下转发）
            GameInterface.onStep(timestamp, side)   ← ≤10ms 内调用
            ┌──────────────────────────────────┐
            │  CompanionJourney / BubblePop     │
            │  - Canvas 动画（≤500ms 完成）      │
            │  - SoundEngine 音效               │
            │  - 连续步数计数、场景更新           │
            └──────────────────────────────────┘
```

**关键延迟链路**：脚触地 → MediaPipe 帧处理（30-60ms）→ Detector 信号处理（<5ms）→ onStep 调用（≤10ms）→ 视听反馈完成（≤500ms）。中高端设备全链路实测约 80-110ms。

### 4.2 DetectorInterface

```javascript
class DetectorInterface {
  /**
   * 逐帧处理关键点，返回检测结果。
   *
   * @param {NormalizedLandmark[]} landmarks  33个关键点（含 x/y/z/visibility）
   * @returns {DetectorResult}
   *
   * DetectorResult:
   *   { status: 'STEP',           timestamp: number, side: 'left'|'right' }
   *   { status: 'NO_STEP' }                          — 本帧无步数，正常
   *   { status: 'LOW_CONFIDENCE', reason: string }   — 置信度不足，需提示治疗师
   *   { status: 'FALL_DETECTED' }                    — 髋高低于阈值，判定摔倒/坐下
   */
  processFrame(landmarks) { throw new Error('Not implemented') }

  /**
   * 传入校准阶段采集的基准参数。
   * @param {CalibrationParams} params
   *   - hipNeutralX: number          髋关节中点中立 X 坐标
   *   - shoulderWidthPx: number      像素级肩宽（用于归一化摆动幅度）
   *   - baselineTremorAmplitude: number  基线震颤幅度（噪声阈值）
   *   - standingHipY: number         站立髋关节 Y 坐标（摔倒检测基准）
   */
  setCalibration(params) { throw new Error('Not implemented') }

  /** 重置内部状态（训练结束或重新校准时调用） */
  reset() { throw new Error('Not implemented') }
}
```

**状态说明**：
- `LOW_CONFIDENCE`：髋关节关键点连续 10 帧 visibility < 0.6 时触发，session.js 转发至 CalibrationUI 显示"请调整摄像头位置"提示，同时自动切换至备用信号（肩部摆动）。
- `FALL_DETECTED`：髋关节 Y 坐标低于 `standingHipY × fallDetectionRatio` 时触发，session.js 暂停检测、游戏层切换休息动画，治疗师需手动点击"继续"恢复。

### 4.3 GameInterface

```javascript
class GameInterface {
  onSessionStart()              // 治疗师点击"开始训练"，播放开场仪式
  onStep(timestamp, side)       // 步数事件后 ≤10ms 内调用，≤500ms 内完成视听反馈
  onRestStart()                 // 暂停奖励，进入等待状态
  onRestEnd()                   // 恢复行走奖励循环
  onSessionEnd()                // 播放收尾仪式，返回训练统计
  getStreakCount()              // 返回当前连续步数
}
```

**延迟约束**：脚触地 → 奖励触发总延迟目标 ≤ 500ms。`onStep()` 调用必须在步数事件触发后 **≤ 10ms** 内发起。

---

## 5. 数据存储结构

所有数据通过 `LocalStore.js` 统一读写，key 命名遵循 `hrg.<模块>.<字段>` 规范，便于调试和未来迁移。

### 5.1 存储 Key 一览

| Key | 类型 | 说明 |
|---|---|---|
| `hrg.meta.version` | string | 存储 schema 版本号，用于后续迁移判断（当前值：`"1"`） |
| `hrg.calibration.params` | JSON object | 校准基准参数（见下） |
| `hrg.companion.character` | string | 角色选择：`"fox"` / `"rabbit"` / `"dino"`，首次选择后永久存储 |
| `hrg.progress.totalSteps` | number | 跨训练累计总步数（用于场景解锁，满50步解锁下一场景） |
| `hrg.progress.currentScene` | string | 当前解锁场景：`"forest"` / `"beach"` / `"space"` |
| `hrg.sessions.lastSummary` | JSON object | 最近一次训练总结（步数、时长、最高连续步数） |

### 5.2 校准参数结构

```javascript
// Key: hrg.calibration.params
{
  version: 1,
  updatedAt: 1748822400000,         // Unix 时间戳（ms）

  // 站立基准
  hipNeutralX: 0.512,               // 髋关节中点中立 X（归一化，0-1）
  shoulderWidthPx: 148,             // 像素级肩宽
  standingHipY: 0.48,               // 站立髋关节 Y（归一化）
  baselineTremorAmplitude: 0.008,   // 基线震颤幅度（肩宽归一化后）

  // 指数移动平均更新字段（α=0.2，每次训练结束后更新）
  emaHipY: 0.48,
  emaShoulderWidthPx: 148
}
```

### 5.3 版本迁移规则

`LocalStore.js` 初始化时读取 `hrg.meta.version`，若版本号低于当前代码版本，执行迁移函数后更新版本号，迁移函数在 `LocalStore.js` 内部维护，对调用方透明。

---

## 6. 关键参数配置

所有可调参数集中在 `src/config.js`，首次训练后针对该儿童调优，不散落在各模块内部：

```javascript
// src/config.js

// ─── 检测层参数 ───────────────────────────────────────────────
export const DETECTION_CONFIG = {
  // 髋关节摆动阈值（肩宽归一化比例），临床预估值，首次训练后调优（Q4）
  hipSwingThresholdMin: 0.12,
  hipSwingThresholdMax: 0.18,

  // 步间隔约束
  minStepIntervalMs: 700,           // 最小步间隔（毫秒）

  // 低通滤波
  smoothingFrames: 8,               // 滚动平均帧数（250ms @ 30fps）

  // 峰值有效性
  peakDurationMinMs: 120,           // 峰值最小持续时间（过滤震颤，毫秒）
  peakReturnWindowMs: 1500,         // 峰值后回到中立的时间窗口（毫秒）

  // 跨中线验证
  crosslineTimeWindowMs: 2000,      // 同侧连续峰值合并时间窗口（毫秒）

  // 辅助信号验证时间窗口
  auxiliaryValidationWindowMs: 200, // 辅助信号同步验证时间窗口（毫秒）

  // 启动观察窗口（自动选择有效信号组合）
  signalSelectionWindowMs: 5000,    // 训练开始时信号评估窗口（毫秒）

  // 置信度阈值
  hipConfidenceMin: 0.6,            // 髋关节关键点最低置信度
  keyPointConfidenceMin: 0.5,       // 通用关键点启用阈值（低于此值禁用该关键点）
  lowConfidenceFrameThreshold: 10,  // 连续低置信度帧数，触发 LOW_CONFIDENCE 状态

  // 摔倒检测
  fallDetectionRatio: 0.4,          // 髋高降至校准站立值此比例时判定摔倒/坐下
};

// ─── 游戏层参数 ───────────────────────────────────────────────
export const GAME_CONFIG = {
  // 连续步数机制
  streakBonusAt: 5,                 // 连续 N 步触发奖励
  streakTimeoutMs: 5000,            // 无步数超过此时长重置连续计数（毫秒）
                                    // 休息模式期间暂停超时计时

  // 饥饿值
  hungerIncreasePerStep: 5,         // 每步饥饿值增加量（%）
  streakBonusTiles: 5,              // 连续步数奖励额外生成瓷砖数

  // 场景解锁
  sceneUnlockSteps: 50,             // 跨训练累计步数解锁阈值
  scenes: ['forest', 'beach', 'space'],

  // 动画时长（毫秒）
  bounceAnimationMs: 350,           // 角色弹跳动画时长
  particleLifetimeMs: 700,          // 粒子渐隐时长
  streakDanceMs: 2000,              // 连续步数奖励舞蹈动画时长

  // 泡泡消除
  bubbleSpecialEvery: 5,            // 每 N 个泡泡设隐藏连续奖励泡泡
  bubbleSurpriseRatio: 0.125,       // 随机惊喜泡泡概率（约 1/8）
};
```

---

## 7. 待确认事项

| 编号 | 问题 | 负责人 | 时间节点 |
|---|---|---|---|
| Q4 | 髋关节摆动阈值针对该儿童调优，修改 `config.js` 对应参数 | 开发 | 首次训练后 |

> Q1 已确认：测试设备选定 Redmi K50（Snapdragon 870），预期 30fps 可达。
> Q2 已决策：手机支架固定高度 60cm。
> Q3 已决策：音频输出使用手机外放，MVP 阶段不引入蓝牙扬声器。

---

## 8. 第一周验收标准

| 编号 | 标准 | 测量方式 |
|---|---|---|
| S1 | 训练时长 ≥ 5 分钟，儿童未主动要求终止 | 观察员记录起止时间 |
| S2 | 检测精度 ≥ 80%（每10步误触发 ≤ 2次） | 观察员统计误触发次数 |
| S3 | 检测召回率 ≥ 70%（实际10步，奖励 ≥ 7次） | 观察员统计步数与触发次数之比 |
| S4 | 儿童理解因果：部分步后主动注视/回应屏幕 | 观察员定性记录 |
| S5 | 无技术故障中断训练 | 观察员记录 |

若 S1/S2 达标但 S3 未达标 → 后续迭代优先优化召回率（考虑切换 DTW 检测器）。
连续三次 S1-S4 均未达标 → 优先优化游戏机制，再推进技术开发。



另外注意：

- 原型图是视觉方向参考，不是像素级还原要求——角色、泡泡、路径都是代码绘制，不用对着图抠细节

-  第一周只实现 SignalDetector，DTWDetector 建空骨架即可

- config.js 里的参数首次训练后会调优，开发阶段不要硬编码到各模块里

---

*本文档基于规格书 v1.2 及技术决策讨论整理，v1.1 更新内容：补充数据流图（4.1）、扩展 DetectorInterface 返回类型（4.2）、补全 config.js 参数（第6节）、新增 LocalStore 存储结构说明（第5节）、确认 Q2/Q3 决策。*
