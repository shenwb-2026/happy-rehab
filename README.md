# 快乐康复指导 (Happy Rehab)

基于 MediaPipe 姿态检测的横屏康复训练渐进式网页应用（PWA）。

## 项目结构

```
happy-rehab/
├── public/
│   ├── mediapipe/          # MediaPipe WASM 模型文件（需手动放置）
│   └── icons/              # PWA 图标
├── src/
│   ├── core/               # 核心模块
│   │   ├── sw-register.js  # Service Worker 注册
│   │   ├── camera.js       # 摄像头管理
│   │   ├── mediapipe.js    # MediaPipe 姿态检测封装
│   │   └── session.js      # 会话与存档管理
│   ├── detection/          # 动作检测
│   │   ├── DetectorInterface.js  # 检测器统一接口
│   │   ├── SignalDetector.js     # 即时信号检测（举手、踢腿等）
│   │   └── DTWDetector.js        # DTW 序列匹配检测
│   ├── games/              # 游戏模块
│   │   ├── BubblePop/      # 泡泡大作战
│   │   └── CompanionJourney/ # 伙伴旅程
│   ├── calibration/        # 姿态校准
│   ├── audio/              # 音频管理
│   ├── ui/                 # UI 渲染（Canvas 菜单）
│   ├── storage/            # IndexedDB 持久化
│   ├── config.js           # 全局配置参数
│   ├── main.js             # 应用入口
│   └── styles/             # CSS 样式
├── index.html              # HTML 入口
├── vite.config.js          # Vite + PWA 配置
└── package.json
```

## 技术栈

- **Vite** - 构建工具，支持 Chrome 92+ / Safari 15+
- **Vanilla JS (ES Modules)** - 无框架，轻量高效
- **PWA (vite-plugin-pwa)** - Service Worker + Web App Manifest，离线可用
- **MediaPipe Tasks Vision** - 姿态关键点检测（PoseLandmarker）
- **IndexedDB** - 本地持久化存储（带 localStorage 降级）

## 快速开始

### 前置条件

- Node.js 18+
- npm 9+

### 安装

```bash
cd happy-rehab
npm install
```

### 开发

```bash
npm run dev
```

开发服务器启动在 `http://0.0.0.0:3000`，支持局域网内移动设备访问。

### 构建

```bash
npm run build
```

产物输出到 `dist/` 目录。

### 预览构建产物

```bash
npm run preview
```

## PWA 配置

- 名称：快乐康复指导
- 短名称：快乐康复
- 显示模式：standalone（独立应用）
- 屏幕方向：landscape（强制横屏）
- 主题色：#1a1a2e
- 图标：192×192 / 512×512 PNG

## 目标设备

- 横屏移动浏览器，基准分辨率 1376×768
- 测试设备：Redmi K50
- 所有 UI 文案使用中文

## 待完成

- [ ] 放置 MediaPipe WASM 模型文件到 `public/mediapipe/`
- [ ] 生成 PWA 图标（192×192 / 512×512）
- [ ] 音效文件放置到 `public/audio/`
- [ ] 集成媒体管道检测循环
- [ ] 游戏内交互相机校准与手部检测联调
