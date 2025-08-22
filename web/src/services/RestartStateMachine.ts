/**
 * 重启状态机
 * 管理重启服务的完整流程状态转换
 */

import type { ConnectionManager } from "./ConnectionManager";
import type { HealthChecker } from "./HealthChecker";

/**
 * 重启状态枚举
 */
export enum RestartState {
  IDLE = "idle",
  INITIATING = "initiating",
  RESTARTING = "restarting",
  RECONNECTING = "reconnecting",
  VERIFYING = "verifying",
  COMPLETED = "completed",
  FAILED = "failed",
}

/**
 * 重启上下文信息
 */
export interface RestartContext {
  /** 当前端口 */
  currentPort: number;
  /** 目标端口（端口变更时使用） */
  targetPort?: number;
  /** 重启开始时间 */
  startTime: number;
  /** 当前尝试次数 */
  attempts: number;
  /** 最大尝试次数 */
  maxAttempts: number;
  /** 超时时间（毫秒） */
  timeout: number;
  /** 错误信息 */
  error?: Error;
  /** 重启ID，用于追踪 */
  restartId?: string;
}

/**
 * 状态变化监听器
 */
export type StateChangeListener = (
  state: RestartState,
  context: RestartContext
) => void;

/**
 * 重启状态机类
 * 负责管理重启服务的完整流程
 */
export class RestartStateMachine {
  private state: RestartState = RestartState.IDLE;
  private context: RestartContext | null = null;
  private listeners: Set<StateChangeListener> = new Set();
  private transitionPromise: Promise<void> | null = null;

  constructor(
    private connectionManager: ConnectionManager,
    private healthChecker: HealthChecker
  ) {}

  /**
   * 获取当前状态
   */
  getCurrentState(): RestartState {
    return this.state;
  }

  /**
   * 获取当前上下文
   */
  getContext(): RestartContext | null {
    return this.context;
  }

  /**
   * 添加状态变化监听器
   */
  onStateChange(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 开始重启流程
   */
  async restart(currentPort: number, targetPort?: number): Promise<void> {
    if (this.state !== RestartState.IDLE) {
      throw new Error(`重启已在进行中，当前状态: ${this.state}`);
    }

    // 初始化上下文
    this.context = {
      currentPort,
      targetPort,
      startTime: Date.now(),
      attempts: 0,
      maxAttempts: 30,
      timeout: 60000,
      restartId: this.generateRestartId(),
    };

    // 保存状态到本地存储
    this.persistState();

    // 开始状态转换
    await this.transition(RestartState.INITIATING);
  }

  /**
   * 重置状态机到空闲状态
   */
  reset(): void {
    this.state = RestartState.IDLE;
    this.context = null;
    this.transitionPromise = null;
    this.clearPersistedState();
  }

  /**
   * 从本地存储恢复状态
   */
  restoreState(): boolean {
    try {
      const saved = localStorage.getItem("restart-state-machine");
      if (!saved) return false;

      const { state, context } = JSON.parse(saved);

      // 检查状态是否过期（超过5分钟）
      if (Date.now() - context.startTime > 5 * 60 * 1000) {
        this.clearPersistedState();
        return false;
      }

      this.state = state;
      this.context = context;

      // 如果是非终态，继续执行
      if (
        state !== RestartState.IDLE &&
        state !== RestartState.COMPLETED &&
        state !== RestartState.FAILED
      ) {
        this.transition(state);
      }

      return true;
    } catch (error) {
      console.error("恢复重启状态失败:", error);
      this.clearPersistedState();
      return false;
    }
  }

  /**
   * 状态转换核心方法
   */
  private async transition(newState: RestartState): Promise<void> {
    // 防止并发状态转换
    if (this.transitionPromise) {
      await this.transitionPromise;
    }

    this.transitionPromise = this.doTransition(newState);
    try {
      await this.transitionPromise;
    } finally {
      this.transitionPromise = null;
    }
  }

  /**
   * 执行状态转换
   */
  private async doTransition(newState: RestartState): Promise<void> {
    const oldState = this.state;
    this.state = newState;

    console.log(`[RestartStateMachine] 状态转换: ${oldState} -> ${newState}`);

    // 通知监听器
    this.notifyListeners();

    // 保存状态
    this.persistState();

    try {
      // 执行状态处理逻辑
      switch (newState) {
        case RestartState.INITIATING:
          await this.handleInitiating();
          break;
        case RestartState.RESTARTING:
          await this.handleRestarting();
          break;
        case RestartState.RECONNECTING:
          await this.handleReconnecting();
          break;
        case RestartState.VERIFYING:
          await this.handleVerifying();
          break;
        case RestartState.COMPLETED:
          await this.handleCompleted();
          break;
        case RestartState.FAILED:
          await this.handleFailed();
          break;
      }
    } catch (error) {
      console.error(`[RestartStateMachine] 状态处理失败 (${newState}):`, error);

      if (this.context) {
        this.context.error =
          error instanceof Error ? error : new Error(String(error));
      }

      if (newState !== RestartState.FAILED) {
        // 直接设置为失败状态，避免递归调用
        this.state = RestartState.FAILED;
        this.notifyListeners();
        this.persistState();

        // 延迟后重置
        setTimeout(() => {
          this.reset();
        }, 3000);
      }
    }
  }

  /**
   * 处理初始化状态
   */
  private async handleInitiating(): Promise<void> {
    if (!this.context) throw new Error("上下文未初始化");

    try {
      // 检查当前连接状态
      const isConnected = this.connectionManager.isConnected();
      if (!isConnected) {
        throw new Error("WebSocket 连接不可用");
      }

      // 发送重启请求到当前端口
      await this.connectionManager.sendMessage({
        type: "restartService",
        targetPort: this.context.targetPort,
        timestamp: Date.now(),
        restartId: this.context.restartId,
      });

      console.log(
        `[RestartStateMachine] 重启请求已发送到端口 ${this.context.currentPort}`
      );

      // 转换到重启状态
      setTimeout(async () => {
        await this.transition(RestartState.RESTARTING);
      }, 10);
    } catch (error) {
      throw new Error(
        `发送重启请求失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 处理重启状态
   */
  private async handleRestarting(): Promise<void> {
    if (!this.context) throw new Error("上下文未初始化");

    console.log("[RestartStateMachine] 等待服务重启...");

    // 断开当前连接
    this.connectionManager.disconnect();

    // 等待服务完全停止
    await this.delay(2000);

    // 转换到重连状态
    await this.transition(RestartState.RECONNECTING);
  }

  /**
   * 处理重连状态
   */
  private async handleReconnecting(): Promise<void> {
    if (!this.context) throw new Error("上下文未初始化");

    const targetPort = this.context.targetPort || this.context.currentPort;
    const maxAttempts = this.context.maxAttempts;

    console.log(
      `[RestartStateMachine] 开始重连到端口 ${targetPort}，最大尝试次数: ${maxAttempts}`
    );

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.context.attempts = attempt;
      this.notifyListeners(); // 通知进度更新

      try {
        console.log(`[RestartStateMachine] 重连尝试 ${attempt}/${maxAttempts}`);

        // 尝试连接到目标端口
        await this.connectionManager.connect(targetPort);

        if (this.connectionManager.isConnected()) {
          console.log(`[RestartStateMachine] 成功连接到端口 ${targetPort}`);

          // 发送连接探测消息
          await this.connectionManager.sendMessage({
            type: "restartVerification",
            timestamp: this.context.startTime,
            restartId: this.context.restartId,
          });

          // 转换到验证状态
          await this.transition(RestartState.VERIFYING);
          return;
        }
      } catch (error) {
        console.log(
          `[RestartStateMachine] 重连尝试 ${attempt}/${maxAttempts} 失败:`,
          error
        );

        if (attempt < maxAttempts) {
          // 等待后重试
          await this.delay(2000);
        }
      }
    }

    // 所有重连尝试都失败
    throw new Error(`重连失败，已尝试 ${maxAttempts} 次`);
  }

  /**
   * 处理验证状态
   */
  private async handleVerifying(): Promise<void> {
    if (!this.context) throw new Error("上下文未初始化");

    const targetPort = this.context.targetPort || this.context.currentPort;

    try {
      console.log(
        `[RestartStateMachine] 开始验证服务状态，端口: ${targetPort}`
      );

      // 等待服务端响应验证消息
      const response = await this.connectionManager.waitForMessage(
        "restartVerificationResponse",
        10000 // 10秒超时
      );

      if (!response) {
        throw new Error("未收到服务端验证响应");
      }

      // 验证服务健康状态
      const isHealthy = await this.healthChecker.checkServiceHealth(targetPort);

      if (isHealthy && response.data?.restarted) {
        console.log("[RestartStateMachine] 服务验证成功");

        // 如果是端口变更，更新本地存储的 WebSocket URL
        if (
          this.context.targetPort &&
          this.context.targetPort !== this.context.currentPort
        ) {
          localStorage.setItem(
            "xiaozhi-ws-url",
            `ws://localhost:${this.context.targetPort}`
          );
          console.log(
            `[RestartStateMachine] WebSocket URL 已更新为端口 ${this.context.targetPort}`
          );
        }

        await this.transition(RestartState.COMPLETED);
      } else {
        throw new Error("服务健康检查失败或服务未重启");
      }
    } catch (error) {
      throw new Error(
        `服务验证失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 处理完成状态
   */
  private async handleCompleted(): Promise<void> {
    console.log("[RestartStateMachine] 重启流程完成");

    // 通知监听器
    this.notifyListeners();

    // 延迟后回到空闲状态
    setTimeout(() => {
      this.reset();
    }, 1000);
  }

  /**
   * 处理失败状态
   */
  private async handleFailed(): Promise<void> {
    console.error(
      "[RestartStateMachine] 重启流程失败:",
      this.context?.error?.message
    );

    // 通知监听器
    this.notifyListeners();

    // 延迟后回到空闲状态
    setTimeout(() => {
      this.reset();
    }, 3000);
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(): void {
    if (!this.context) return;

    for (const listener of this.listeners) {
      try {
        listener(this.state, this.context!);
      } catch (error) {
        console.error("状态监听器执行失败:", error);
      }
    }
  }

  /**
   * 持久化状态到本地存储
   */
  private persistState(): void {
    if (!this.context) return;

    try {
      const stateData = {
        state: this.state,
        context: this.context,
      };
      localStorage.setItem("restart-state-machine", JSON.stringify(stateData));
    } catch (error) {
      console.error("保存重启状态失败:", error);
    }
  }

  /**
   * 清除持久化状态
   */
  private clearPersistedState(): void {
    try {
      localStorage.removeItem("restart-state-machine");
    } catch (error) {
      console.error("清除重启状态失败:", error);
    }
  }

  /**
   * 生成重启ID
   */
  private generateRestartId(): string {
    return `restart_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 延迟工具方法
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
