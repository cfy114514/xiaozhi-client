/**
 * 服务健康检查器
 * 负责检查服务的健康状态和重启验证
 */

/**
 * 健康检查结果接口
 */
export interface HealthCheckResult {
  /** 是否健康 */
  healthy: boolean;
  /** 检查时间戳 */
  timestamp: number;
  /** 服务启动时间 */
  uptime?: number;
  /** 端口号 */
  port?: number;
  /** 版本信息 */
  version?: string;
  /** 详细状态信息 */
  details?: Record<string, any>;
  /** 错误信息 */
  error?: string;
}

/**
 * 健康检查配置接口
 */
export interface HealthCheckConfig {
  /** 检查超时时间（毫秒） */
  timeout: number;
  /** 检查间隔（毫秒） */
  interval: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试间隔（毫秒） */
  retryInterval: number;
}

/**
 * 默认健康检查配置
 */
const DEFAULT_CONFIG: HealthCheckConfig = {
  timeout: 5000,
  interval: 1000,
  maxRetries: 30,
  retryInterval: 1000,
};

/**
 * 服务健康检查器类
 */
export class HealthChecker {
  private config: HealthCheckConfig;
  private checkCache: Map<
    string,
    { result: HealthCheckResult; expiry: number }
  > = new Map();
  private readonly CACHE_TTL = 2000; // 缓存有效期 2 秒

  constructor(config: Partial<HealthCheckConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 检查服务健康状态
   */
  async checkServiceHealth(port: number): Promise<boolean> {
    try {
      const result = await this.getHealthStatus(port);
      return result.healthy;
    } catch (error) {
      console.error(`[HealthChecker] 健康检查失败 (端口 ${port}):`, error);
      return false;
    }
  }

  /**
   * 获取详细的健康状态信息
   */
  async getHealthStatus(port: number): Promise<HealthCheckResult> {
    const cacheKey = `health_${port}`;

    // 检查缓存
    const cached = this.checkCache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) {
      console.log(`[HealthChecker] 使用缓存的健康检查结果 (端口 ${port})`);
      return cached.result;
    }

    try {
      const url = this.buildHealthUrl(port);
      console.log(`[HealthChecker] 检查服务健康状态: ${url}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.timeout
      );

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      let result: HealthCheckResult;

      if (response.ok) {
        const data = await response.json();
        result = {
          healthy: data.status === "healthy",
          timestamp: data.timestamp || Date.now(),
          uptime: data.uptime,
          port: data.port || port,
          version: data.version,
          details: data,
          error: data.status !== "healthy" ? data.error : undefined,
        };
      } else {
        result = {
          healthy: false,
          timestamp: Date.now(),
          port,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      // 缓存结果
      this.checkCache.set(cacheKey, {
        result,
        expiry: Date.now() + this.CACHE_TTL,
      });

      console.log(
        `[HealthChecker] 健康检查完成 (端口 ${port}): ${result.healthy ? "健康" : "不健康"}`
      );
      return result;
    } catch (error) {
      const result: HealthCheckResult = {
        healthy: false,
        timestamp: Date.now(),
        port,
        error: error instanceof Error ? error.message : String(error),
      };

      // 缓存失败结果（较短时间）
      this.checkCache.set(cacheKey, {
        result,
        expiry: Date.now() + 500, // 失败结果只缓存 500ms
      });

      return result;
    }
  }

  /**
   * 等待服务准备就绪
   */
  async waitForServiceReady(port: number, timeout?: number): Promise<boolean> {
    const actualTimeout =
      timeout || this.config.maxRetries * this.config.retryInterval;
    const startTime = Date.now();
    let attempt = 0;

    console.log(
      `[HealthChecker] 等待服务准备就绪 (端口 ${port}), 超时: ${actualTimeout}ms`
    );

    while (Date.now() - startTime < actualTimeout) {
      attempt++;

      try {
        const isHealthy = await this.checkServiceHealth(port);

        if (isHealthy) {
          console.log(
            `[HealthChecker] 服务已准备就绪 (端口 ${port}), 尝试次数: ${attempt}`
          );
          return true;
        }

        console.log(
          `[HealthChecker] 服务未就绪 (端口 ${port}), 尝试 ${attempt}, 等待 ${this.config.retryInterval}ms 后重试`
        );

        // 等待后重试
        await this.delay(this.config.retryInterval);
      } catch (error) {
        console.log(
          `[HealthChecker] 健康检查异常 (端口 ${port}), 尝试 ${attempt}:`,
          error
        );
        await this.delay(this.config.retryInterval);
      }
    }

    console.error(
      `[HealthChecker] 等待服务就绪超时 (端口 ${port}), 总时间: ${Date.now() - startTime}ms`
    );
    return false;
  }

  /**
   * 验证服务是否已重启
   * 通过比较服务启动时间来判断
   */
  async verifyServiceRestart(
    oldTimestamp: number,
    port: number
  ): Promise<boolean> {
    try {
      console.log(
        `[HealthChecker] 验证服务重启 (端口 ${port}), 基准时间: ${new Date(oldTimestamp).toISOString()}`
      );

      const healthStatus = await this.getHealthStatus(port);

      if (!healthStatus.healthy) {
        console.log(`[HealthChecker] 服务不健康，重启验证失败 (端口 ${port})`);
        return false;
      }

      // 检查服务启动时间
      if (healthStatus.timestamp && healthStatus.timestamp > oldTimestamp) {
        console.log(
          `[HealthChecker] 服务重启验证成功 (端口 ${port}), 新启动时间: ${new Date(healthStatus.timestamp).toISOString()}`
        );
        return true;
      }

      // 如果没有时间戳信息，检查 uptime
      if (healthStatus.uptime !== undefined) {
        const estimatedStartTime = Date.now() - healthStatus.uptime * 1000;
        if (estimatedStartTime > oldTimestamp) {
          console.log(
            `[HealthChecker] 通过 uptime 验证服务重启成功 (端口 ${port})`
          );
          return true;
        }
      }

      console.log(
        `[HealthChecker] 服务重启验证失败 (端口 ${port}), 服务可能未重启`
      );
      return false;
    } catch (error) {
      console.error(`[HealthChecker] 服务重启验证异常 (端口 ${port}):`, error);
      return false;
    }
  }

  /**
   * 批量检查多个端口的健康状态
   */
  async checkMultiplePorts(
    ports: number[]
  ): Promise<Map<number, HealthCheckResult>> {
    console.log(`[HealthChecker] 批量检查端口健康状态: ${ports.join(", ")}`);

    const results = new Map<number, HealthCheckResult>();

    // 并发检查所有端口
    const promises = ports.map(async (port) => {
      try {
        const result = await this.getHealthStatus(port);
        results.set(port, result);
      } catch (error) {
        results.set(port, {
          healthy: false,
          timestamp: Date.now(),
          port,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    await Promise.all(promises);

    console.log(
      `[HealthChecker] 批量检查完成, 健康端口: ${Array.from(results.entries())
        .filter(([, result]) => result.healthy)
        .map(([port]) => port)
        .join(", ")}`
    );

    return results;
  }

  /**
   * 清除缓存
   */
  clearCache(port?: number): void {
    if (port) {
      const cacheKey = `health_${port}`;
      this.checkCache.delete(cacheKey);
      console.log(`[HealthChecker] 已清除端口 ${port} 的健康检查缓存`);
    } else {
      this.checkCache.clear();
      console.log("[HealthChecker] 已清除所有健康检查缓存");
    }
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats(): {
    size: number;
    entries: Array<{ port: number; healthy: boolean; expiry: number }>;
  } {
    const entries = Array.from(this.checkCache.entries()).map(
      ([_key, { result, expiry }]) => ({
        port: result.port || 0,
        healthy: result.healthy,
        expiry,
      })
    );

    return {
      size: this.checkCache.size,
      entries,
    };
  }

  /**
   * 构建健康检查 URL
   */
  private buildHealthUrl(port: number): string {
    // 根据当前页面协议构建 URL
    const protocol = window.location.protocol;
    const hostname = window.location.hostname || "localhost";

    return `${protocol}//${hostname}:${port}/api/health`;
  }

  /**
   * 延迟工具方法
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 销毁健康检查器
   */
  destroy(): void {
    this.clearCache();
    console.log("[HealthChecker] 健康检查器已销毁");
  }
}
