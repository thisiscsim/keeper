import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { parseEdl, type Edl } from "@reel/edl";
import { InspectorPanel } from "./InspectorPanel";
import { useEditor } from "../store";

afterEach(cleanup);

describe("InspectorPanel", () => {
  it("renders Design + Format for the project when nothing is selected", () => {
    const edl = parseEdl({ tracks: [{ id: "v", type: "video", clips: [] }] }).edl!;
    useEditor.setState({ edl, slug: "demo", selectedClipId: null });
    render(<InspectorPanel />);
    expect(screen.getByText("Design")).toBeInTheDocument();
    expect(screen.getByText("Format")).toBeInTheDocument();
  });

  // Regression: an EDL parsed by an older schema (no theme.textAlignment, e.g.
  // a stale main process across a renderer hot-reload) must not crash the app.
  it("tolerates an EDL without theme.textAlignment", () => {
    const edl = parseEdl({ tracks: [{ id: "v", type: "video", clips: [] }] }).edl!;
    delete (edl.theme as Partial<Edl["theme"]>).textAlignment;
    useEditor.setState({ edl, slug: "demo", selectedClipId: null });
    render(<InspectorPanel />);
    expect(screen.getByText("Design")).toBeInTheDocument();
  });
});
