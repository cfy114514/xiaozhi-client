import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Logger } from "../../logger.js";
import { LogContext } from "../../logger/LogContext.js";
import { PerformanceIntegration } from "../../logger/PerformanceIntegration.js";
import { PinoConfigManager } from "../../logger/PinoConfig.js";
import { PinoSampler } from "../../logger/PinoSampler.js";

interface MemorySnapshot {
  timestamp: number;
  memory: NodeJS.MemoryUsage;
  heapStatistics?: any;
}

interface ResourceUsageMetrics {
  memoryLeakDetected: boolean;
  memoryGrowthRate: number; // MB per minute
  peakMemoryUsage: number; // MB
  averageMemoryUsage: number; // MB
  memorySnapshots: MemorySnapshot[];
  gcStats?: {
    collections: number;
    totalTime: number;
  };
}

class MemoryResourceTester {
  private memorySnapshots: MemorySnapshot[] = [];
  private isMonitoring = false;
  private monitoringInterval?: NodeJS.Timeout;

  async runMemoryLeakTest(
    testName: string,
    duration: number,
    operationsPerSecond: number,
    usePino = true
  ): Promise<ResourceUsageMetrics> {
    console.log(`\n🧪 内存泄漏测试: ${testName}`);
    console.log(
      `  持续时间: ${duration}ms, 操作频率: ${operationsPerSecond} ops/sec`
    );

    this.setupEnvironment(usePino);
    this.startMemoryMonitoring();

    const logger = new Logger().withTag("MEMORY-TEST");
    const logContext = LogContext.getInstance();
    const performanceIntegration = PerformanceIntegration.getInstance();

    let operationCount = 0;
    const startTime = Date.now();
    const interval = 1000 / operationsPerSecond;

    // 强制垃圾回收（如果可用）
    if (global.gc) {
      global.gc();
    }

    const testPromise = new Promise<void>((resolve) => {
      const operationTimer = setInterval(async () => {
        const currentTime = Date.now();
        if (currentTime - startTime >= duration) {
          clearInterval(operationTimer);
          resolve();
          return;
        }

        try {
          await this.performMemoryTestOperation(
            logger,
            logContext,
            performanceIntegration,
            operationCount++
          );
        } catch (error) {
          console.warn(`Operation ${operationCount} failed:`, error);
        }
      }, interval);
    });

    await testPromise;

    this.stopMemoryMonitoring();

    // 强制垃圾回收
    if (global.gc) {
      global.gc();
      // 等待GC完成
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return this.analyzeMemoryUsage();
  }

  private setupEnvironment(usePino: boolean): void {
    process.env.XIAOZHI_USE_PINO = usePino.toString();
    process.env.XIAOZHI_LOG_LEVEL = "info";
    process.env.XIAOZHI_LOG_ASYNC = "true";
    process.env.XIAOZHI_LOG_BUFFER_SIZE = "16384";
    process.env.XIAOZHI_LOG_SAMPLING_RATE = "1.0";
    process.env.XIAOZHI_DAEMON = "false";
    process.env.XIAOZHI_LOG_CONTEXT_ENABLED = "true";

    const configManager = PinoConfigManager.getInstance();
    configManager.reloadFromEnvironment();
  }

  private startMemoryMonitoring(): void {
    this.memorySnapshots = [];
    this.isMonitoring = true;

    // 立即记录初始状态
    this.recordMemorySnapshot();

    // 每秒记录一次内存状态
    this.monitoringInterval = setInterval(() => {
      if (this.isMonitoring) {
        this.recordMemorySnapshot();
      }
    }, 1000);
  }

  private stopMemoryMonitoring(): void {
    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    // 记录最终状态
    this.recordMemorySnapshot();
  }

  private recordMemorySnapshot(): void {
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      memory: process.memoryUsage(),
    };

    // 如果可用，记录堆统计信息
    if (typeof (process as any).memoryUsage.rss === "function") {
      try {
        snapshot.heapStatistics = (process as any).memoryUsage();
      } catch (error) {
        // 忽略错误
      }
    }

    this.memorySnapshots.push(snapshot);
  }

  private async performMemoryTestOperation(
    logger: Logger,
    logContext: LogContext,
    performanceIntegration: PerformanceIntegration,
    operationId: number
  ): Promise<void> {
    // 创建一些临时对象来模拟真实使用场景
    const largeData = {
      id: operationId,
      timestamp: new Date(),
      payload: new Array(100).fill(0).map((_, i) => ({
        index: i,
        value: Math.random(),
        data: `test-data-${operationId}-${i}`,
      })),
      metadata: {
        source: "memory-test",
        version: "1.0.0",
        operation: operationId,
      },
    };

    // 使用上下文追踪
    const context = logContext.createContextFromHeaders({
      "x-trace-id": `memory-test-${operationId}`,
      "x-user-id": `user-${operationId % 100}`,
    });

    await logContext.runAsync(context, async () => {
      // 性能监控
      const timerId = performanceIntegration.startTiming(
        "memory-test",
        "test-operation"
      );

      try {
        // 记录不同类型的日志
        logger.info("Memory test operation", largeData);

        if (operationId % 10 === 0) {
          logger.warn("Warning message", { operationId, type: "warning" });
        }

        if (operationId % 50 === 0) {
          logger.error("Error message", {
            operationId,
            type: "error",
            errorData: largeData,
          });
        }

        if (operationId % 25 === 0) {
          logger.success("Success message", { operationId, result: largeData });
        }

        // 模拟一些异步操作
        await new Promise((resolve) => setTimeout(resolve, 1));
      } finally {
        performanceIntegration.endTiming(timerId, true);
      }
    });

    // 创建一些临时的采样器实例来测试资源清理
    if (operationId % 100 === 0) {
      const sampler = new PinoSampler({
        globalSamplingRate: 0.5,
        duplicateSuppressionEnabled: true,
      });

      // 使用采样器
      for (let i = 0; i < 10; i++) {
        sampler.shouldSample("info", `Test message ${i}`);
      }

      // 清理采样器
      sampler.destroy();
    }
  }

  private analyzeMemoryUsage(): ResourceUsageMetrics {
    if (this.memorySnapshots.length < 2) {
      throw new Error("Insufficient memory snapshots for analysis");
    }

    const firstSnapshot = this.memorySnapshots[0];
    const lastSnapshot = this.memorySnapshots[this.memorySnapshots.length - 1];
    const durationMinutes =
      (lastSnapshot.timestamp - firstSnapshot.timestamp) / 60000;

    // 计算内存增长率
    const memoryGrowthMB =
      (lastSnapshot.memory.heapUsed - firstSnapshot.memory.heapUsed) /
      1024 /
      1024;
    const memoryGrowthRate =
      durationMinutes > 0 ? memoryGrowthMB / durationMinutes : 0;

    // 计算峰值和平均内存使用
    const heapUsages = this.memorySnapshots.map((s) => s.memory.heapUsed);
    const peakMemoryUsage = Math.max(...heapUsages) / 1024 / 1024;
    const averageMemoryUsage =
      heapUsages.reduce((a, b) => a + b, 0) / heapUsages.length / 1024 / 1024;

    // 检测内存泄漏
    const memoryLeakDetected = this.detectMemoryLeak();

    return {
      memoryLeakDetected,
      memoryGrowthRate,
      peakMemoryUsage,
      averageMemoryUsage,
      memorySnapshots: this.memorySnapshots,
    };
  }

  private detectMemoryLeak(): boolean {
    if (this.memorySnapshots.length < 10) {
      return false; // 数据不足，无法判断
    }

    // 分析内存使用趋势
    const samples = this.memorySnapshots.slice(-10); // 取最后10个样本
    const heapUsages = samples.map((s) => s.memory.heapUsed);

    // 计算线性回归斜率
    const n = heapUsages.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = heapUsages.reduce((a, b) => a + b, 0);
    const sumXY = heapUsages.reduce((sum, y, x) => sum + x * y, 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

    // 如果斜率持续为正且超过阈值，可能存在内存泄漏
    const leakThreshold = 1024 * 1024; // 1MB per sample
    return slope > leakThreshold;
  }

  generateMemoryReport(results: Map<string, ResourceUsageMetrics>): string {
    let report = "\n=== 内存和资源使用验证报告 ===\n\n";

    for (const [testName, metrics] of results.entries()) {
      report += `📊 ${testName}:\n`;
      report += `  内存泄漏检测: ${metrics.memoryLeakDetected ? "❌ 检测到泄漏" : "✅ 无泄漏"}\n`;
      report += `  内存增长率: ${metrics.memoryGrowthRate.toFixed(2)} MB/分钟\n`;
      report += `  峰值内存使用: ${metrics.peakMemoryUsage.toFixed(2)} MB\n`;
      report += `  平均内存使用: ${metrics.averageMemoryUsage.toFixed(2)} MB\n`;

      // 内存使用评估
      if (metrics.memoryGrowthRate < 1) {
        report += "  ✅ 内存增长率正常\n";
      } else if (metrics.memoryGrowthRate < 5) {
        report += "  ⚠️  内存增长率偏高\n";
      } else {
        report += "  ❌ 内存增长率过高\n";
      }

      if (metrics.peakMemoryUsage < 200) {
        report += "  ✅ 峰值内存使用合理\n";
      } else if (metrics.peakMemoryUsage < 500) {
        report += "  ⚠️  峰值内存使用偏高\n";
      } else {
        report += "  ❌ 峰值内存使用过高\n";
      }

      report += "\n";
    }

    // 总体建议
    report += "💡 优化建议:\n\n";

    const hasMemoryLeaks = Array.from(results.values()).some(
      (m) => m.memoryLeakDetected
    );
    const avgGrowthRate =
      Array.from(results.values()).reduce(
        (sum, m) => sum + m.memoryGrowthRate,
        0
      ) / results.size;

    if (hasMemoryLeaks) {
      report += "  ❌ 检测到内存泄漏，建议:\n";
      report += "    - 检查事件监听器是否正确移除\n";
      report += "    - 验证定时器是否正确清理\n";
      report += "    - 检查异步操作的资源释放\n";
    } else {
      report += "  ✅ 未检测到明显的内存泄漏\n";
    }

    if (avgGrowthRate > 2) {
      report += `  ⚠️  平均内存增长率较高 (${avgGrowthRate.toFixed(2)} MB/分钟)，建议:\n`;
      report += "    - 启用采样机制降低内存使用\n";
      report += "    - 调整缓冲区大小\n";
      report += "    - 考虑使用更激进的垃圾回收策略\n";
    }

    report += "\n📋 推荐的生产环境内存配置:\n";
    report += "  - Node.js 堆内存限制: --max-old-space-size=2048\n";
    report += "  - 启用采样: XIAOZHI_LOG_SAMPLING_RATE=0.8\n";
    report += "  - 合理的缓冲区: XIAOZHI_LOG_BUFFER_SIZE=16384\n";
    report += "  - 定期监控内存使用情况\n\n";

    return report;
  }
}

describe("内存和资源使用验证", () => {
  let tester: MemoryResourceTester;
  const results = new Map<string, ResourceUsageMetrics>();

  beforeEach(() => {
    tester = new MemoryResourceTester();
  });

  afterEach(() => {
    // 清理
  });

  it("应该验证基础日志记录的内存使用", async () => {
    const metrics = await tester.runMemoryLeakTest(
      "基础日志记录",
      60000, // 1分钟
      50, // 50 ops/sec
      true
    );

    results.set("基础日志记录", metrics);

    // 验证内存使用合理
    expect(metrics.memoryLeakDetected).toBe(false);
    expect(metrics.memoryGrowthRate).toBeLessThan(10); // 每分钟增长不超过10MB
    expect(metrics.peakMemoryUsage).toBeLessThan(300); // 峰值不超过300MB
  }, 90000);

  it("应该验证高频日志记录的内存稳定性", async () => {
    const metrics = await tester.runMemoryLeakTest(
      "高频日志记录",
      60000, // 1分钟
      200, // 200 ops/sec
      true
    );

    results.set("高频日志记录", metrics);

    expect(metrics.memoryLeakDetected).toBe(false);
    expect(metrics.memoryGrowthRate).toBeLessThan(20); // 高频下允许更高的增长率
  }, 90000);

  it("应该验证长时间运行的内存稳定性", async () => {
    const metrics = await tester.runMemoryLeakTest(
      "长时间运行",
      180000, // 3分钟
      30, // 30 ops/sec
      true
    );

    results.set("长时间运行", metrics);

    expect(metrics.memoryLeakDetected).toBe(false);
    expect(metrics.memoryGrowthRate).toBeLessThan(5); // 长时间运行应该更稳定

    // 生成最终报告
    const report = tester.generateMemoryReport(results);
    console.log(report);
  }, 240000); // 4分钟超时

  it("应该对比Pino与Console的内存使用", async () => {
    // 测试Console模式
    const consoleMetrics = await tester.runMemoryLeakTest(
      "Console模式",
      30000, // 30秒
      100, // 100 ops/sec
      false
    );

    // 测试Pino模式
    const pinoMetrics = await tester.runMemoryLeakTest(
      "Pino模式",
      30000, // 30秒
      100, // 100 ops/sec
      true
    );

    results.set("Console模式", consoleMetrics);
    results.set("Pino模式", pinoMetrics);

    // 对比分析
    const memoryDiff =
      pinoMetrics.peakMemoryUsage - consoleMetrics.peakMemoryUsage;
    console.log("\n📊 内存使用对比:");
    console.log(
      `  Console模式峰值: ${consoleMetrics.peakMemoryUsage.toFixed(2)} MB`
    );
    console.log(`  Pino模式峰值: ${pinoMetrics.peakMemoryUsage.toFixed(2)} MB`);
    console.log(`  差异: ${memoryDiff.toFixed(2)} MB`);

    // Pino的内存使用应该在合理范围内
    expect(Math.abs(memoryDiff)).toBeLessThan(100); // 差异不应超过100MB
  }, 120000);
});
