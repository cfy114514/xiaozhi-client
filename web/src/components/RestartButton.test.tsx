import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { RestartButton, type RestartStatus } from "./RestartButton";
import { useWebSocket } from "@/hooks/useWebSocket";

// Mock useWebSocket hook
const mockRestartService = vi.fn();
const mockRefreshConfig = vi.fn();
const mockUpdateConfig = vi.fn();
const mockRefreshStatus = vi.fn();
const mockSetCustomWsUrl = vi.fn();
const mockChangePort = vi.fn();

vi.mock("@/hooks/useWebSocket", () => ({
  useWebSocket: vi.fn(),
}));

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("RestartButton", () => {
  const mockUseWebSocket = vi.mocked(useWebSocket);

  // 创建完整的 mock 返回值
  const createMockWebSocketReturn = (overrides = {}) => ({
    connected: false,
    config: null,
    status: null,
    updateConfig: mockUpdateConfig,
    refreshStatus: mockRefreshStatus,
    refreshConfig: mockRefreshConfig,
    restartService: mockRestartService,
    wsUrl: "ws://localhost:9999",
    setCustomWsUrl: mockSetCustomWsUrl,
    changePort: mockChangePort,
    restartStatus: undefined,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRestartService.mockClear();
    mockRefreshConfig.mockClear();

    // 默认 mock 返回值
    mockUseWebSocket.mockReturnValue(createMockWebSocketReturn());
  });

  it("should render with default props", () => {
    render(<RestartButton />);

    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("重启服务");
    expect(button).not.toBeDisabled();

    const icon = button.querySelector("svg");
    expect(icon).toBeInTheDocument();
    expect(icon).not.toHaveClass("animate-spin");
  });

  it("should render with custom text", () => {
    render(
      <RestartButton defaultText="重新启动" restartingText="正在重启..." />
    );

    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("重新启动");
  });

  it("should be disabled when disabled prop is true", () => {
    render(<RestartButton disabled={true} />);

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
  });

  it("should call onRestart when clicked", async () => {
    const mockOnRestart = vi.fn().mockResolvedValue(undefined);
    render(<RestartButton onRestart={mockOnRestart} />);

    const button = screen.getByRole("button");
    fireEvent.click(button);

    expect(mockOnRestart).toHaveBeenCalledTimes(1);
  });

  it("should show loading state when restarting", async () => {
    const mockOnRestart = vi
      .fn()
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

    render(<RestartButton onRestart={mockOnRestart} />);

    const button = screen.getByRole("button");
    fireEvent.click(button);

    // 应该立即显示加载状态
    expect(button).toHaveTextContent("重启中...");
    expect(button).toBeDisabled();

    const icon = button.querySelector("svg");
    expect(icon).toHaveClass("animate-spin");

    // 等待重启完成
    await waitFor(() => {
      expect(mockOnRestart).toHaveBeenCalled();
    });
  });

  it("should show error toast when restart fails", async () => {
    const mockOnRestart = vi.fn().mockRejectedValue(new Error("重启失败"));
    render(<RestartButton onRestart={mockOnRestart} />);

    const button = screen.getByRole("button");
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockOnRestart).toHaveBeenCalled();
    });

    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalledWith("重启失败");

    // 错误时应该清除加载状态
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent("重启服务");
  });

  it("should clear loading state when restartStatus becomes completed", () => {
    // 直接传入 restartStatus prop 来测试状态变化
    const restartStatus: RestartStatus = {
      status: "completed",
      timestamp: Date.now(),
    };

    render(<RestartButton restartStatus={restartStatus} />);

    const button = screen.getByRole("button");

    // 应该不是加载状态
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent("重启服务");

    const icon = button.querySelector("svg");
    expect(icon).not.toHaveClass("animate-spin");
  });

  it("should clear loading state when restartStatus becomes failed", () => {
    const { rerender } = render(<RestartButton />);

    const restartStatus: RestartStatus = {
      status: "failed",
      error: "重启失败",
      timestamp: Date.now(),
    };

    rerender(<RestartButton restartStatus={restartStatus} />);

    const button = screen.getByRole("button");
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent("重启服务");

    const icon = button.querySelector("svg");
    expect(icon).not.toHaveClass("animate-spin");
  });

  it("should apply custom className", () => {
    render(<RestartButton className="custom-class" />);

    const button = screen.getByRole("button");
    expect(button).toHaveClass("custom-class");
  });

  it("should use different button variants", () => {
    const { rerender } = render(<RestartButton variant="default" />);

    let button = screen.getByRole("button");
    expect(button).toHaveClass("bg-primary"); // default variant class

    rerender(<RestartButton variant="secondary" />);
    button = screen.getByRole("button");
    expect(button).toHaveClass("bg-secondary"); // secondary variant class
  });

  it("should not call onRestart if not provided", () => {
    render(<RestartButton />);

    const button = screen.getByRole("button");
    fireEvent.click(button);

    // 应该调用 restartService
    expect(mockRestartService).toHaveBeenCalled();

    // 按钮应该正常工作
    expect(button).toBeInTheDocument();
  });

  it("should handle async onRestart function", async () => {
    const mockOnRestart = vi.fn().mockResolvedValue("success");
    render(<RestartButton onRestart={mockOnRestart} />);

    const button = screen.getByRole("button");
    fireEvent.click(button);

    // 应该显示加载状态
    expect(button).toHaveTextContent("重启中...");
    expect(button).toBeDisabled();

    await waitFor(() => {
      expect(mockOnRestart).toHaveBeenCalled();
    });
  });

  it("should handle sync onRestart function", () => {
    const mockOnRestart = vi.fn();
    render(<RestartButton onRestart={mockOnRestart} />);

    const button = screen.getByRole("button");
    fireEvent.click(button);

    expect(mockOnRestart).toHaveBeenCalledTimes(1);
  });

  it("should call refreshConfig when restart status becomes completed", () => {
    const restartStatus: RestartStatus = {
      status: "completed",
      timestamp: Date.now(),
    };

    // 设置 mock 返回 completed 状态
    mockUseWebSocket.mockReturnValue(
      createMockWebSocketReturn({ restartStatus })
    );

    render(<RestartButton />);

    // 验证 refreshConfig 被调用
    expect(mockRefreshConfig).toHaveBeenCalledTimes(1);
  });

  it("should not call refreshConfig when restart status becomes failed", () => {
    const restartStatus: RestartStatus = {
      status: "failed",
      error: "重启失败",
      timestamp: Date.now(),
    };

    // 设置 mock 返回 failed 状态
    mockUseWebSocket.mockReturnValue(
      createMockWebSocketReturn({ restartStatus })
    );

    render(<RestartButton />);

    // 验证 refreshConfig 没有被调用
    expect(mockRefreshConfig).not.toHaveBeenCalled();
  });
});
