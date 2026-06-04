export {};

declare global {
  interface Window {
    carbonAPI: {
      invoke(request: any): Promise<any>;
    };
  }
}
