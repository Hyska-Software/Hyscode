/// <reference types="vite/client" />

declare module '*.css' {
  const content: string;
  export default content;
}

type HyscodeBootApi = {
  ready: () => void;
};

declare global {
  interface Window {
    __hyscodeBoot?: HyscodeBootApi;
  }
}

export {};
