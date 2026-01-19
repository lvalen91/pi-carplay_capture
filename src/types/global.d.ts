export {}

declare global {
  interface Window {
    carplay: {
      ipc: {
        sendKeyCommand: (cmd: string) => void
      }
      usb: {
        listenForEvents: (...args: any[]) => void
        unlistenForEvents: (...args: any[]) => void
      }
    }
    adapterLog: {
      connect: (config?: {
        host?: string
        port?: number
        username?: string
        password?: string
      }) => Promise<{ ok: boolean; error?: string; logFile?: string }>
      disconnect: () => Promise<{ ok: boolean }>
      getStatus: () => Promise<{
        connected: boolean
        tailing: boolean
        logFile: string | null
        config: {
          host: string
          port: number
          username: string
          password: string
          remoteLogPath: string
        }
      }>
      onLine: (cb: (line: string) => void) => () => void
      onConnected: (cb: (data: { logFile: string }) => void) => () => void
      onDisconnected: (cb: (data: { code: number }) => void) => () => void
      onError: (cb: (error: string) => void) => () => void
    }
  }
}
