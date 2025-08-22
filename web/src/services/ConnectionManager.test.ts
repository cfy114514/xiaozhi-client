/**
 * 连接管理器单元测试
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager, ConnectionState } from "./ConnectionManager";

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(public url: string) {
    // 模拟异步连接
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event("open"));
    }, 10);
  }

  send(_data: string) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
  }

  close(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(
      new CloseEvent("close", { code: code || 1000, reason: reason || "" })
    );
  }
}

// 全局 Mock WebSocket
global.WebSocket = MockWebSocket as any;

describe("ConnectionManager", () => {
  let connectionManager: ConnectionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    connectionManager = new ConnectionManager();
  });

  afterEach(() => {
    connectionManager.destroy();
  });

  describe("初始状态", () => {
    it("应该初始化为 DISCONNECTED 状态", () => {
      expect(connectionManager.getConnectionState()).toBe(
        ConnectionState.DISCONNECTED
      );
      expect(connectionManager.isConnected()).toBe(false);
      expect(connectionManager.getCurrentPort()).toBeNull();
    });
  });

  describe("连接管理", () => {
    it("应该能够成功连接到指定端口", async () => {
      const port = 9999;
      const ws = await connectionManager.connect(port);

      expect(ws).toBeInstanceOf(MockWebSocket);
      expect(connectionManager.getConnectionState()).toBe(
        ConnectionState.CONNECTED
      );
      expect(connectionManager.isConnected()).toBe(true);
      expect(connectionManager.getCurrentPort()).toBe(port);
    });

    it("应该能够构建正确的 WebSocket URL", async () => {
      const port = 8888;
      await connectionManager.connect(port);

      // 验证 URL 构建正确
      const stats = connectionManager.getConnectionStats();
      expect(stats.port).toBe(port);
    });

    it("应该在连接超时时抛出错误", async () => {
      // 创建一个会超时的连接管理器
      const timeoutManager = new ConnectionManager({ connectTimeout: 50 });

      // Mock WebSocket 不会自动连接
      const OriginalWebSocket = global.WebSocket;
      global.WebSocket = class {
        readyState = 0; // CONNECTING
        onopen: ((event: Event) => void) | null = null;
        onclose: ((event: CloseEvent) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        url: string;

        constructor(url: string) {
          this.url = url;
          // 不触发 onopen，模拟连接超时
        }

        send(_data: string) {
          throw new Error('WebSocket is not open');
        }

        close() {
          this.readyState = 3; // CLOSED
        }
      } as any;

      await expect(timeoutManager.connect(9999)).rejects.toThrow("连接超时");
      expect(timeoutManager.getConnectionState()).toBe(ConnectionState.FAILED);

      // 恢复原始 WebSocket
      global.WebSocket = OriginalWebSocket;
      timeoutManager.destroy();
    });

    it("应该在连接到相同端口时返回现有连接", async () => {
      const port = 9999;
      const ws1 = await connectionManager.connect(port);
      const ws2 = await connectionManager.connect(port);

      expect(ws1).toBe(ws2);
      expect(connectionManager.getCurrentPort()).toBe(port);
    });

    it("应该能够断开连接", async () => {
      await connectionManager.connect(9999);
      expect(connectionManager.isConnected()).toBe(true);

      connectionManager.disconnect();

      expect(connectionManager.getConnectionState()).toBe(
        ConnectionState.DISCONNECTED
      );
      expect(connectionManager.isConnected()).toBe(false);
      expect(connectionManager.getCurrentPort()).toBeNull();
    });
  });

  describe("消息处理", () => {
    beforeEach(async () => {
      await connectionManager.connect(9999);
    });

    it("应该能够发送消息", async () => {
      const message = { type: "test", data: "hello" };

      // Mock send 方法
      const mockSend = vi.fn();
      (connectionManager as any).currentConnection.send = mockSend;

      await connectionManager.sendMessage(message);

      expect(mockSend).toHaveBeenCalledWith(JSON.stringify(message));
    });

    it("应该在连接不可用时拒绝发送消息", async () => {
      connectionManager.disconnect();

      await expect(
        connectionManager.sendMessage({ type: "test" })
      ).rejects.toThrow("WebSocket 连接不可用");
    });

    it("应该能够添加和移除消息处理器", () => {
      const handler = vi.fn();

      connectionManager.addMessageHandler("test", handler);

      // 模拟接收消息
      const message = { type: "test", data: "hello" };
      (connectionManager as any).handleMessage(message);

      expect(handler).toHaveBeenCalledWith(message);

      // 移除处理器
      connectionManager.removeMessageHandler("test", handler);

      // 再次发送消息，处理器不应该被调用
      (connectionManager as any).handleMessage(message);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("应该能够等待特定类型的消息", async () => {
      const messageType = "testResponse";
      const expectedMessage = { type: messageType, data: "response" };

      // 异步发送消息
      setTimeout(() => {
        (connectionManager as any).handleMessage(expectedMessage);
      }, 50);

      const receivedMessage = await connectionManager.waitForMessage(
        messageType,
        1000
      );
      expect(receivedMessage).toEqual(expectedMessage);
    });

    it("应该在等待消息超时时抛出错误", async () => {
      await expect(
        connectionManager.waitForMessage("nonexistent", 100)
      ).rejects.toThrow("等待消息超时: nonexistent");
    });

    it("应该能够移除所有消息处理器", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      connectionManager.addMessageHandler("type1", handler1);
      connectionManager.addMessageHandler("type2", handler2);

      connectionManager.removeAllMessageHandlers();

      // 发送消息，处理器不应该被调用
      (connectionManager as any).handleMessage({ type: "type1", data: "test" });
      (connectionManager as any).handleMessage({ type: "type2", data: "test" });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe("重连机制", () => {
    it("应该在意外断开时尝试重连", async () => {
      const connectSpy = vi.spyOn(connectionManager, "connect");

      await connectionManager.connect(9999);
      expect(connectionManager.isConnected()).toBe(true);

      // 模拟意外断开
      const ws = (connectionManager as any).currentConnection;
      ws.readyState = MockWebSocket.CLOSED;
      ws.onclose?.(
        new CloseEvent("close", { code: 1006, reason: "Connection lost" })
      );

      // 等待重连尝试
      await new Promise((resolve) => setTimeout(resolve, 2100));

      expect(connectSpy).toHaveBeenCalledTimes(2); // 初始连接 + 重连
    });

    it("应该在达到最大重连次数后停止重连", async () => {
      // 创建一个重连次数限制较小的连接管理器
      const limitedManager = new ConnectionManager({
        maxReconnectAttempts: 2,
        reconnectInterval: 100,
      });

      // Mock connect 方法总是失败
      vi.spyOn(limitedManager, "connect")
        .mockRejectedValue(new Error("连接失败"));

      await limitedManager.connect(9999).catch(() => {});

      // 模拟意外断开触发重连
      (limitedManager as any).handleUnexpectedDisconnect();

      // 等待重连尝试完成 - 进一步增加等待时间
      await new Promise((resolve) => setTimeout(resolve, 2000));

      expect(limitedManager.getConnectionState()).toBe(ConnectionState.FAILED);

      limitedManager.destroy();
    });
  });

  describe("连接统计", () => {
    it("应该提供正确的连接统计信息", async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      connectionManager.addMessageHandler("type1", handler1);
      connectionManager.addMessageHandler("type2", handler2);

      await connectionManager.connect(9999);

      const stats = connectionManager.getConnectionStats();

      expect(stats).toMatchObject({
        state: ConnectionState.CONNECTED,
        port: 9999,
        reconnectAttempts: 0,
        messageHandlerCount: 2,
        pendingMessageCount: 0,
      });
    });

    it("应该正确跟踪待处理的消息数量", async () => {
      await connectionManager.connect(9999);

      // 开始等待消息（不发送响应）
      connectionManager.waitForMessage("test", 5000).catch(() => {});

      const stats = connectionManager.getConnectionStats();
      expect(stats.pendingMessageCount).toBe(1);
    });
  });

  describe("错误处理", () => {
    it("应该正确处理 WebSocket 创建失败", async () => {
      // Mock WebSocket 构造函数抛出错误
      const OriginalWebSocket = global.WebSocket;
      global.WebSocket = class {
        constructor() {
          throw new Error("WebSocket creation failed");
        }
      } as any;

      await expect(connectionManager.connect(9999)).rejects.toThrow(
        "创建 WebSocket 连接失败"
      );

      expect(connectionManager.getConnectionState()).toBe(
        ConnectionState.FAILED
      );

      // 恢复原始 WebSocket
      global.WebSocket = OriginalWebSocket;
    });

    it("应该正确处理消息解析错误", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await connectionManager.connect(9999);

      // 模拟接收无效 JSON 消息
      const ws = (connectionManager as any).currentConnection;
      ws.onmessage?.({ data: "invalid json" } as MessageEvent);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("消息解析失败"),
        expect.any(Error),
        "invalid json"
      );

      consoleSpy.mockRestore();
    });

    it("应该正确处理消息处理器执行错误", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const faultyHandler = vi.fn().mockImplementation(() => {
        throw new Error("Handler error");
      });

      await connectionManager.connect(9999);
      connectionManager.addMessageHandler("test", faultyHandler);

      // 发送消息触发错误处理器
      (connectionManager as any).handleMessage({ type: "test", data: "hello" });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("消息处理器执行失败"),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe("销毁功能", () => {
    it("应该能够正确销毁连接管理器", async () => {
      const handler = vi.fn();

      await connectionManager.connect(9999);
      connectionManager.addMessageHandler("test", handler);

      connectionManager.destroy();

      expect(connectionManager.getConnectionState()).toBe(
        ConnectionState.DISCONNECTED
      );
      expect(connectionManager.isConnected()).toBe(false);
      expect(connectionManager.getCurrentPort()).toBeNull();

      const stats = connectionManager.getConnectionStats();
      expect(stats.messageHandlerCount).toBe(0);
    });
  });
});
