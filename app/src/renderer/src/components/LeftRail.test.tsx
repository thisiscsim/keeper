import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { parseEdl } from "@reel/edl";
import { LeftRail } from "./LeftRail";
import { useEditor } from "../store";

afterEach(cleanup);

describe("LeftRail", () => {
  it("renders an empty rail before a project loads", () => {
    useEditor.setState({ edl: null, slug: null });
    const { container } = render(<LeftRail />);
    expect(container.querySelector(".left-rail")).toBeInTheDocument();
  });

  // Regression guard for the rules-of-hooks crash: rendering with a loaded EDL
  // (edl null -> set) must not throw or blank the app.
  it("mounts without crashing once an EDL is loaded", () => {
    const edl = parseEdl({ tracks: [{ id: "v", type: "video", clips: [] }] }).edl!;
    useEditor.setState({ edl, slug: "demo", promptText: "" });
    render(<LeftRail />);
    expect(screen.getByPlaceholderText(/Describe the video you want/i)).toBeInTheDocument();
    expect(screen.getByText("Clips")).toBeInTheDocument();
    expect(screen.getByText("Upload clips")).toBeInTheDocument();
  });
});
