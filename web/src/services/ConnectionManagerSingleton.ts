/**
 * ConnectionManager 单例
 * 确保整个应用只有一个连接管理器实例，避免状态不同步问题
 */

import { type ConnectionConfig, ConnectionManager } from "./ConnectionManager";

/**
 * 默认连接配置
 */
const DEFAULT_SINGLETON_CONFIG: Partial<ConnectionConfig> = {
  connectTimeout: 10000,
  maxReconnectAttempts: 5,
  reconnectInterval: 2000,
  messageTimeout: 10000,
};

/**
 * ConnectionManager 单例类
 */
class ConnectionManagerSingleton {
  private static instance: ConnectionManager | null = null;
  private static isInitialized = false;

  /**
   * 获取 ConnectionManager 单例实例
   */
  static getInstance(config?: Partial<ConnectionConfig>): ConnectionManager {
    if (!ConnectionManagerSingleton.instance) {
      const finalConfig = { ...DEFAULT_SINGLETON_CONFIG, ...config };
      ConnectionManagerSingleton.instance = new ConnectionManager(finalConfig);
      ConnectionManagerSingleton.isInitialized = true;

      console.log(
        "[ConnectionManagerSingleton] 创建新的 ConnectionManager 实例"
      );
    } else if (config && !ConnectionManagerSingleton.isInitialized) {
      // 如果实例已存在但还未初始化配置，则更新配置
      console.log(
        "[ConnectionManagerSingleton] 使用现有的 ConnectionManager 实例"
      );
    }

    return ConnectionManagerSingleton.instance;
  }

  /**
   * 检查是否已有实例
   */
  static hasInstance(): boolean {
    return ConnectionManagerSingleton.instance !== null;
  }

  /**
   * 获取当前实例的连接状态（如果存在）
   */
  static getConnectionState(): string | null {
    if (ConnectionManagerSingleton.instance) {
      return ConnectionManagerSingleton.instance.getConnectionState();
    }
    return null;
  }

  /**
   * 检查是否已连接（如果存在实例）
   */
  static isConnected(): boolean {
    if (ConnectionManagerSingleton.instance) {
      return ConnectionManagerSingleton.instance.isConnected();
    }
    return false;
  }

  /**
   * 获取连接统计信息（如果存在实例）
   */
  static getConnectionStats() {
    if (ConnectionManagerSingleton.instance) {
      return ConnectionManagerSingleton.instance.getConnectionStats();
    }
    return null;
  }

  /**
   * 重置单例（主要用于测试）
   */
  static reset(): void {
    if (ConnectionManagerSingleton.instance) {
      ConnectionManagerSingleton.instance.destroy();
      ConnectionManagerSingleton.instance = null;
      ConnectionManagerSingleton.isInitialized = false;
      console.log("[ConnectionManagerSingleton] 单例已重置");
    }
  }

  /**
   * 销毁单例
   */
  static destroy(): void {
    if (ConnectionManagerSingleton.instance) {
      ConnectionManagerSingleton.instance.destroy();
      ConnectionManagerSingleton.instance = null;
      ConnectionManagerSingleton.isInitialized = false;
      console.log("[ConnectionManagerSingleton] 单例已销毁");
    }
  }
}

/**
 * 导出便捷的获取实例方法
 */
export const getConnectionManager = (
  config?: Partial<ConnectionConfig>
): ConnectionManager => {
  return ConnectionManagerSingleton.getInstance(config);
};

/**
 * 导出单例类（用于高级操作）
 */
export { ConnectionManagerSingleton };

/**
 * 导出类型
 */
export type { ConnectionConfig };
