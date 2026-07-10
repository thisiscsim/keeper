import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Two projects: a Node env for the schema package + Node scripts, and a jsdom
// env (with React) for the renderer's pure logic + light component tests.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "edl",
          environment: "node",
          include: ["packages/edl/**/*.test.ts", "app/scripts/**/*.test.mjs"],
        },
      },
      {
        plugins: [react()],
        test: {
          name: "app",
          environment: "jsdom",
          setupFiles: ["./test/setup.ts"],
          include: ["app/src/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
