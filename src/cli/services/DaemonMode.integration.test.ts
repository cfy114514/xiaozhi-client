import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceStartOptions } from "../interfaces/Service.js";
import { PathUtils } from "../utils/PathUtils.js";
import { ProcessManager } from "./ProcessManager.js";
import { ServiceManagerImpl } from "./ServiceManager.js";

// Mock external dependencies
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    createWriteStream: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));

vi.mock("../utils/PathUtils.js", () => ({
  PathUtils: {
    getWebServerStandalonePath: vi.fn(),
    getExecutablePath: vi.fn(),
    getConfigDir: vi.fn(),
    getLogFile: vi.fn(),
    getMcpServerProxyPath: vi.fn(),
  },
}));

// Mock process.exit
const mockProcessExit = vi.spyOn(process, "exit").mockImplementation(() => {
  throw new Error("process.exit called");
});

// Mock console methods
const mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

describe("Daemon 模式集成测试", () => {
  let serviceManager: ServiceManagerImpl;
  let mockProcessManager: any;

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();
    mockProcessExit.mockClear();
    mockConsoleLog.mockClear();

    // Setup PathUtils mocks
    vi.mocked(PathUtils.getWebServerStandalonePath).mockReturnValue(
      "/test/WebServerStandalone.js"
    );
    vi.mocked(PathUtils.getExecutablePath).mockReturnValue("/test/cli.js");
    vi.mocked(PathUtils.getConfigDir).mockReturnValue("/test/config");
    vi.mocked(PathUtils.getLogFile).mockReturnValue("/test/logs/xiaozhi.log");

    // Setup fs mocks
    const fs = await import("node:fs");
    vi.mocked(fs.default.existsSync).mockReturnValue(true);

    // Setup ProcessManager mock
    mockProcessManager = {
      savePidInfo: vi.fn(),
      cleanupPidFile: vi.fn(),
      isServiceRunning: vi.fn().mockReturnValue(false),
      getServiceStatus: vi.fn(),
      stopService: vi.fn(),
    };

    serviceManager = new ServiceManagerImpl(
      mockProcessManager,
      {} as any,
      {} as any
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("WebServer Daemon 模式", () => {
    it("应完成完整的 daemon 启动工作流程", async () => {
      const { spawn } = await import("node:child_process");
      const mockSpawn = vi.mocked(spawn);

      const mockChild = {
        pid: 12345,
        unref: vi.fn(),
        stdout: null,
        stderr: null,
      };
      mockSpawn.mockReturnValue(mockChild as any);

      const options: ServiceStartOptions = {
        daemon: true,
        ui: false,
        mode: "web-server",
        port: 3000,
      };

      // Execute daemon start
      await expect(serviceManager.start(options)).rejects.toThrow(
        "process.exit called"
      );

      // Verify complete workflow
      expect(PathUtils.getWebServerStandalonePath).toHaveBeenCalled();
      expect(mockSpawn).toHaveBeenCalledWith(
        "node",
        ["/test/WebServerStandalone.js"],
        {
          detached: true,
          stdio: ["ignore", "ignore", "ignore"],
          env: expect.objectContaining({
            XIAOZHI_CONFIG_DIR: "/test/config",
            XIAOZHI_DAEMON: "true",
          }),
        }
      );
      expect(mockProcessManager.savePidInfo).toHaveBeenCalledWith(
        12345,
        "daemon"
      );
      expect(mockChild.unref).toHaveBeenCalled();
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "✅ 后台服务已启动 (PID: 12345)"
      );
      expect(mockProcessExit).toHaveBeenCalledWith(0);
    });

    it("应处理带浏览器选项的 daemon 启动", async () => {
      const { spawn } = await import("node:child_process");
      const mockSpawn = vi.mocked(spawn);

      const mockChild = {
        pid: 12346,
        unref: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockChild as any);

      const options: ServiceStartOptions = {
        daemon: true,
        ui: true,
        mode: "web-server",
        port: 3000,
      };

      await expect(serviceManager.start(options)).rejects.toThrow(
        "process.exit called"
      );

      expect(mockSpawn).toHaveBeenCalledWith(
        "node",
        ["/test/WebServerStandalone.js", "--open-browser"],
        {
          detached: true,
          stdio: ["ignore", "ignore", "ignore"],
          env: expect.objectContaining({
            XIAOZHI_CONFIG_DIR: "/test/config",
            XIAOZHI_DAEMON: "true",
          }),
        }
      );
    });
  });

  describe("MCP Server Daemon 模式", () => {
    it("应完成完整的 MCP daemon 启动工作流程", async () => {
      const { spawn } = await import("node:child_process");
      const mockSpawn = vi.mocked(spawn);

      const mockChild = {
        pid: 54321,
        unref: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockChild as any);

      const options: ServiceStartOptions = {
        daemon: true,
        mode: "mcp-server",
        port: 4000,
      };

      await expect(serviceManager.start(options)).rejects.toThrow(
        "process.exit called"
      );

      expect(mockSpawn).toHaveBeenCalledWith(
        "node",
        ["/test/cli.js", "start", "--server", "4000"],
        {
          detached: true,
          stdio: ["ignore", "ignore", "ignore"],
          env: expect.objectContaining({
            XIAOZHI_CONFIG_DIR: "/test/config",
            XIAOZHI_DAEMON: "true",
            MCP_SERVER_MODE: "true",
          }),
        }
      );
      expect(mockProcessManager.savePidInfo).toHaveBeenCalledWith(
        54321,
        "daemon"
      );
      expect(mockChild.unref).toHaveBeenCalled();
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "✅ MCP Server 已在后台启动 (PID: 54321, Port: 4000)"
      );
      expect(mockProcessExit).toHaveBeenCalledWith(0);
    });
  });

  describe("错误处理", () => {
    it("应处理缺失的 WebServer 文件", async () => {
      const fs = require("node:fs");
      vi.mocked(fs.default.existsSync).mockReturnValue(false);

      const options: ServiceStartOptions = {
        daemon: true,
        mode: "web-server",
        port: 3000,
      };

      await expect(serviceManager.start(options)).rejects.toThrow(
        "WebServer 文件不存在: /test/WebServerStandalone.js"
      );

      // Should not attempt to spawn or exit
      expect(mockProcessExit).not.toHaveBeenCalled();
    });

    it("应处理 spawn 错误", async () => {
      const { spawn } = await import("node:child_process");
      const mockSpawn = vi.mocked(spawn);

      mockSpawn.mockImplementation(() => {
        throw new Error("Spawn failed");
      });

      const options: ServiceStartOptions = {
        daemon: true,
        mode: "web-server",
        port: 3000,
      };

      await expect(serviceManager.start(options)).rejects.toThrow(
        "Spawn failed"
      );
      expect(mockProcessExit).not.toHaveBeenCalled();
    });
  });

  describe("进程分离", () => {
    it("应确保完全的进程分离", async () => {
      const { spawn } = await import("node:child_process");
      const mockSpawn = vi.mocked(spawn);

      const mockChild = {
        pid: 99999,
        unref: vi.fn(),
        stdout: { pipe: vi.fn() },
        stderr: { pipe: vi.fn() },
      };
      mockSpawn.mockReturnValue(mockChild as any);

      const options: ServiceStartOptions = {
        daemon: true,
        mode: "web-server",
        port: 3000,
      };

      await expect(serviceManager.start(options)).rejects.toThrow(
        "process.exit called"
      );

      // Verify stdio is completely ignored (no piping)
      expect(mockChild.stdout.pipe).not.toHaveBeenCalled();
      expect(mockChild.stderr.pipe).not.toHaveBeenCalled();

      // Verify process is detached and unreferenced
      const spawnCall = mockSpawn.mock.calls[0];
      expect(spawnCall[2]).toEqual(
        expect.objectContaining({
          detached: true,
          stdio: ["ignore", "ignore", "ignore"],
        })
      );
      expect(mockChild.unref).toHaveBeenCalled();

      // Verify parent process exits immediately
      expect(mockProcessExit).toHaveBeenCalledWith(0);
    });
  });
});
