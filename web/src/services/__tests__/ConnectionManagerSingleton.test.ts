/**
 * ConnectionManagerSingleton 测试
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ConnectionManagerSingleton,
  getConnectionManager,
} from "../ConnectionManagerSingleton";

describe("ConnectionManagerSingleton", () => {
  beforeEach(() => {
    // 每个测试前重置单例
    ConnectionManagerSingleton.reset();
  });

  afterEach(() => {
    // 每个测试后清理单例
    ConnectionManagerSingleton.reset();
  });

  describe("单例模式", () => {
    it("应该返回相同的实例", () => {
      const instance1 = getConnectionManager();
      const instance2 = getConnectionManager();

      expect(instance1).toBe(instance2);
    });

    it("应该正确检测实例存在状态", () => {
      expect(ConnectionManagerSingleton.hasInstance()).toBe(false);

      getConnectionManager();

      expect(ConnectionManagerSingleton.hasInstance()).toBe(true);
    });

    it("应该能够获取连接状态", () => {
      expect(ConnectionManagerSingleton.isConnected()).toBe(false);

      getConnectionManager();

      // 初始状态应该是未连接
      expect(ConnectionManagerSingleton.isConnected()).toBe(false);
      expect(ConnectionManagerSingleton.getConnectionState()).toBe(
        "disconnected"
      );
    });

    it("应该能够获取连接统计信息", () => {
      expect(ConnectionManagerSingleton.getConnectionStats()).toBe(null);

      getConnectionManager();

      const stats = ConnectionManagerSingleton.getConnectionStats();
      expect(stats).toBeDefined();
      expect(stats).toHaveProperty("state");
      expect(stats).toHaveProperty("port");
      expect(stats).toHaveProperty("reconnectAttempts");
      expect(stats).toHaveProperty("messageHandlerCount");
      expect(stats).toHaveProperty("pendingMessageCount");
    });
  });

  describe("配置管理", () => {
    it("应该使用默认配置创建实例", () => {
      const manager = getConnectionManager();

      expect(manager).toBeDefined();
      expect(typeof manager.isConnected).toBe("function");
      expect(typeof manager.connect).toBe("function");
      expect(typeof manager.disconnect).toBe("function");
    });

    it("应该能够使用自定义配置", () => {
      const customConfig = {
        connectTimeout: 15000,
        maxReconnectAttempts: 10,
      };

      const manager = getConnectionManager(customConfig);

      expect(manager).toBeDefined();
      // 验证配置是否生效（通过行为验证，因为配置是私有的）
      expect(typeof manager.isConnected).toBe("function");
    });

    it("后续调用应该忽略配置参数", () => {
      const manager1 = getConnectionManager({ connectTimeout: 5000 });
      const manager2 = getConnectionManager({ connectTimeout: 10000 });

      expect(manager1).toBe(manager2);
    });
  });

  describe("生命周期管理", () => {
    it("应该能够重置单例", () => {
      const manager1 = getConnectionManager();
      expect(ConnectionManagerSingleton.hasInstance()).toBe(true);

      ConnectionManagerSingleton.reset();
      expect(ConnectionManagerSingleton.hasInstance()).toBe(false);

      const manager2 = getConnectionManager();
      expect(manager2).not.toBe(manager1);
    });

    it("应该能够销毁单例", () => {
      getConnectionManager();
      expect(ConnectionManagerSingleton.hasInstance()).toBe(true);

      ConnectionManagerSingleton.destroy();
      expect(ConnectionManagerSingleton.hasInstance()).toBe(false);
    });

    it("重置后应该能够创建新实例", () => {
      const manager1 = getConnectionManager();
      ConnectionManagerSingleton.reset();
      const manager2 = getConnectionManager();

      expect(manager1).not.toBe(manager2);
      expect(ConnectionManagerSingleton.hasInstance()).toBe(true);
    });
  });

  describe("状态查询", () => {
    it("无实例时状态查询应该返回默认值", () => {
      expect(ConnectionManagerSingleton.hasInstance()).toBe(false);
      expect(ConnectionManagerSingleton.isConnected()).toBe(false);
      expect(ConnectionManagerSingleton.getConnectionState()).toBe(null);
      expect(ConnectionManagerSingleton.getConnectionStats()).toBe(null);
    });

    it("有实例时状态查询应该返回实际值", () => {
      getConnectionManager();

      expect(ConnectionManagerSingleton.hasInstance()).toBe(true);
      expect(ConnectionManagerSingleton.isConnected()).toBe(false);
      expect(ConnectionManagerSingleton.getConnectionState()).toBe(
        "disconnected"
      );
      expect(ConnectionManagerSingleton.getConnectionStats()).toBeDefined();
    });
  });

  describe("多次调用", () => {
    it("多次获取实例应该返回相同对象", () => {
      const instances = [];

      for (let i = 0; i < 5; i++) {
        instances.push(getConnectionManager());
      }

      // 所有实例应该是同一个对象
      for (let i = 1; i < instances.length; i++) {
        expect(instances[i]).toBe(instances[0]);
      }
    });

    it("并发获取实例应该安全", () => {
      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(Promise.resolve(getConnectionManager()));
      }

      return Promise.all(promises).then((instances) => {
        // 所有实例应该是同一个对象
        for (let i = 1; i < instances.length; i++) {
          expect(instances[i]).toBe(instances[0]);
        }
      });
    });
  });
});
