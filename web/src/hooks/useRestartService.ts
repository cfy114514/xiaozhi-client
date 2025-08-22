import { useCallback, useEffect, useMemo, useState } from "react";
import { getConnectionManager } from "../services/ConnectionManagerSingleton";
import { HealthChecker } from "../services/HealthChecker";
import {
  type RestartContext,
  RestartState,
  RestartStateMachine,
} from "../services/RestartStateMachine";

/**
 * 重启进度信息接口
 */
export interface RestartProgress {
  /** 进度百分比 (0-100) */
  percentage: number;
  /** 当前步骤描述 */
  message: string;
  /** 当前步骤编号 */
  currentStep: number;
  /** 总步骤数 */
  totalSteps: number;
}

/**
 * useRestartService Hook 返回值接口
 */
export interface UseRestartServiceReturn {
  /** 重启函数 */
  restart: (currentPort: number, targetPort?: number) => Promise<void>;
  /** 当前重启状态 */
  state: RestartState;
  /** 重启进度信息 */
  progress: RestartProgress | null;
  /** 错误信息 */
  error: Error | null;
  /** 重置状态函数 */
  reset: () => void;
  /** 是否正在重启中 */
  isRestarting: boolean;
}

/**
 * 重启服务 Hook
 *
 * 封装重启业务逻辑，集成状态机、连接管理器和健康检查器
 * 提供统一的重启接口和状态管理
 */
export function useRestartService(): UseRestartServiceReturn {
  const [state, setState] = useState<RestartState>(RestartState.IDLE);
  const [progress, setProgress] = useState<RestartProgress | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // 创建核心服务实例
  const services = useMemo(() => {
    const connectionManager = getConnectionManager({
      connectTimeout: 10000,
      maxReconnectAttempts: 5,
      reconnectInterval: 2000,
    });

    const healthChecker = new HealthChecker({
      timeout: 5000,
      interval: 1000,
    });

    const stateMachine = new RestartStateMachine(
      connectionManager,
      healthChecker
    );

    return { connectionManager, healthChecker, stateMachine };
  }, []);

  // 监听状态机状态变化
  useEffect(() => {
    const unsubscribe = services.stateMachine.onStateChange(
      (newState, context) => {
        console.log(`[useRestartService] 状态变化: ${state} -> ${newState}`);
        setState(newState);
        setProgress(calculateProgress(newState, context));
        setError(context?.error || null);
      }
    );

    return unsubscribe;
  }, [services.stateMachine, state]);

  // 重启函数
  const restart = useCallback(
    async (currentPort: number, targetPort?: number) => {
      console.log(
        `[useRestartService] 开始重启服务: ${currentPort} -> ${targetPort || currentPort}`
      );

      // 清除之前的错误状态
      setError(null);
      setProgress(null);

      try {
        await services.stateMachine.restart(currentPort, targetPort);
      } catch (error) {
        console.error("[useRestartService] 重启失败:", error);
        const restartError =
          error instanceof Error ? error : new Error("重启服务失败");
        setError(restartError);
        throw restartError;
      }
    },
    [services.stateMachine]
  );

  // 重置状态函数
  const reset = useCallback(() => {
    console.log("[useRestartService] 重置状态");
    services.stateMachine.reset();
    setState(RestartState.IDLE);
    setProgress(null);
    setError(null);
  }, [services.stateMachine]);

  // 计算是否正在重启中
  const isRestarting = useMemo(() => {
    return (
      state !== RestartState.IDLE &&
      state !== RestartState.COMPLETED &&
      state !== RestartState.FAILED
    );
  }, [state]);

  // 组件卸载时清理资源
  useEffect(() => {
    return () => {
      console.log("[useRestartService] 清理资源");
      // 注意：不销毁 connectionManager，因为它是单例
      // 只清理 healthChecker
      services.healthChecker.destroy();
    };
  }, [services]);

  return {
    restart,
    state,
    progress,
    error,
    reset,
    isRestarting,
  };
}

/**
 * 根据状态和上下文计算进度信息
 */
function calculateProgress(
  state: RestartState,
  context?: RestartContext
): RestartProgress | null {
  const steps = [
    { state: RestartState.INITIATING, message: "准备重启服务...", step: 1 },
    { state: RestartState.RESTARTING, message: "正在重启服务...", step: 2 },
    { state: RestartState.RECONNECTING, message: "重新建立连接...", step: 3 },
    { state: RestartState.VERIFYING, message: "验证服务状态...", step: 4 },
    { state: RestartState.COMPLETED, message: "重启完成", step: 5 },
  ];

  const currentStep = steps.find((s) => s.state === state);
  if (!currentStep) return null;

  let percentage = (currentStep.step / 5) * 100;

  // 在重连阶段，根据重连尝试次数调整进度
  if (state === RestartState.RECONNECTING && context) {
    const basePercentage = 40; // RECONNECTING 阶段的基础进度 (40%)
    const stepPercentage = 20; // RECONNECTING 阶段的总进度范围 (20%)
    const attemptProgress = context.attempts / (context.maxAttempts || 30);
    percentage = basePercentage + stepPercentage * attemptProgress;
  }

  return {
    percentage: Math.min(100, Math.max(0, percentage)),
    message: currentStep.message,
    currentStep: currentStep.step,
    totalSteps: 5,
  };
}
