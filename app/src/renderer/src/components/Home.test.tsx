import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Home } from "./Home";
import { useEditor } from "../store";

afterEach(() => {
  cleanup();
  vi.mocked(window.api.getPathForFile).mockReset();
});

function openDialog() {
  useEditor.setState({ view: "home", projects: [] });
  const utils = render(<Home />);
  fireEvent.click(screen.getAllByText("New project")[0]);
  return utils;
}

describe("NewProjectModal clips staging", () => {
  it("stages picked files as removable rows (snapshot survives the input reset)", async () => {
    vi.mocked(window.api.getPathForFile).mockImplementation((f: File) => `/picked/${f.name}`);
    const { container } = openDialog();

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(["x"], "beach.mp4", { type: "video/mp4" })] } });

    expect(await screen.findByText("beach.mp4")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Remove beach.mp4"));
    expect(screen.queryByText("beach.mp4")).not.toBeInTheDocument();
  });

  it("creates without a platform and imports the staged clips", async () => {
    vi.mocked(window.api.getPathForFile).mockImplementation((f: File) => `/picked/${f.name}`);
    vi.mocked(window.api.createProject).mockResolvedValue({ ok: true, slug: "demo" });
    vi.mocked(window.api.importAssets).mockResolvedValue({ ok: true, assets: [] });
    const { container } = openDialog();

    fireEvent.change(screen.getByPlaceholderText(/Day in the life/i), { target: { value: "My cut" } });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(["x"], "beach.mp4", { type: "video/mp4" })] } });
    await screen.findByText("beach.mp4");

    fireEvent.click(screen.getByText("Create"));

    await waitFor(() => expect(window.api.createProject).toHaveBeenCalled());
    expect(window.api.createProject).toHaveBeenCalledWith({ title: "My cut", prompt: "" });
    await waitFor(() =>
      expect(window.api.importAssets).toHaveBeenCalledWith("demo", ["/picked/beach.mp4"]),
    );
  });
});
