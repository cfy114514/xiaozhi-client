import { Button } from "@/components/ui/button";
import { useWebSocket } from "@/hooks/useWebSocket";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * 重启状态接口
 */
export interface RestartStatus {
  status: "restarting" | "completed" | "failed";
  error?: string;
  timestamp: number;
}

/**
 * RestartButton 组件属性接口
 */
export interface RestartButtonProps {
  /** 重启回调函数 */
  onRestart?: () => Promise<void> | void;
  /** 重启状态 */
  restartStatus?: RestartStatus;
  /** 是否禁用按钮 */
  disabled?: boolean;
  /** 按钮样式变体 */
  variant?:
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link";
  /** 自定义样式类 */
  className?: string;
  /** 重启中的文本 */
  restartingText?: string;
  /** 默认文本 */
  defaultText?: string;
}

/**
 * 独立的重启按钮组件
 * 基于 ConfigEditor.tsx 中的重启服务功能实现
 */
export function RestartButton({
  onRestart,
  disabled = false,
  variant = "outline",
  className = "",
  restartingText = "重启中...",
  defaultText = "重启服务",
}: RestartButtonProps) {
  const [isRestarting, setIsRestarting] = useState(false);
  const [restartPhase, setRestartPhase] = useState<
    "idle" | "restarting" | "reconnecting" | "completed" | "failed"
  >("idle");
  const { restartService, connected } = useWebSocket();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 监听连接状态变化 - 这是重启成功的唯一可靠指标
  useEffect(() => {
    // 只有在重启过程中且连接状态变为 true 时，才认为重启成功
    if (isRestarting && connected && restartPhase === "reconnecting") {
      console.log("[RestartButton] 检测到重连成功，连接状态已恢复");

      // 清除超时定时器
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      setRestartPhase("completed");
      setIsRestarting(false);
      toast.success("服务重启并重连成功");

      // 3秒后重置状态，允许用户再次重启
      setTimeout(() => {
        setRestartPhase("idle");
      }, 3000);
    }
  }, [connected, isRestarting, restartPhase]);

  // 重置失败状态，允许用户重试
  useEffect(() => {
    if (restartPhase === "failed") {
      const timer = setTimeout(() => {
        setRestartPhase("idle");
      }, 5000); // 5秒后重置状态

      return () => clearTimeout(timer);
    }
  }, [restartPhase]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  const handleRestart = async () => {
    if (isRestarting) {
      return;
    }

    setIsRestarting(true);
    setRestartPhase("restarting");

    try {
      // 先执行自定义的重启回调（如果有）
      if (onRestart) {
        await onRestart();
      }

      // 执行 WebSocket 重启服务（现在是 async 函数）
      console.log("[RestartButton] 开始重启服务...");
      setRestartPhase("reconnecting");
      toast.info("正在重启服务，请稍候...");

      // 启动重启服务，但不等待它完成
      // 重启成功与否将通过连接状态变化来判断
      restartService().catch((error) => {
        console.error("[RestartButton] 重启服务失败:", error);
        const errorMessage =
          error instanceof Error ? error.message : "重启服务时发生错误";

        toast.error(errorMessage);
        setRestartPhase("failed");
        setIsRestarting(false);

        // 清除超时定时器
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      });

      // 设置35秒超时（比重连的30秒稍长一点）
      timeoutRef.current = setTimeout(() => {
        console.error("[RestartButton] 重启超时，35秒内未检测到重连成功");
        toast.error("重启超时，请检查服务状态或手动刷新页面");
        setRestartPhase("failed");
        setIsRestarting(false);
        timeoutRef.current = null;
      }, 35000);

      // 不在这里等待 restartService 完成，而是通过监听连接状态变化来判断成功
      console.log("[RestartButton] 重启请求已发送，等待重连...");
    } catch (error) {
      console.error("[RestartButton] 重启服务启动失败:", error);
      const errorMessage =
        error instanceof Error ? error.message : "重启服务时发生错误";

      toast.error(errorMessage);
      setRestartPhase("failed");
      setIsRestarting(false);
    }
  };

  // 根据重启阶段显示不同的文本
  const getButtonText = () => {
    switch (restartPhase) {
      case "restarting":
        return "重启中...";
      case "reconnecting":
        return "重连中...";
      case "completed":
        return "重启成功";
      case "failed":
        return "重启失败";
      default:
        return isRestarting ? restartingText : defaultText;
    }
  };

  return (
    <Button
      type="button"
      onClick={handleRestart}
      variant={variant}
      disabled={isRestarting || disabled}
      className={`flex items-center gap-2 ${className}`}
    >
      <RefreshCw className={`h-4 w-4 ${isRestarting ? "animate-spin" : ""}`} />
      {getButtonText()}
    </Button>
  );
}
