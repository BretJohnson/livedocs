/// <reference types="vite/client" />

// electron-vite: import a main-process worker entry as a bundled module path.
declare module '*?modulePath' {
  const modulePath: string;
  export default modulePath;
}
