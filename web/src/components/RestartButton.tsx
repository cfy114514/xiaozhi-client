import { Button } from "@/components/ui/button";
import { useWebSocket } from "@/hooks/useWebSocket";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
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
  const { restartStatus, restartService, refreshConfig } = useWebSocket();

  // 监听重启状态变化
  useEffect(() => {
    if (restartStatus) {
      if (
        restartStatus.status === "completed" ||
        restartStatus.status === "failed"
      ) {
        if (restartStatus.status === "completed") {
          toast.success("服务已重启");

          // 重启成功后，重新获取配置信息以更新 MCP 服务工具列表
          try {
            console.log("[RestartButton] 重启成功，正在刷新配置信息...");
            refreshConfig();
          } catch (error) {
            console.error("[RestartButton] 刷新配置失败:", error);
            // 不显示错误提示，因为这是后台操作，不应该影响用户体验
          }
        } else {
          toast.error("服务重启失败");
        }
        // 重启完成或失败时，清除 loading 状态
        setIsRestarting(false);
      }
    }
  }, [restartStatus, refreshConfig]);

  const handleRestart = async () => {
    // if (!onRestart) return;
    if (isRestarting) {
      return;
    }
    restartService();

    setIsRestarting(true);
    try {
      if (onRestart) {
        await onRestart();
      }
      // 成功时不再立即清除 loading 状态，等待 restartStatus 更新
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "重启服务时发生错误"
      );
      // 错误时立即清除 loading 状态
      setIsRestarting(false);
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
      {isRestarting ? restartingText : defaultText}
    </Button>
  );
}
