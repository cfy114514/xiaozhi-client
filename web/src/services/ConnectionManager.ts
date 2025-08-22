/**
 * WebSocket 连接管理器
 * 负责管理 WebSocket 连接的建立、断开、消息发送和接收
 */

/**
 * 消息处理器类型
 */
export type MessageHandler = (message: any) => void;

/**
 * 连接状态枚举
 */
export enum ConnectionState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  RECONNECTING = "reconnecting",
  FAILED = "failed",
}

/**
 * 连接配置接口
 */
export interface ConnectionConfig {
  /** 连接超时时间（毫秒） */
  connectTimeout: number;
  /** 消息等待超时时间（毫秒） */
  messageTimeout: number;
  /** 重连间隔（毫秒） */
  reconnectInterval: number;
  /** 最大重连次数 */
  maxReconnectAttempts: number;
}

/**
 * 默认连接配置
 */
const DEFAULT_CONFIG: ConnectionConfig = {
  connectTimeout: 5000,
  messageTimeout: 10000,
  reconnectInterval: 2000,
  maxReconnectAttempts: 5,
};

/**
 * WebSocket 连接管理器类
 */
export class ConnectionManager {
  private currentConnection: WebSocket | null = null;
  private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
  private messageHandlers: Map<string, Set<MessageHandler>> = new Map();
  private pendingMessages: Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (reason?: any) => void;
      timer: NodeJS.Timeout;
    }
  > = new Map();
  private config: ConnectionConfig;
  private currentPort: number | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<ConnectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 获取当前连接状态
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return (
      this.connectionState === ConnectionState.CONNECTED &&
      this.currentConnection?.readyState === WebSocket.OPEN
    );
  }

  /**
   * 获取当前连接的端口
   */
  getCurrentPort(): number | null {
    return this.currentPort;
  }

  /**
   * 连接到指定端口
   */
  async connect(port: number): Promise<WebSocket> {
    // 如果已经连接到相同端口，直接返回
    if (this.isConnected() && this.currentPort === port) {
      return this.currentConnection!;
    }

    // 断开现有连接
    this.disconnect();

    this.currentPort = port;
    this.connectionState = ConnectionState.CONNECTING;

    const url = this.buildWebSocketUrl(port);
    console.log(`[ConnectionManager] 尝试连接到: ${url}`);

    return new Promise((resolve, reject) => {
      const connectTimeout = setTimeout(() => {
        if (this.currentConnection) {
          this.currentConnection.close();
        }
        this.connectionState = ConnectionState.FAILED;
        reject(new Error(`连接超时: ${url} (${this.config.connectTimeout}ms)`));
      }, this.config.connectTimeout);

      try {
        const ws = new WebSocket(url);
        this.currentConnection = ws;

        ws.onopen = () => {
          clearTimeout(connectTimeout);
          this.connectionState = ConnectionState.CONNECTED;
          this.reconnectAttempts = 0;
          this.setupMessageHandling(ws);

          console.log(`[ConnectionManager] 连接成功: ${url}`);
          resolve(ws);
        };

        ws.onerror = (error) => {
          clearTimeout(connectTimeout);
          this.connectionState = ConnectionState.FAILED;
          console.error(`[ConnectionManager] 连接错误: ${url}`, error);
          reject(new Error(`连接失败: ${url}`));
        };

        ws.onclose = (event) => {
          clearTimeout(connectTimeout);
          console.log(
            `[ConnectionManager] 连接关闭: ${url}, code: ${event.code}, reason: ${event.reason}`
          );

          if (this.connectionState === ConnectionState.CONNECTED) {
            // 意外断开，尝试重连
            this.handleUnexpectedDisconnect();
          } else {
            this.connectionState = ConnectionState.DISCONNECTED;
          }
        };
      } catch (error) {
        clearTimeout(connectTimeout);
        this.connectionState = ConnectionState.FAILED;
        reject(new Error(`创建 WebSocket 连接失败: ${error}`));
      }
    });
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    // 清除重连定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // 清除所有待处理的消息
    for (const { reject, timer } of this.pendingMessages.values()) {
      clearTimeout(timer);
      reject(new Error("连接已断开"));
    }
    this.pendingMessages.clear();

    // 关闭 WebSocket 连接
    if (this.currentConnection) {
      if (this.currentConnection.readyState === WebSocket.OPEN) {
        this.currentConnection.close(1000, "主动断开");
      }
      this.currentConnection = null;
    }

    this.connectionState = ConnectionState.DISCONNECTED;
    this.currentPort = null;
    this.reconnectAttempts = 0;

    console.log("[ConnectionManager] 连接已断开");
  }

  /**
   * 发送消息
   */
  async sendMessage(message: any): Promise<void> {
    if (!this.isConnected()) {
      throw new Error("WebSocket 连接不可用");
    }

    try {
      const messageStr = JSON.stringify(message);
      this.currentConnection!.send(messageStr);
      console.log("[ConnectionManager] 消息已发送:", message.type || "unknown");
    } catch (error) {
      throw new Error(
        `发送消息失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 等待特定类型的消息
   */
  async waitForMessage(type: string, timeout?: number): Promise<any> {
    const actualTimeout = timeout || this.config.messageTimeout;

    return new Promise((resolve, reject) => {
      const messageId = `${type}_${Date.now()}_${Math.random()}`;

      const timer = setTimeout(() => {
        this.pendingMessages.delete(messageId);
        reject(new Error(`等待消息超时: ${type} (${actualTimeout}ms)`));
      }, actualTimeout);

      this.pendingMessages.set(messageId, { resolve, reject, timer });

      // 添加临时消息处理器
      const handler = (message: any) => {
        if (message.type === type) {
          const pending = this.pendingMessages.get(messageId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingMessages.delete(messageId);
            this.removeMessageHandler(type, handler);
            resolve(message);
          }
        }
      };

      this.addMessageHandler(type, handler);
    });
  }

  /**
   * 添加消息处理器
   */
  addMessageHandler(type: string, handler: MessageHandler): void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    this.messageHandlers.get(type)!.add(handler);
  }

  /**
   * 移除消息处理器
   */
  removeMessageHandler(type: string, handler: MessageHandler): void {
    const handlers = this.messageHandlers.get(type);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.messageHandlers.delete(type);
      }
    }
  }

  /**
   * 移除所有消息处理器
   */
  removeAllMessageHandlers(type?: string): void {
    if (type) {
      this.messageHandlers.delete(type);
    } else {
      this.messageHandlers.clear();
    }
  }

  /**
   * 设置消息处理
   */
  private setupMessageHandling(ws: WebSocket): void {
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error("[ConnectionManager] 消息解析失败:", error, event.data);
      }
    };
  }

  /**
   * 处理接收到的消息
   */
  private handleMessage(message: any): void {
    const messageType = message.type;

    if (!messageType) {
      console.warn("[ConnectionManager] 收到无类型消息:", message);
      return;
    }

    console.log(`[ConnectionManager] 收到消息: ${messageType}`);

    // 调用对应类型的处理器
    const handlers = this.messageHandlers.get(messageType);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(message);
        } catch (error) {
          console.error(
            `[ConnectionManager] 消息处理器执行失败 (${messageType}):`,
            error
          );
        }
      }
    }
  }

  /**
   * 处理意外断开连接
   */
  private handleUnexpectedDisconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error("[ConnectionManager] 重连次数已达上限，停止重连");
      this.connectionState = ConnectionState.FAILED;
      return;
    }

    this.connectionState = ConnectionState.RECONNECTING;
    this.reconnectAttempts++;

    console.log(
      `[ConnectionManager] 开始第 ${this.reconnectAttempts} 次重连，${this.config.reconnectInterval}ms 后执行`
    );

    this.reconnectTimer = setTimeout(async () => {
      if (
        this.currentPort &&
        this.connectionState === ConnectionState.RECONNECTING
      ) {
        try {
          await this.connect(this.currentPort);
          console.log("[ConnectionManager] 重连成功");
        } catch (error) {
          console.error("[ConnectionManager] 重连失败:", error);
          this.handleUnexpectedDisconnect(); // 继续尝试重连
        }
      }
    }, this.config.reconnectInterval);
  }

  /**
   * 构建 WebSocket URL
   */
  private buildWebSocketUrl(port: number): string {
    // 优先使用 localStorage 中保存的地址
    const savedUrl = localStorage.getItem("xiaozhi-ws-url");
    if (savedUrl?.includes(`:${port}`)) {
      return savedUrl;
    }

    // 根据当前页面协议构建 WebSocket URL
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const hostname = window.location.hostname || "localhost";

    return `${protocol}//${hostname}:${port}`;
  }

  /**
   * 获取连接统计信息
   */
  getConnectionStats(): {
    state: ConnectionState;
    port: number | null;
    reconnectAttempts: number;
    messageHandlerCount: number;
    pendingMessageCount: number;
  } {
    return {
      state: this.connectionState,
      port: this.currentPort,
      reconnectAttempts: this.reconnectAttempts,
      messageHandlerCount: Array.from(this.messageHandlers.values()).reduce(
        (sum, handlers) => sum + handlers.size,
        0
      ),
      pendingMessageCount: this.pendingMessages.size,
    };
  }

  /**
   * 销毁连接管理器
   */
  destroy(): void {
    this.disconnect();
    this.removeAllMessageHandlers();
    console.log("[ConnectionManager] 连接管理器已销毁");
  }
}
