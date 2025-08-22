import { useCallback, useEffect, useRef, useState } from "react";
import { useWebSocketActions, useWebSocketStore } from "../stores/websocket";
import type { AppConfig, ClientStatus } from "../types";
import {
  buildWebSocketUrl,
  checkPortAvailability,
  extractPortFromUrl,
  pollPortUntilAvailable,
} from "../utils/portUtils";

// 重连配置常量
const RECONNECT_INTERVAL = 1000; // 重连间隔：1秒
const MAX_RECONNECT_ATTEMPTS = 30; // 最大重连次数：30次（30秒）
const CONNECTION_TIMEOUT = 5000; // 连接超时：5秒

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
  const socketRef = useRef<WebSocket | null>(null);
  const [wsUrl, setWsUrl] = useState<string>("");
  const statusCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 获取 zustand store 的 actions
  const storeActions = useWebSocketActions();

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

  const startStatusCheck = useCallback(
    (ws: WebSocket) => {
      // 清除之前的定时器
      stopStatusCheck();

      // 使用固定间隔的定时器
      const checkStatus = () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "getStatus" }));
        }
      };

      // 立即执行一次检查
      checkStatus();

      // 每秒检查一次状态
      statusCheckIntervalRef.current = setInterval(checkStatus, 1000);
    },
    [stopStatusCheck]
  );

  useEffect(() => {
    const url = getWebSocketUrl();
    setWsUrl(url);
    // 同步 URL 到 store
    syncToStore("wsUrl", url);

    const ws = new WebSocket(url);

    ws.onopen = () => {
      console.log(`[WebSocket] 连接已建立，URL: ${url}`);
      const newState = { connected: true };
      setState((prev) => ({ ...prev, ...newState }));
      // 同步连接状态到 store
      syncToStore("connected", true);

      console.log("[WebSocket] 发送初始请求: getConfig, getStatus");
      ws.send(JSON.stringify({ type: "getConfig" }));
      ws.send(JSON.stringify({ type: "getStatus" }));

      // 开始定期查询状态
      startStatusCheck(ws);
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
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
          break;
        default:
          console.log("[WebSocket] 未处理的消息类型:", message.type);
      }
    };

    ws.onclose = () => {
      console.log("[WebSocket] 连接已断开");
      setState((prev) => ({ ...prev, connected: false }));
      // 同步断开连接状态到 store
      syncToStore("connected", false);
      stopStatusCheck();
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    socketRef.current = ws;

    return () => {
      stopStatusCheck();
      ws.close();
    };
  }, [getWebSocketUrl, startStatusCheck, stopStatusCheck, syncToStore]);

  const updateConfig = useCallback(
    (config: AppConfig): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
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
                return response.json().then(() => {
                  // 通过 WebSocket 通知配置更新
                  socketRef.current?.send(
                    JSON.stringify({ type: "updateConfig", config })
                  );
                  resolve();
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
    [wsUrl]
  );

  const refreshStatus = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "getStatus" }));
    }
  }, []);

  // 重连函数 - 与 test-websocket.js 中的实现保持一致
  const attemptReconnect = useCallback(
    (targetUrl: string): Promise<WebSocket> => {
      console.log("[WebSocket] 🔄 开始重连流程...");
      let reconnectAttempts = 0;

      return new Promise((resolve, reject) => {
        const reconnectInterval = setInterval(async () => {
          reconnectAttempts++;
          console.log(
            `[WebSocket] 🔄 正在尝试重连... 第 ${reconnectAttempts} 次`
          );

          if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
            clearInterval(reconnectInterval);
            console.error(
              `[WebSocket] ❌ 重连失败：已达到最大重连次数 (${MAX_RECONNECT_ATTEMPTS})`
            );
            reject(
              new Error(
                `重连失败：已达到最大重连次数 (${MAX_RECONNECT_ATTEMPTS})`
              )
            );
            return;
          }

          try {
            const newWs = new WebSocket(targetUrl);

            // 设置连接超时
            const connectionTimeout = setTimeout(() => {
              newWs.close();
              console.warn(`[WebSocket] ⚠️  第 ${reconnectAttempts} 次重连超时`);
            }, CONNECTION_TIMEOUT);

            newWs.onopen = () => {
              clearTimeout(connectionTimeout);
              clearInterval(reconnectInterval);
              console.log("[WebSocket] ✅ 重启成功，连接已恢复");

              // 设置新连接的事件处理
              setupWebSocketHandlers(newWs);

              resolve(newWs);
            };

            newWs.onerror = (error) => {
              clearTimeout(connectionTimeout);
              console.warn(
                `[WebSocket] ⚠️  第 ${reconnectAttempts} 次重连失败:`,
                error
              );
              // 继续尝试，不要reject
            };

            newWs.onclose = () => {
              clearTimeout(connectionTimeout);
              // 连接被关闭，继续尝试
            };
          } catch (error) {
            console.warn(
              `[WebSocket] ⚠️  第 ${reconnectAttempts} 次重连出现异常:`,
              error
            );
            // 继续尝试，不要reject
          }
        }, RECONNECT_INTERVAL);
      });
    },
    []
  );

  // WebSocket 事件处理设置函数
  const setupWebSocketHandlers = useCallback(
    (ws: WebSocket) => {
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        console.log("[WebSocket] 收到消息:", message);

        switch (message.type) {
          case "config":
          case "configUpdate":
            console.log("[WebSocket] 处理 config 更新:", message.data);
            setState((prev) => ({ ...prev, config: message.data }));
            syncToStore("config", message.data);
            break;
          case "status":
          case "statusUpdate": {
            console.log("[WebSocket] 处理 status 更新:", message.data);
            const statusData = message.data;
            if (statusData && typeof statusData === "object") {
              setState((prev) => ({ ...prev, status: statusData }));
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
            syncToStore("restartStatus", message.data);
            break;
          default:
            console.log("[WebSocket] 未处理的消息类型:", message.type);
        }
      };

      ws.onclose = () => {
        console.log("[WebSocket] 连接已断开");
        setState((prev) => ({ ...prev, connected: false }));
        syncToStore("connected", false);
        stopStatusCheck();
      };

      ws.onerror = (error) => {
        console.error("[WebSocket] WebSocket error:", error);
      };

      // 更新连接状态
      setState((prev) => ({ ...prev, connected: true }));
      syncToStore("connected", true);

      // 发送初始请求
      console.log("[WebSocket] 发送初始请求: getConfig, getStatus");
      ws.send(JSON.stringify({ type: "getConfig" }));
      ws.send(JSON.stringify({ type: "getStatus" }));

      // 开始定期查询状态
      startStatusCheck(ws);
    },
    [syncToStore, stopStatusCheck, startStatusCheck]
  );

  const restartService = useCallback(async (): Promise<void> => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      console.log("[WebSocket] 发送重启请求");

      // 发送重启请求
      socketRef.current.send(JSON.stringify({ type: "restartService" }));

      // 立即开始重连流程 - 与 test-websocket.js 保持一致
      console.log("[WebSocket] ⏳ 等待服务重启...");
      await new Promise((resolve) => setTimeout(resolve, 2000)); // 等待2秒让服务有时间重启

      try {
        // 尝试重新建立连接
        const newWs = await attemptReconnect(wsUrl);

        // 更新 socketRef 为新的连接
        socketRef.current = newWs;

        // 重连成功后，可以继续进行其他操作
        console.log("[WebSocket] 🎉 重连测试完成，服务已成功重启并重新连接");

        // 可选：发送一个测试消息验证连接
        console.log("[WebSocket] 🔍 验证重连后的连接状态...");
        newWs.send(JSON.stringify({ type: "getConfig" }));
      } catch (reconnectError) {
        console.error("[WebSocket] 💥 重连失败", reconnectError);
        throw reconnectError;
      }
    } else {
      throw new Error("WebSocket 未连接");
    }
  }, [attemptReconnect, wsUrl]);

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
