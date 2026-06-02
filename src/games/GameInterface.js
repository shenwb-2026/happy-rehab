/**
 * 游戏模块抽象基类 — GameInterface
 *
 * 所有游戏模块必须实现此接口定义的生命周期方法。
 * 检测层仅通过 onStep 接口向游戏层发送步数事件，
 * 游戏层不感知检测层实现细节。
 *
 * 延迟约束：onStep() 调用必须在步数事件触发后 ≤10ms 内发起，
 * 视听反馈必须在 ≤500ms 内完成。
 */

class GameInterface {
  /**
   * 治疗师点击"开始训练"时触发，播放开场仪式
   */
  onSessionStart() { throw new Error('未实现：onSessionStart'); }

  /**
   * 步数事件后 ≤10ms 内调用，≤500ms 内完成视听反馈
   * @param {number} timestamp — 步数时间戳
   * @param {'left'|'right'} side — 迈步侧
   */
  onStep(timestamp, side) { throw new Error('未实现：onStep'); }

  /**
   * 暂停奖励，进入等待状态
   */
  onRestStart() { throw new Error('未实现：onRestStart'); }

  /**
   * 恢复行走奖励循环
   */
  onRestEnd() { throw new Error('未实现：onRestEnd'); }

  /**
   * 播放收尾仪式，返回训练统计
   * @returns {{ totalSteps: number, streakCount: number }}
   */
  onSessionEnd() { throw new Error('未实现：onSessionEnd'); }

  /**
   * 返回当前连续步数
   * @returns {number}
   */
  getStreakCount() { throw new Error('未实现：getStreakCount'); }

  /**
   * 获取游戏的 Canvas 元素引用
   * @returns {HTMLCanvasElement}
   */
  getCanvas() { throw new Error('未实现：getCanvas'); }

  /**
   * 清理资源（动画帧、事件监听等）
   */
  destroy() { throw new Error('未实现：destroy'); }
}

export { GameInterface };
