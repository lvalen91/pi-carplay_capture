import { contextBridge, ipcRenderer } from 'electron'

type ChunkHandler = (payload: unknown) => void
let videoChunkHandler: ChunkHandler | null = null
let videoChunkQueue: unknown[] = []

ipcRenderer.on('navi-video-chunk', (_event, payload: unknown) => {
  if (videoChunkHandler) videoChunkHandler(payload)
  else videoChunkQueue.push(payload)
})

type ResolutionHandler = (resolution: { width: number; height: number }) => void
let resolutionHandler: ResolutionHandler | null = null

ipcRenderer.on('navi-video-resolution', (_event, resolution: { width: number; height: number }) => {
  if (resolutionHandler) resolutionHandler(resolution)
})

const naviApi = {
  onVideoChunk: (handler: ChunkHandler): void => {
    videoChunkHandler = handler
    videoChunkQueue.forEach((chunk) => handler(chunk))
    videoChunkQueue = []
  },
  onResolution: (handler: ResolutionHandler): void => {
    resolutionHandler = handler
  },
  close: (): void => {
    ipcRenderer.invoke('navi:close')
  }
}

contextBridge.exposeInMainWorld('navi', naviApi)
