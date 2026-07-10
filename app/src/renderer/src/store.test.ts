import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEdl } from "@reel/edl";
import { useEditor } from "./store";

const edl = parseEdl({ tracks: [{ id: "v", type: "video", clips: [] }] }).edl!;

beforeEach(() => {
  vi.clearAllMocks();
  useEditor.setState({ view: "home", slug: null, edl: null });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("view routing", () => {
  it("openProject enters the editor; goHome returns home", () => {
    useEditor.getState().openProject("demo");
    expect(useEditor.getState()).toMatchObject({ view: "editor", slug: "demo" });
    useEditor.getState().goHome();
    expect(useEditor.getState().view).toBe("home");
  });
});

describe("theme", () => {
  it("toggleTheme flips the theme, sets the DOM attribute, and persists", () => {
    useEditor.setState({ theme: "dark" });
    useEditor.getState().toggleTheme();
    expect(useEditor.getState().theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("keeper:theme")).toBe("light");
  });
});

describe("edl history", () => {
  it("undo/redo walk the edit stack and persist each step", () => {
    vi.useFakeTimers();
    useEditor.setState({ edl, slug: "demo", edlPast: [], edlFuture: [] });
    const s = () => useEditor.getState();

    s().updateEdl((d) => (d.theme.fontFamily = "First"));
    s().updateEdl((d) => (d.theme.fontFamily = "Second"));
    expect(s().edl?.theme.fontFamily).toBe("Second");
    expect(s().edlPast).toHaveLength(2);

    s().undoEdl();
    expect(s().edl?.theme.fontFamily).toBe("First");
    s().undoEdl();
    expect(s().edl?.theme.fontFamily).toBe(edl.theme.fontFamily);
    expect(s().edlPast).toHaveLength(0);
    expect(s().edlFuture).toHaveLength(2);

    s().redoEdl();
    expect(s().edl?.theme.fontFamily).toBe("First");
    vi.advanceTimersByTime(400);
    expect(window.api.saveEdl).toHaveBeenCalled();
  });

  it("a new edit clears the redo stack; external load resets history", () => {
    useEditor.setState({ edl, slug: "demo", edlPast: [], edlFuture: [] });
    const s = () => useEditor.getState();
    s().updateEdl((d) => (d.theme.fontFamily = "A"));
    s().undoEdl();
    expect(s().edlFuture).toHaveLength(1);
    s().updateEdl((d) => (d.theme.fontFamily = "B"));
    expect(s().edlFuture).toHaveLength(0);

    s().setProject({ edl, slug: "demo" });
    expect(s().edlPast).toHaveLength(0);
    expect(s().edlFuture).toHaveLength(0);
  });
});

describe("panel layout", () => {
  it("clamps panel sizes to their limits and persists them", () => {
    const s = () => useEditor.getState();
    s().setPanelSize("left", 10_000);
    expect(s().panelSizes.left).toBe(440);
    s().setPanelSize("timeline", 10);
    expect(s().panelSizes.timeline).toBe(160);
    expect(JSON.parse(localStorage.getItem("keeper:panel-layout")!)).toMatchObject({
      left: 440,
      timeline: 160,
    });
  });

  it("togglePanels flips focus mode", () => {
    const s = () => useEditor.getState();
    const before = s().panelsHidden;
    s().togglePanels();
    expect(s().panelsHidden).toBe(!before);
    s().togglePanels();
    expect(s().panelsHidden).toBe(before);
  });
});

describe("autosave", () => {
  it("debounces a save to disk after updateEdl", () => {
    vi.useFakeTimers();
    useEditor.setState({ edl, slug: "demo" });
    useEditor.getState().updateEdl((d) => (d.theme.fontFamily = "Inter"));
    expect(window.api.saveEdl).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(window.api.saveEdl).toHaveBeenCalledTimes(1);
    expect(window.api.saveEdl).toHaveBeenCalledWith("demo", expect.objectContaining({ theme: expect.any(Object) }));
  });

  it("does not save when there is no slug", () => {
    vi.useFakeTimers();
    useEditor.setState({ edl, slug: null });
    useEditor.getState().updateEdl((d) => (d.theme.fontFamily = "Mono"));
    vi.advanceTimersByTime(400);
    expect(window.api.saveEdl).not.toHaveBeenCalled();
  });
});
