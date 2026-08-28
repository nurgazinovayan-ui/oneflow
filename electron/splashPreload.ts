import { contextBridge, ipcRenderer } from 'electron';

export interface LoginResult {
  ok: boolean;
  error?: string;
}

export interface RegisterResult {
  ok: boolean;
  error?: string;
  needsConfirmation?: boolean;
}

const authApi = {
  onShowLogin: (callback: () => void): void => {
    ipcRenderer.on('auth:show-login', () => callback());
  },
  login: (email: string, password: string, rememberMe: boolean): void => {
    ipcRenderer.send('auth:login-request', { email, password, rememberMe });
  },
  onLoginResult: (callback: (result: LoginResult) => void): void => {
    ipcRenderer.on('auth:login-result', (_event, result: LoginResult) => callback(result));
  },
  register: (email: string, password: string): void => {
    ipcRenderer.send('auth:register-request', { email, password });
  },
  onRegisterResult: (callback: (result: RegisterResult) => void): void => {
    ipcRenderer.on('auth:register-result', (_event, result: RegisterResult) => callback(result));
  },
  openCheckout: (url: string): void => {
    ipcRenderer.send('auth:open-checkout', url);
  },
  getCheckoutUrl: (): Promise<string> => ipcRenderer.invoke('auth:get-checkout-url'),
  closeApp: (): void => {
    ipcRenderer.send('auth:close-app');
  },
  enterDemoMode: (): void => {
    ipcRenderer.send('auth:demo-mode');
  },
};

contextBridge.exposeInMainWorld('authApi', authApi);

export type SplashAuthApi = typeof authApi;
