import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { RestartButton } from "./RestartButton";

// Mock the useRestartService hook
vi.mock("../hooks/useRestartService", () => ({
  useRestartService: vi.fn(() => ({
    restart: vi.fn(),
    state: "idle",
    progress: null,
    error: null,
    reset: vi.fn(),
    isRestarting: false,
  })),
}));

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("RestartButton", () => {
  const defaultProps = {
    currentPort: 9999,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应该渲染重启按钮", () => {
    render(<RestartButton {...defaultProps} />);

    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("重启服务");
  });

  it("应该在禁用时不可点击", () => {
    render(<RestartButton {...defaultProps} disabled />);

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
  });

  it("应该支持不同的按钮变体", () => {
    render(<RestartButton {...defaultProps} variant="destructive" />);

    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
  });
});
