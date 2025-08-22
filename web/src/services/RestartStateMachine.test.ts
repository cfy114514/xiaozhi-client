/**
 * 重启状态机单元测试
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionManager } from "./ConnectionManager";
import type { HealthChecker } from "./HealthChecker";
import { RestartState, RestartStateMachine } from "./RestartStateMachine";

// Mock 连接管理器
const mockConnectionManager: ConnectionManager = {
  isConnected: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  sendMessage: vi.fn(),
  waitForMessage: vi.fn(),
  addMessageHandler: vi.fn(),
  removeMessageHandler: vi.fn(),
  removeAllMessageHandlers: vi.fn(),
  getConnectionState: vi.fn(),
  getCurrentPort: vi.fn(),
  getConnectionStats: vi.fn(),
  destroy: vi.fn(),
} as any;

// Mock 健康检查器
const mockHealthChecker: HealthChecker = {
  checkServiceHealth: vi.fn(),
  getHealthStatus: vi.fn(),
  waitForServiceReady: vi.fn(),
  verifyServiceRestart: vi.fn(),
  checkMultiplePorts: vi.fn(),
  clearCache: vi.fn(),
  getCacheStats: vi.fn(),
  destroy: vi.fn(),
} as any;

describe("RestartStateMachine", () => {
  let stateMachine: RestartStateMachine;
  let stateChangeListener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // 重置所有 mock
    vi.clearAllMocks();

    // 清除 localStorage
    localStorage.clear();

    // 创建状态机实例
    stateMachine = new RestartStateMachine(
      mockConnectionManager,
      mockHealthChecker
    );

    // 创建状态变化监听器
    stateChangeListener = vi.fn();
    stateMachine.onStateChange(stateChangeListener);
  });

  afterEach(() => {
    stateMachine.reset();
    localStorage.clear();
  });

  describe("初始状态", () => {
    it("应该初始化为 IDLE 状态", () => {
      expect(stateMachine.getCurrentState()).toBe(RestartState.IDLE);
      expect(stateMachine.getContext()).toBeNull();
    });
  });

  describe("重启流程", () => {
    it("应该能够开始重启流程", async () => {
      // 模拟连接管理器已连接
      vi.mocked(mockConnectionManager.isConnected).mockReturnValue(true);
      vi.mocked(mockConnectionManager.sendMessage).mockResolvedValue();

      // 开始重启
      stateMachine.restart(9999);

      // 验证状态变化
      expect(stateMachine.getCurrentState()).toBe(RestartState.INITIATING);
      expect(stateMachine.getContext()).toMatchObject({
        currentPort: 9999,
        targetPort: undefined,
        attempts: 0,
        maxAttempts: 30,
        timeout: 60000,
      });

      // 等待重启流程完成初始化阶段
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 验证发送了重启消息
      expect(mockConnectionManager.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "restartService",
          targetPort: undefined,
        })
      );
    });

    it("应该支持端口变更重启", async () => {
      vi.mocked(mockConnectionManager.isConnected).mockReturnValue(true);
      vi.mocked(mockConnectionManager.sendMessage).mockResolvedValue();

      // 开始重启但不等待完成
      stateMachine.restart(9999, 8888);

      // 立即检查初始状态
      const context = stateMachine.getContext();
      expect(context).toMatchObject({
        currentPort: 9999,
        targetPort: 8888,
      });

      // 等待一小段时间让初始化完成
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockConnectionManager.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "restartService",
          targetPort: 8888,
        })
      );
    });

    it("应该在连接不可用时抛出错误", async () => {
      vi.mocked(mockConnectionManager.isConnected).mockReturnValue(false);

      // 开始重启
      stateMachine.restart(9999);

      // 等待错误处理完成
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(stateMachine.getCurrentState()).toBe(RestartState.FAILED);
      expect(stateMachine.getContext()?.error?.message).toContain(
        "WebSocket 连接不可用"
      );
    });

    it("应该在重启进行中时拒绝新的重启请求", async () => {
      vi.mocked(mockConnectionManager.isConnected).mockReturnValue(true);
      vi.mocked(mockConnectionManager.sendMessage).mockResolvedValue();

      // 开始第一个重启
      stateMachine.restart(9999);

      // 尝试开始第二个重启
      await expect(stateMachine.restart(8888)).rejects.toThrow(
        "重启已在进行中"
      );
    });
  });

  describe("状态转换", () => {
    it("应该正确处理 INITIATING -> RESTARTING 转换", async () => {
      vi.mocked(mockConnectionManager.isConnected).mockReturnValue(true);
      vi.mocked(mockConnectionManager.sendMessage).mockResolvedValue();
      vi.mocked(mockConnectionManager.disconnect).mockImplementation(() => {});

      // 开始重启
      stateMachine.restart(9999);

      // 等待状态转换到 RESTARTING - 增加等待时间
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(stateMachine.getCurrentState()).toBe(RestartState.RESTARTING);
      expect(mockConnectionManager.disconnect).toHaveBeenCalled();
    });
  });

  describe("验证流程", () => {
    it("应该正确设置验证相关的 mock", () => {
      // 测试 mock 设置是否正确
      vi.mocked(mockConnectionManager.waitForMessage).mockResolvedValue({
        type: "restartVerificationResponse",
        data: { restarted: true, healthy: true },
      });
      vi.mocked(mockHealthChecker.checkServiceHealth).mockResolvedValue(true);

      expect(mockConnectionManager.waitForMessage).toBeDefined();
      expect(mockHealthChecker.checkServiceHealth).toBeDefined();
    });
  });

  describe("状态监听器", () => {
    it("应该正确通知状态变化监听器", async () => {
      vi.mocked(mockConnectionManager.isConnected).mockReturnValue(true);
      vi.mocked(mockConnectionManager.sendMessage).mockResolvedValue();

      // 开始重启
      stateMachine.restart(9999);

      // 等待监听器被调用
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 验证监听器被调用
      expect(stateChangeListener).toHaveBeenCalledWith(
        RestartState.INITIATING,
        expect.objectContaining({
          currentPort: 9999,
        })
      );
    });

    it("应该能够移除状态监听器", () => {
      const removeListener = stateMachine.onStateChange(stateChangeListener);

      // 移除监听器
      removeListener();

      // 重置状态机应该不会触发监听器
      stateMachine.reset();
      expect(stateChangeListener).not.toHaveBeenCalled();
    });
  });

  describe("状态持久化", () => {
    it("应该能够从 localStorage 恢复状态", () => {
      // 模拟保存的状态
      const savedState = {
        state: RestartState.RECONNECTING,
        context: {
          currentPort: 9999,
          startTime: Date.now() - 1000, // 1秒前
          attempts: 2,
          maxAttempts: 30,
          timeout: 60000,
          restartId: "test-restart-id",
        },
      };

      localStorage.setItem("restart-state-machine", JSON.stringify(savedState));

      // 创建新的状态机实例并恢复状态
      const newStateMachine = new RestartStateMachine(
        mockConnectionManager,
        mockHealthChecker
      );
      const restored = newStateMachine.restoreState();

      expect(restored).toBe(true);
      expect(newStateMachine.getCurrentState()).toBe(RestartState.RECONNECTING);
      expect(newStateMachine.getContext()?.currentPort).toBe(9999);
    });

    it("应该忽略过期的保存状态", () => {
      // 模拟过期的状态（6分钟前）
      const expiredState = {
        state: RestartState.RECONNECTING,
        context: {
          currentPort: 9999,
          startTime: Date.now() - 6 * 60 * 1000,
          attempts: 2,
          maxAttempts: 30,
          timeout: 60000,
          restartId: "expired-restart-id",
        },
      };

      localStorage.setItem(
        "restart-state-machine",
        JSON.stringify(expiredState)
      );

      const newStateMachine = new RestartStateMachine(
        mockConnectionManager,
        mockHealthChecker
      );
      const restored = newStateMachine.restoreState();

      expect(restored).toBe(false);
      expect(newStateMachine.getCurrentState()).toBe(RestartState.IDLE);
      expect(localStorage.getItem("restart-state-machine")).toBeNull();
    });
  });

  describe("重置功能", () => {
    it("应该能够重置状态机", async () => {
      vi.mocked(mockConnectionManager.isConnected).mockReturnValue(true);
      vi.mocked(mockConnectionManager.sendMessage).mockResolvedValue();

      // 开始重启
      stateMachine.restart(9999);

      // 等待状态设置
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 重置状态机
      stateMachine.reset();

      expect(stateMachine.getCurrentState()).toBe(RestartState.IDLE);
      expect(stateMachine.getContext()).toBeNull();
      expect(localStorage.getItem("restart-state-machine")).toBeNull();
    });
  });

  describe("错误处理", () => {
    it("应该正确处理发送消息失败", async () => {
      vi.mocked(mockConnectionManager.isConnected).mockReturnValue(true);
      vi.mocked(mockConnectionManager.sendMessage).mockRejectedValue(
        new Error("发送失败")
      );

      // 开始重启
      stateMachine.restart(9999);

      // 等待错误处理
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(stateMachine.getCurrentState()).toBe(RestartState.FAILED);
      expect(stateMachine.getContext()?.error?.message).toContain(
        "发送重启请求失败"
      );
    });

    it("应该正确处理状态转换中的异常", async () => {
      vi.mocked(mockConnectionManager.isConnected).mockReturnValue(true);
      vi.mocked(mockConnectionManager.sendMessage).mockResolvedValue();
      vi.mocked(mockConnectionManager.disconnect).mockImplementation(() => {
        throw new Error("断开连接失败");
      });

      // 开始重启
      stateMachine.restart(9999);

      // 等待错误处理 - 增加等待时间
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(stateMachine.getCurrentState()).toBe(RestartState.FAILED);
    });
  });
});
