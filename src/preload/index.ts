import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { ExtraConfig } from '../main/Globals'
import type { MultiTouchPoint } from '../main/carplay/messages/sendable'

type ApiCallback<TArgs extends unknown[] = unknown[]> = (
  event: IpcRendererEvent,
  ...args: TArgs
) => void

let usbEventQueue: Array<[IpcRendererEvent, ...unknown[]]> = []
let usbEventHandlers: Array<ApiCallback> = []

ipcRenderer.on('usb-event', (event, ...args: unknown[]) => {
  if (usbEventHandlers.length) {
    usbEventHandlers.forEach((h) => h(event, ...args))
  } else {
    usbEventQueue.push([event, ...args])
  }
})

type ChunkHandler = (payload: unknown) => void
let videoChunkQueue: unknown[] = []
let videoChunkHandler: ChunkHandler | null = null
let audioChunkQueue: unknown[] = []
let audioChunkHandler: ChunkHandler | null = null

ipcRenderer.on('carplay-video-chunk', (_event, payload: unknown) => {
  if (videoChunkHandler) videoChunkHandler(payload)
  else videoChunkQueue.push(payload)
})
ipcRenderer.on('carplay-audio-chunk', (_event, payload: unknown) => {
  if (audioChunkHandler) audioChunkHandler(payload)
  else audioChunkQueue.push(payload)
})

type UsbDeviceInfo =
  | { device: false; vendorId: null; productId: null; usbFwVersion: string }
  | { device: true; vendorId: number; productId: number; usbFwVersion: string }

type UsbLastEvent =
  | { type: 'unplugged'; device: null }
  | { type: 'plugged'; device: { vendorId: number; productId: number; deviceName: string } }

const api = {
  quit: (): Promise<void> => ipcRenderer.invoke('quit'),

  onUSBResetStatus: (callback: ApiCallback): void => {
    ipcRenderer.on('usb-reset-start', callback)
    ipcRenderer.on('usb-reset-done', callback)
  },

  usb: {
    forceReset: (): Promise<boolean> => ipcRenderer.invoke('usb-force-reset'),
    detectDongle: (): Promise<boolean> => ipcRenderer.invoke('usb-detect-dongle'),
    getDeviceInfo: (): Promise<UsbDeviceInfo> => ipcRenderer.invoke('carplay:usbDevice'),
    getLastEvent: (): Promise<UsbLastEvent> => ipcRenderer.invoke('usb-last-event'),
    getSysdefaultPrettyName: (): Promise<string> => ipcRenderer.invoke('get-sysdefault-mic-label'),
    uploadIcons: () => ipcRenderer.invoke('carplay-upload-icons'),
    listenForEvents: (callback: ApiCallback): void => {
      usbEventHandlers.push(callback)
      usbEventQueue.forEach(([evt, ...args]) => callback(evt, ...args))
      usbEventQueue = []
    },
    unlistenForEvents: (callback: ApiCallback): void => {
      usbEventHandlers = usbEventHandlers.filter((cb) => cb !== callback)
    }
  },

  settings: {
    get: (): Promise<ExtraConfig> => ipcRenderer.invoke('getSettings'),
    save: (settings: Partial<ExtraConfig>): Promise<void> =>
      ipcRenderer.invoke('save-settings', settings),
    onUpdate: (callback: ApiCallback<[ExtraConfig]>): void => {
      ipcRenderer.on('settings', callback)
    }
  },

  ipc: {
    start: (): Promise<void> => ipcRenderer.invoke('carplay-start'),
    stop: (): Promise<void> => ipcRenderer.invoke('carplay-stop'),
    sendFrame: (): Promise<void> => ipcRenderer.invoke('carplay-sendframe'),
    dongleFirmware: (action: 'check' | 'download' | 'upload' | 'status'): Promise<unknown> =>
      ipcRenderer.invoke('dongle-fw', { action }),
    sendTouch: (x: number, y: number, action: number): void =>
      ipcRenderer.send('carplay-touch', { x, y, action }),
    sendMultiTouch: (points: MultiTouchPoint[]): void =>
      ipcRenderer.send('carplay-multi-touch', points),
    sendKeyCommand: (key: string): void => ipcRenderer.send('carplay-key-command', key),
    onEvent: (callback: ApiCallback): void => {
      ipcRenderer.on('carplay-event', callback)
    },
    offEvent: (callback: ApiCallback): void => {
      ipcRenderer.removeListener('carplay-event', callback)
    },
    readMedia: (): Promise<unknown> => ipcRenderer.invoke('carplay-media-read'),
    onVideoChunk: (handler: ChunkHandler): void => {
      videoChunkHandler = handler
      videoChunkQueue.forEach((chunk) => handler(chunk))
      videoChunkQueue = []
    },
    onAudioChunk: (handler: ChunkHandler): void => {
      audioChunkHandler = handler
      audioChunkQueue.forEach((chunk) => handler(chunk))
      audioChunkQueue = []
    },
    setVolume: (stream: 'music' | 'nav' | 'siri' | 'call', volume: number): void => {
      ipcRenderer.send('carplay-set-volume', { stream, volume })
    },
    setVisualizerEnabled: (enabled: boolean): void => {
      ipcRenderer.send('carplay-set-visualizer-enabled', !!enabled)
    }
  }
}

contextBridge.exposeInMainWorld('carplay', api)

const naviWindowApi = {
  open: (): Promise<void> => ipcRenderer.invoke('navi:open'),
  close: (): Promise<void> => ipcRenderer.invoke('navi:close'),
  hide: (): Promise<void> => ipcRenderer.invoke('navi:hide'),
  resize: (width: number, height: number): Promise<void> => ipcRenderer.invoke('navi:resize', width, height),
  isVisible: (): Promise<boolean> => ipcRenderer.invoke('navi:isVisible')
}

contextBridge.exposeInMainWorld('naviWindow', naviWindowApi)

type UpdateEvent = { phase: string; message?: string }
type UpdateProgress = { phase?: string; percent?: number; received?: number; total?: number }

const appApi = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  getLatestRelease: (): Promise<{ version?: string; url?: string }> =>
    ipcRenderer.invoke('app:getLatestRelease'),
  performUpdate: (imageUrl?: string): Promise<void> =>
    ipcRenderer.invoke('app:performUpdate', imageUrl),

  onUpdateEvent: (cb: (payload: UpdateEvent) => void): (() => void) => {
    const ch = 'update:event'
    const handler = (_e: IpcRendererEvent, payload: UpdateEvent) => cb(payload)
    ipcRenderer.on(ch, handler)
    return () => ipcRenderer.removeListener(ch, handler)
  },
  onUpdateProgress: (cb: (payload: UpdateProgress) => void): (() => void) => {
    const ch = 'update:progress'
    const handler = (_e: IpcRendererEvent, payload: UpdateProgress) => cb(payload)
    ipcRenderer.on(ch, handler)
    return () => ipcRenderer.removeListener(ch, handler)
  },

  getKiosk: (): Promise<boolean> => ipcRenderer.invoke('settings:get-kiosk'),
  onKioskSync: (cb: (kiosk: boolean) => void): (() => void) => {
    const ch = 'settings:kiosk-sync'
    const handler = (_e: IpcRendererEvent, kiosk: boolean) => cb(kiosk)
    ipcRenderer.on(ch, handler)
    return () => ipcRenderer.removeListener(ch, handler)
  },

  resetDongleIcons: (): Promise<{
    dongleIcon120?: string
    dongleIcon180?: string
    dongleIcon256?: string
  }> => ipcRenderer.invoke('settings:reset-dongle-icons'),

  beginInstall: (): Promise<void> => ipcRenderer.invoke('app:beginInstall'),
  abortUpdate: (): Promise<void> => ipcRenderer.invoke('app:abortUpdate'),
  quitApp: (): Promise<void> => ipcRenderer.invoke('app:quitApp'),
  restartApp: (): Promise<void> => ipcRenderer.invoke('app:restartApp')
}

contextBridge.exposeInMainWorld('app', appApi)

// USB Capture API
type USBCaptureConfig = {
  includeVideoData?: boolean
  includeMicData?: boolean
  includeSpeakerData?: boolean
  includeAudioData?: boolean
  separateStreams?: boolean
}

type USBCaptureStatus = {
  enabled: boolean
  hasActiveSession: boolean
  config: USBCaptureConfig & { enabled: boolean }
  stats: {
    packetsIn: number
    packetsOut: number
    bytesIn: number
    bytesOut: number
    elapsed: number
  }
  sessionFiles: {
    textLog: string
    binaryCapture: string
    jsonIndex: string
  } | null
}

type USBCaptureEnableResult = {
  ok: boolean
  enabled: boolean
  sessionFiles: USBCaptureStatus['sessionFiles']
}

type USBCaptureDisableResult = {
  ok: boolean
  enabled: boolean
  finalStats: USBCaptureStatus['stats']
  sessionFiles: USBCaptureStatus['sessionFiles']
}

const usbCaptureApi = {
  getStatus: (): Promise<USBCaptureStatus> =>
    ipcRenderer.invoke('usb-capture:getStatus'),

  enable: (options?: {
    config?: USBCaptureConfig
    resetAdapter?: boolean
  }): Promise<USBCaptureEnableResult> =>
    ipcRenderer.invoke('usb-capture:enable', options),

  disable: (): Promise<USBCaptureDisableResult> =>
    ipcRenderer.invoke('usb-capture:disable'),

  updateConfig: (config: USBCaptureConfig): Promise<{ ok: boolean; config: USBCaptureConfig }> =>
    ipcRenderer.invoke('usb-capture:updateConfig', config),

  getStats: (): Promise<USBCaptureStatus['stats']> =>
    ipcRenderer.invoke('usb-capture:getStats'),

  endSession: (): Promise<{
    ok: boolean
    stats: USBCaptureStatus['stats']
    sessionFiles: USBCaptureStatus['sessionFiles']
  }> => ipcRenderer.invoke('usb-capture:endSession')
}

contextBridge.exposeInMainWorld('usbCapture', usbCaptureApi)

// Adapter TTYLog API
type AdapterLogConfig = {
  host: string
  port: number
  username: string
  password: string
  remoteLogPath: string
}

type AdapterLogStatus = {
  connected: boolean
  tailing: boolean
  logFile: string | null
  config: AdapterLogConfig
}

const adapterLogApi = {
  getStatus: (): Promise<AdapterLogStatus> =>
    ipcRenderer.invoke('adapter-log:getStatus'),

  connect: (config?: {
    host?: string
    port?: number
    username?: string
    password?: string
  }): Promise<{ ok: boolean; error?: string; logFile?: string }> =>
    ipcRenderer.invoke('adapter-log:connect', config),

  disconnect: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('adapter-log:disconnect'),

  updateConfig: (config: {
    host?: string
    port?: number
    username?: string
    password?: string
  }): Promise<{ ok: boolean; config: AdapterLogConfig }> =>
    ipcRenderer.invoke('adapter-log:updateConfig', config)
}

contextBridge.exposeInMainWorld('adapterLog', adapterLogApi)
