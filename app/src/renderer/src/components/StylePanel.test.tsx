import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StylePanel } from "./StylePanel";
import { useEditor } from "../store";

afterEach(() => {
  cleanup();
  vi.mocked(window.api.listReferences).mockReset();
});

describe("StylePanel", () => {
  // Regression: uploaded project references were imported but never listed.
  it("lists this project's reference videos", async () => {
    vi.mocked(window.api.listReferences).mockResolvedValue(["surf-reel.mp4"]);
    useEditor.setState({ slug: "demo" });
    render(<StylePanel />);
    expect(await screen.findByText("surf-reel.mp4")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove surf-reel.mp4")).toBeInTheDocument();
  });
});
