import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useRestartService } from "@/hooks/useRestartService";
import { RestartState } from "@/services/RestartStateMachine";
import { AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

/**
 * RestartButton 组件属性接口
 */
export interface RestartButtonProps {
  /** 当前服务端口 */
  currentPort: number;
  /** 目标端口（可选，用于端口变更重启） */
  targetPort?: number;
  /** 重启完成回调函数 */
  onRestartComplete?: () => void;
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
  /** 是否显示进度条 */
  showProgress?: boolean;
  /** 是否显示错误信息 */
  showError?: boolean;
}

/**
 * 重启按钮组件
 * 集成新的状态机和连接管理器，提供完整的重启流程管理
 */
export function RestartButton({
  currentPort,
  targetPort,
  onRestartComplete,
  disabled = false,
  variant = "outline",
  className = "",
  showProgress = true,
  showError = true,
}: RestartButtonProps) {
  const { restart, state, progress, error, isRestarting } = useRestartService();

  // 处理重启操作
  const handleRestart = async () => {
    if (isRestarting) {
      return;
    }

    try {
      await restart(currentPort, targetPort);
      onRestartComplete?.();
      toast.success("服务重启成功");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "重启服务失败";
      toast.error(`重启失败: ${errorMessage}`);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        onClick={handleRestart}
        variant={variant}
        disabled={isRestarting || disabled}
        className={`flex items-center gap-2 ${className}`}
      >
        <RefreshCw
          className={`h-4 w-4 ${isRestarting ? "animate-spin" : ""}`}
        />
        <span>{getStateDisplayText(state)}</span>
      </Button>

      {showProgress && progress && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Progress value={progress.percentage} className="flex-1" />
          <span>{progress.message}</span>
        </div>
      )}

      {showError && error && (
        <Alert variant="destructive" className="text-sm">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/**
 * 根据重启状态获取显示文本
 */
function getStateDisplayText(state: RestartState): string {
  switch (state) {
    case RestartState.IDLE:
      return "重启服务";
    case RestartState.INITIATING:
      return "准备重启...";
    case RestartState.RESTARTING:
      return "正在重启...";
    case RestartState.RECONNECTING:
      return "重新连接...";
    case RestartState.VERIFYING:
      return "验证服务...";
    case RestartState.COMPLETED:
      return "重启完成";
    case RestartState.FAILED:
      return "重启失败";
    default:
      return "重启服务";
  }
}
