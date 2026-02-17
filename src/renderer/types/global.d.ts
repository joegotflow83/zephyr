// Global type augmentations for the renderer process.
// window.api is exposed by the preload script via contextBridge.

export {};

declare global {
  interface Window {
    api: {
      ping: () => Promise<string>;
    };
  }
}
