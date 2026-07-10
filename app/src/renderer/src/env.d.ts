/// <reference types="vite/client" />

import type { ReelApi } from "../../preload";

export {};

declare global {
  interface Window {
    api: ReelApi;
  }
}
