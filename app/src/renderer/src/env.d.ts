/// <reference types="vite/client" />

import type { KeeperApi } from "../../preload";

export {};

declare global {
  interface Window {
    api: KeeperApi;
  }
}
