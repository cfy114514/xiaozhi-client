/**
 * 健康检查器单元测试
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HealthChecker } from "./HealthChecker";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("HealthChecker", () => {
  let healthChecker: HealthChecker;

  beforeEach(() => {
    vi.clearAllMocks();
    healthChecker = new HealthChecker();
  });

  afterEach(() => {
    healthChecker.destroy();
  });

  describe("基本健康检查", () => {
    it("应该能够检查服务健康状态 - 健康", async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: "healthy",
          timestamp: Date.now(),
          uptime: 3600,
          port: 9999,
          version: "1.0.0",
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const isHealthy = await healthChecker.checkServiceHealth(9999);

      expect(isHealthy).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:9999/api/health",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Accept: "application/json",
            "Cache-Control": "no-cache",
          }),
        })
      );
    });

    it("应该能够检查服务健康状态 - 不健康", async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: "unhealthy",
          timestamp: Date.now(),
          error: "Database connection failed",
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const isHealthy = await healthChecker.checkServiceHealth(9999);

      expect(isHealthy).toBe(false);
    });

    it("应该在 HTTP 错误时返回不健康状态", async () => {
      const mockResponse = {
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      };
      mockFetch.mockResolvedValue(mockResponse);

      const isHealthy = await healthChecker.checkServiceHealth(9999);

      expect(isHealthy).toBe(false);
    });

    it("应该在网络错误时返回不健康状态", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const isHealthy = await healthChecker.checkServiceHealth(9999);

      expect(isHealthy).toBe(false);
    });

    it("应该在请求超时时返回不健康状态", async () => {
      // 创建一个超时时间很短的健康检查器
      const quickChecker = new HealthChecker({ timeout: 100 });

      // Mock fetch 延迟响应
      mockFetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 200))
      );

      const isHealthy = await quickChecker.checkServiceHealth(9999);

      expect(isHealthy).toBe(false);

      quickChecker.destroy();
    });
  });

  describe("详细健康状态", () => {
    it("应该返回详细的健康状态信息", async () => {
      const mockHealthData = {
        status: "healthy",
        timestamp: 1234567890,
        uptime: 3600,
        port: 9999,
        version: "1.0.0",
        details: {
          database: true,
          cache: true,
        },
      };

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue(mockHealthData),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await healthChecker.getHealthStatus(9999);

      expect(result).toMatchObject({
        healthy: true,
        timestamp: 1234567890,
        uptime: 3600,
        port: 9999,
        version: "1.0.0",
        details: mockHealthData,
      });
    });

    it("应该正确处理错误响应的详细信息", async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await healthChecker.getHealthStatus(9999);

      expect(result).toMatchObject({
        healthy: false,
        port: 9999,
        error: "HTTP 500: Internal Server Error",
      });
    });
  });

  describe("缓存机制", () => {
    it("应该缓存健康检查结果", async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: "healthy",
          timestamp: Date.now(),
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      // 第一次调用
      await healthChecker.getHealthStatus(9999);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // 第二次调用应该使用缓存
      await healthChecker.getHealthStatus(9999);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("应该在缓存过期后重新检查", async () => {
      // 创建一个缓存时间很短的健康检查器
      const shortCacheChecker = new HealthChecker();

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: "healthy",
          timestamp: Date.now(),
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      // 第一次调用
      await shortCacheChecker.getHealthStatus(9999);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // 等待缓存过期
      await new Promise((resolve) => setTimeout(resolve, 2100));

      // 第二次调用应该重新检查
      await shortCacheChecker.getHealthStatus(9999);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      shortCacheChecker.destroy();
    });

    it("应该能够清除缓存", async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: "healthy",
          timestamp: Date.now(),
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      // 第一次调用
      await healthChecker.getHealthStatus(9999);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // 清除缓存
      healthChecker.clearCache(9999);

      // 第二次调用应该重新检查
      await healthChecker.getHealthStatus(9999);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("应该能够清除所有缓存", async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: "healthy",
          timestamp: Date.now(),
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      // 检查多个端口
      await healthChecker.getHealthStatus(9999);
      await healthChecker.getHealthStatus(8888);

      const statsBefore = healthChecker.getCacheStats();
      expect(statsBefore.size).toBe(2);

      // 清除所有缓存
      healthChecker.clearCache();

      const statsAfter = healthChecker.getCacheStats();
      expect(statsAfter.size).toBe(0);
    });
  });

  describe("等待服务就绪", () => {
    it("应该在服务健康时立即返回", async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: "healthy",
          timestamp: Date.now(),
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const startTime = Date.now();
      const isReady = await healthChecker.waitForServiceReady(9999, 5000);
      const duration = Date.now() - startTime;

      expect(isReady).toBe(true);
      expect(duration).toBeLessThan(1000); // 应该很快返回
    });

    it("应该在服务不健康时重试", async () => {
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        const isHealthy = callCount >= 3; // 第3次调用时变为健康

        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: isHealthy ? "healthy" : "unhealthy",
            timestamp: Date.now(),
          }),
        });
      });

      // 使用较短的重试间隔进行测试
      const quickChecker = new HealthChecker({ retryInterval: 100 });

      const isReady = await quickChecker.waitForServiceReady(9999, 5000);

      expect(isReady).toBe(true);
      expect(callCount).toBeGreaterThanOrEqual(3);

      quickChecker.destroy();
    });

    it("应该在超时时返回失败", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: "unhealthy",
          timestamp: Date.now(),
        }),
      });

      const isReady = await healthChecker.waitForServiceReady(9999, 500);

      expect(isReady).toBe(false);
    });
  });

  describe("重启验证", () => {
    it("应该通过时间戳验证服务重启", async () => {
      const oldTimestamp = Date.now() - 10000; // 10秒前
      const newTimestamp = Date.now(); // 现在

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: "healthy",
          timestamp: newTimestamp,
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const isRestarted = await healthChecker.verifyServiceRestart(
        oldTimestamp,
        9999
      );

      expect(isRestarted).toBe(true);
    });

    it("应该通过 uptime 验证服务重启", async () => {
      const oldTimestamp = Date.now() - 10000; // 10秒前
      const uptime = 5; // 5秒运行时间

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: "healthy",
          uptime: uptime,
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const isRestarted = await healthChecker.verifyServiceRestart(
        oldTimestamp,
        9999
      );

      expect(isRestarted).toBe(true);
    });

    it("应该在服务未重启时返回失败", async () => {
      const oldTimestamp = Date.now() - 1000; // 1秒前
      const olderTimestamp = Date.now() - 10000; // 10秒前（服务启动时间更早）

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: "healthy",
          timestamp: olderTimestamp,
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const isRestarted = await healthChecker.verifyServiceRestart(
        oldTimestamp,
        9999
      );

      expect(isRestarted).toBe(false);
    });

    it("应该在服务不健康时返回失败", async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: "unhealthy",
          timestamp: Date.now(),
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const isRestarted = await healthChecker.verifyServiceRestart(
        Date.now() - 1000,
        9999
      );

      expect(isRestarted).toBe(false);
    });
  });

  describe("批量检查", () => {
    it("应该能够批量检查多个端口", async () => {
      const ports = [9999, 8888, 7777];

      mockFetch.mockImplementation((url: string) => {
        const port = Number.parseInt(url.split(":")[2].split("/")[0]);
        const isHealthy = port !== 7777; // 7777 端口不健康

        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: isHealthy ? "healthy" : "unhealthy",
            port: port,
            timestamp: Date.now(),
          }),
        });
      });

      const results = await healthChecker.checkMultiplePorts(ports);

      expect(results.size).toBe(3);
      expect(results.get(9999)?.healthy).toBe(true);
      expect(results.get(8888)?.healthy).toBe(true);
      expect(results.get(7777)?.healthy).toBe(false);
    });

    it("应该正确处理批量检查中的错误", async () => {
      const ports = [9999, 8888];

      mockFetch.mockImplementation((url: string) => {
        const port = Number.parseInt(url.split(":")[2].split("/")[0]);
        if (port === 8888) {
          return Promise.reject(new Error("Network error"));
        }

        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: "healthy",
            port: port,
            timestamp: Date.now(),
          }),
        });
      });

      const results = await healthChecker.checkMultiplePorts(ports);

      expect(results.size).toBe(2);
      expect(results.get(9999)?.healthy).toBe(true);
      expect(results.get(8888)?.healthy).toBe(false);
      expect(results.get(8888)?.error).toContain("Network error");
    });
  });

  describe("缓存统计", () => {
    it("应该提供正确的缓存统计信息", async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: "healthy",
          timestamp: Date.now(),
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      // 检查几个端口
      await healthChecker.getHealthStatus(9999);
      await healthChecker.getHealthStatus(8888);

      const stats = healthChecker.getCacheStats();

      expect(stats.size).toBe(2);
      expect(stats.entries).toHaveLength(2);
      expect(
        stats.entries.some(
          (entry) => entry.port === 9999 && entry.healthy === true
        )
      ).toBe(true);
      expect(
        stats.entries.some(
          (entry) => entry.port === 8888 && entry.healthy === true
        )
      ).toBe(true);
    });
  });

  describe("URL 构建", () => {
    it("应该根据当前页面协议构建正确的 URL", async () => {
      // Mock window.location
      const originalLocation = window.location;
      (window as any).location = undefined;
      window.location = {
        protocol: "https:",
        hostname: "example.com",
      } as any;

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: "healthy",
          timestamp: Date.now(),
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      await healthChecker.getHealthStatus(9999);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com:9999/api/health",
        expect.any(Object)
      );

      // 恢复原始 location
      (window as any).location = originalLocation;
    });
  });

  describe("销毁功能", () => {
    it("应该能够正确销毁健康检查器", async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: "healthy",
          timestamp: Date.now(),
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      // 添加一些缓存
      await healthChecker.getHealthStatus(9999);
      expect(healthChecker.getCacheStats().size).toBe(1);

      // 销毁
      healthChecker.destroy();

      // 验证缓存被清除
      expect(healthChecker.getCacheStats().size).toBe(0);
    });
  });
});
