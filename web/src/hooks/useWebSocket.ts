import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getConnectionManager } from "../services/ConnectionManagerSingleton";
import { useWebSocketActions, useWebSocketStore } from "../stores/websocket";
import type { AppConfig, ClientStatus } from "../types";
import {
  buildWebSocketUrl,
  checkPortAvailability,
  extractPortFromUrl,
  pollPortUntilAvailable,
} from "../utils/portUtils";

interface WebSocketState {
  connected: boolean;
  config: AppConfig | null;
  status: ClientStatus | null;
  restartStatus?: {
    status: "restarting" | "completed" | "failed";
    error?: string;
    timestamp: number;
  };
}

export function useWebSocket() {
  const [state, setState] = useState<WebSocketState>({
    connected: false,
    config: null,
    status: null,
  });
  const [wsUrl, setWsUrl] = useState<string>("");
  const statusCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 获取 zustand store 的 actions
  const storeActions = useWebSocketActions();

  // 获取 ConnectionManager 单例实例
  const connectionManager = useMemo(() => {
    return getConnectionManager({
      connectTimeout: 10000,
      maxReconnectAttempts: 5,
      reconnectInterval: 2000,
    });
  }, []);

  // 同步数据到 store 的辅助函数
  const syncToStore = useCallback(
    (key: string, value: any) => {
      console.log("[WebSocket] 同步到 store:", key, value);
      try {
        switch (key) {
          case "connected":
            storeActions.setConnected(value);
            console.log("[WebSocket] Store connected 已更新为:", value);
            break;
          case "config":
            storeActions.setConfig(value);
            console.log("[WebSocket] Store config 已更新");
            break;
          case "status":
            storeActions.setStatus(value);
            console.log("[WebSocket] Store status 已更新:", value);
            break;
          case "restartStatus":
            storeActions.setRestartStatus(value);
            console.log("[WebSocket] Store restartStatus 已更新");
            break;
          case "wsUrl":
            storeActions.setWsUrl(value);
            console.log("[WebSocket] Store wsUrl 已更新:", value);
            break;
          case "portChangeStatus":
            storeActions.setPortChangeStatus(value);
            console.log("[WebSocket] Store portChangeStatus 已更新:", value);
            break;
        }
      } catch (error) {
        console.error("Failed to sync to store:", error);
      }
    },
    [storeActions]
  );

  // 动态获取WebSocket连接地址
  const getWebSocketUrl = useCallback((configPort?: number) => {
    // 优先使用localStorage中保存的地址
    const savedUrl = localStorage.getItem("xiaozhi-ws-url");
    if (savedUrl) {
      return savedUrl;
    }

    // 确定要使用的端口号
    let targetPort = 9999; // 默认端口

    // 如果传入了配置端口，使用配置端口
    if (configPort) {
      targetPort = configPort;
    } else if (window.location.port) {
      // 如果当前页面有端口号，使用当前页面的端口号
      const currentPort = Number.parseInt(window.location.port);
      if (!Number.isNaN(currentPort)) {
        targetPort = currentPort;
      }
    } else if (window.location.protocol === "http:" && !window.location.port) {
      // 标准 HTTP 端口 (80)
      targetPort = 80;
    } else if (window.location.protocol === "https:" && !window.location.port) {
      // 标准 HTTPS 端口 (443)
      targetPort = 443;
    }
    // 注意：移除了对 state.config 的依赖，避免循环依赖

    // 构建 WebSocket URL
    return buildWebSocketUrl(targetPort);
  }, []); // 移除 state.config 依赖

  const stopStatusCheck = useCallback(() => {
    if (statusCheckIntervalRef.current) {
      clearInterval(statusCheckIntervalRef.current);
      statusCheckIntervalRef.current = null;
    }
  }, []);

  const startStatusCheck = useCallback(() => {
    // 清除之前的定时器
    stopStatusCheck();

    // 使用固定间隔的定时器
    const checkStatus = async () => {
      if (connectionManager.isConnected()) {
        try {
          await connectionManager.sendMessage(
            JSON.stringify({ type: "getStatus" })
          );
        } catch (error) {
          console.error("[WebSocket] 状态检查失败:", error);
        }
      }
    };

    // 立即执行一次检查
    checkStatus();

    // 每秒检查一次状态
    statusCheckIntervalRef.current = setInterval(checkStatus, 1000);
  }, [stopStatusCheck, connectionManager]);

  useEffect(() => {
    const url = getWebSocketUrl();
    setWsUrl(url);
    // 同步 URL 到 store
    syncToStore("wsUrl", url);

    // 使用 ConnectionManager 建立连接
    const port = extractPortFromUrl(url) || 9999;

    const connectToServer = async () => {
      try {
        await connectionManager.connect(port);
        console.log(`[WebSocket] 连接已建立，URL: ${url}`);

        const newState = { connected: true };
        setState((prev) => ({ ...prev, ...newState }));
        // 同步连接状态到 store
        syncToStore("connected", true);

        console.log("[WebSocket] 发送初始请求: getConfig, getStatus");
        await connectionManager.sendMessage(
          JSON.stringify({ type: "getConfig" })
        );
        await connectionManager.sendMessage(
          JSON.stringify({ type: "getStatus" })
        );

        // 开始定期查询状态
        startStatusCheck();
      } catch (error) {
        console.error("[WebSocket] 连接失败:", error);
        setState((prev) => ({ ...prev, connected: false }));
        syncToStore("connected", false);
      }
    };

    /**
     * 处理重启完成事件
     */
    const handleRestartCompleted = async (restartData: any) => {
      console.log("[WebSocket] 处理重启完成事件:", restartData);

      try {
        // 检查是否需要切换端口
        const targetPort = restartData.targetPort || port;

        if (targetPort !== port) {
          console.log(`[WebSocket] 检测到端口变更: ${port} -> ${targetPort}`);
          // 更新 URL 和端口
          const newUrl = buildWebSocketUrl(targetPort);
          setWsUrl(newUrl);
          syncToStore("wsUrl", newUrl);
        }

        // 等待一小段时间确保服务完全启动
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // 如果当前未连接，尝试重新连接
        if (!connectionManager.isConnected()) {
          console.log("[WebSocket] 重启完成后重新连接...");
          await connectionManager.connect(targetPort);

          if (connectionManager.isConnected()) {
            console.log("[WebSocket] 重启后重连成功");
            setState((prev) => ({ ...prev, connected: true }));
            syncToStore("connected", true);

            // 发送初始请求
            await connectionManager.sendMessage(
              JSON.stringify({ type: "getConfig" })
            );
            await connectionManager.sendMessage(
              JSON.stringify({ type: "getStatus" })
            );

            // 重新开始状态检查
            startStatusCheck();
          }
        } else {
          console.log("[WebSocket] 重启完成，连接已存在");
        }
      } catch (error) {
        console.error("[WebSocket] 处理重启完成事件失败:", error);
      }
    };

    // 设置消息处理器
    const handleMessage = (message: any) => {
      console.log("[WebSocket] 收到消息:", message);

      switch (message.type) {
        case "config":
        case "configUpdate":
          console.log("[WebSocket] 处理 config 更新:", message.data);
          setState((prev) => ({ ...prev, config: message.data }));
          // 同步 config 到 store
          syncToStore("config", message.data);
          break;
        case "status":
        case "statusUpdate": {
          console.log("[WebSocket] 处理 status 更新:", message.data);
          // 确保状态数据格式正确
          const statusData = message.data;
          if (statusData && typeof statusData === "object") {
            setState((prev) => ({ ...prev, status: statusData }));
            // 同步 status 到 store，使用 setTimeout 确保状态更新完成
            setTimeout(() => {
              syncToStore("status", statusData);
            }, 0);
          } else {
            console.warn("[WebSocket] 收到无效的 status 数据:", statusData);
          }
          break;
        }
        case "restartStatus":
          console.log("[WebSocket] 处理 restartStatus 更新:", message.data);
          setState((prev) => ({ ...prev, restartStatus: message.data }));
          // 同步 restartStatus 到 store
          syncToStore("restartStatus", message.data);

          // 如果重启完成，尝试重新连接
          if (message.data?.status === "completed") {
            console.log("[WebSocket] 检测到重启完成，准备重新连接...");
            handleRestartCompleted(message.data);
          }
          break;
        default:
          console.log("[WebSocket] 未处理的消息类型:", message.type);
      }
    };

    // 为不同类型的消息添加处理器
    connectionManager.addMessageHandler("config", handleMessage);
    connectionManager.addMessageHandler("configUpdate", handleMessage);
    connectionManager.addMessageHandler("status", handleMessage);
    connectionManager.addMessageHandler("statusUpdate", handleMessage);
    connectionManager.addMessageHandler("restartStatus", handleMessage);

    connectToServer();

    return () => {
      stopStatusCheck();
      // 注意：不销毁 connectionManager，因为它是单例
      // 只停止状态检查
    };
  }, [
    getWebSocketUrl,
    startStatusCheck,
    stopStatusCheck,
    syncToStore,
    connectionManager,
  ]);

  const updateConfig = useCallback(
    (config: AppConfig): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (connectionManager.isConnected()) {
          // 先通过 HTTP API 更新
          const apiUrl = `${wsUrl.replace(
            /^ws(s)?:\/\//,
            "http$1://"
          )}/api/config`;
          fetch(apiUrl, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(config),
          })
            .then((response) => {
              if (response.ok) {
                return response.json().then(async () => {
                  // 通过 WebSocket 通知配置更新
                  try {
                    await connectionManager.sendMessage(
                      JSON.stringify({ type: "updateConfig", config })
                    );
                    resolve();
                  } catch (error) {
                    reject(error);
                  }
                });
              }
              return response.text().then((text) => {
                reject(new Error(text || "保存配置失败"));
              });
            })
            .catch(reject);
        } else {
          reject(new Error("WebSocket 未连接"));
        }
      });
    },
    [wsUrl, connectionManager]
  );

  const refreshStatus = useCallback(async () => {
    if (connectionManager.isConnected()) {
      try {
        await connectionManager.sendMessage(
          JSON.stringify({ type: "getStatus" })
        );
      } catch (error) {
        console.error("[WebSocket] 刷新状态失败:", error);
      }
    }
  }, [connectionManager]);

  const restartService = useCallback((): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (connectionManager.isConnected()) {
        console.log("[WebSocket] 发送重启请求");

        // 发送重启请求
        connectionManager
          .sendMessage(JSON.stringify({ type: "restartService" }))
          .then(() => {
            // 由于服务重启会断开WebSocket连接，我们不能依赖WebSocket消息来确认重启状态
            // 改为等待一段时间，让服务有足够时间重启
            console.log("[WebSocket] 等待服务重启...");

            setTimeout(() => {
              console.log("[WebSocket] 服务重启等待时间结束，假设重启完成");
              resolve();
            }, 5000); // 等待5秒，给服务足够的重启时间
          })
          .catch(reject);
      } else {
        reject(new Error("WebSocket 未连接"));
      }
    });
  }, [connectionManager]);

  // 保存自定义WebSocket地址
  const setCustomWsUrl = useCallback((url: string) => {
    if (url) {
      localStorage.setItem("xiaozhi-ws-url", url);
    } else {
      localStorage.removeItem("xiaozhi-ws-url");
    }
    // 重新加载页面以应用新的连接地址
    window.location.reload();
  }, []);

  // 端口切换核心函数
  const changePort = useCallback(
    async (newPort: number): Promise<void> => {
      const currentPort = extractPortFromUrl(wsUrl) || 9999;

      // 如果端口号相同，直接返回
      if (currentPort === newPort) {
        return;
      }

      // 更新端口切换状态
      syncToStore("portChangeStatus", {
        status: "checking",
        targetPort: newPort,
        timestamp: Date.now(),
      });

      try {
        // 从 store 获取最新的连接状态
        const isConnected = useWebSocketStore.getState().connected;
        console.log(
          `[WebSocket] 开始端口切换到 ${newPort}，当前连接状态: ${isConnected}`
        );

        if (isConnected) {
          // 场景2：已连接状态 - 先更新配置，然后重启服务，最后轮询新端口
          console.log("[WebSocket] 执行已连接状态下的端口切换");
          await handleConnectedPortChange(newPort);
        } else {
          // 场景1：未连接状态 - 直接检测新端口并连接
          console.log("[WebSocket] 执行未连接状态下的端口切换");
          await handleDisconnectedPortChange(newPort);
        }

        // 成功完成端口切换
        console.log(`[WebSocket] 端口切换到 ${newPort} 成功完成`);
        syncToStore("portChangeStatus", {
          status: "completed",
          targetPort: newPort,
          timestamp: Date.now(),
        });
      } catch (error) {
        // 端口切换失败
        const errorMessage =
          error instanceof Error ? error.message : "端口切换失败";
        console.error(`[WebSocket] 端口切换到 ${newPort} 失败:`, errorMessage);

        syncToStore("portChangeStatus", {
          status: "failed",
          targetPort: newPort,
          error: errorMessage,
          timestamp: Date.now(),
        });
        throw error;
      }
    },
    [wsUrl, syncToStore]
  );

  // 处理已连接状态下的端口切换
  const handleConnectedPortChange = useCallback(
    async (newPort: number): Promise<void> => {
      // 从 store 获取最新的配置数据，而不是从内部 state
      const currentConfig = useWebSocketStore.getState().config;

      if (!currentConfig) {
        throw new Error("配置数据未加载，请刷新页面后重试");
      }

      console.log(
        `[WebSocket] 当前配置端口: ${currentConfig.webUI?.port}, 目标端口: ${newPort}`
      );

      // 1. 更新配置
      console.log("[WebSocket] 步骤1: 更新配置文件");
      const updatedConfig = {
        ...currentConfig,
        webUI: {
          ...currentConfig.webUI,
          port: newPort,
        },
      };

      try {
        await updateConfig(updatedConfig);
        console.log("[WebSocket] 配置文件更新成功");
      } catch (error) {
        throw new Error(
          `配置文件更新失败: ${
            error instanceof Error ? error.message : "未知错误"
          }`
        );
      }

      // 2. 发送重启请求
      console.log("[WebSocket] 步骤2: 重启服务");
      syncToStore("portChangeStatus", {
        status: "polling",
        targetPort: newPort,
        currentAttempt: 0,
        maxAttempts: 45,
        timestamp: Date.now(),
      });

      try {
        await restartService();
        console.log("[WebSocket] 服务重启请求已发送");
      } catch (error) {
        throw new Error(
          `服务重启失败: ${error instanceof Error ? error.message : "未知错误"}`
        );
      }

      // 3. 轮询新端口 - 增加重试次数和总超时时间
      console.log(`[WebSocket] 开始轮询新端口 ${newPort}`);
      const isAvailable = await pollPortUntilAvailable(
        newPort,
        45, // 增加到45次重试
        2000, // 保持2秒间隔
        (attempt, maxAttempts) => {
          console.log(`[WebSocket] 端口轮询进度: ${attempt}/${maxAttempts}`);
          syncToStore("portChangeStatus", {
            status: "polling",
            targetPort: newPort,
            currentAttempt: attempt,
            maxAttempts,
            timestamp: Date.now(),
          });
        }
      );

      if (!isAvailable) {
        throw new Error(
          `新端口 ${newPort} 在90秒超时时间内未可用，请检查服务是否正常启动`
        );
      }

      console.log(`[WebSocket] 新端口 ${newPort} 已可用`);

      // 4. 连接到新端口
      await connectToNewPort(newPort);
    },
    [updateConfig, restartService, syncToStore]
  );

  // 处理未连接状态下的端口切换
  const handleDisconnectedPortChange = useCallback(
    async (newPort: number): Promise<void> => {
      // 1. 检测新端口是否可用
      const isAvailable = await checkPortAvailability(newPort);

      if (!isAvailable) {
        throw new Error(`端口 ${newPort} 不可用，请检查服务端是否已启动`);
      }

      // 2. 连接到新端口
      await connectToNewPort(newPort);
    },
    []
  );

  // 连接到新端口
  const connectToNewPort = useCallback(
    async (newPort: number): Promise<void> => {
      console.log(`[WebSocket] 步骤4: 连接到新端口 ${newPort}`);

      syncToStore("portChangeStatus", {
        status: "connecting",
        targetPort: newPort,
        timestamp: Date.now(),
      });

      try {
        // 构建新的 WebSocket URL
        const newUrl = buildWebSocketUrl(newPort);
        console.log(`[WebSocket] 新的WebSocket URL: ${newUrl}`);

        // 保存新的 URL 到 localStorage
        localStorage.setItem("xiaozhi-ws-url", newUrl);
        console.log("[WebSocket] 新URL已保存到localStorage");

        // 重新加载页面以建立新连接
        console.log("[WebSocket] 重新加载页面以建立新连接");
        window.location.reload();
      } catch (error) {
        throw new Error(
          `连接到新端口失败: ${
            error instanceof Error ? error.message : "未知错误"
          }`
        );
      }
    },
    [syncToStore]
  );

  return {
    ...state,
    updateConfig,
    refreshStatus,
    restartService,
    wsUrl,
    setCustomWsUrl,
    changePort,
  };
}
