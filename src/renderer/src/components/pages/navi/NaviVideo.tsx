import React, { useEffect, useRef, useState, useMemo } from 'react'
import { InitEvent } from '@worker/render/RenderEvents'

declare global {
  interface Window {
    navi?: {
      onVideoChunk: (handler: (payload: unknown) => void) => void
      onResolution: (handler: (res: { width: number; height: number }) => void) => void
      close: () => void
    }
  }
}

export const NaviVideo: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderWorkerRef = useRef<Worker | null>(null)
  const offscreenCanvasRef = useRef<OffscreenCanvas | null>(null)
  const [renderReady, setRenderReady] = useState(false)
  const [resolution, setResolution] = useState<{ width: number; height: number } | null>(null)

  // Create a MessageChannel for video data
  const videoChannel = useMemo(() => new MessageChannel(), [])

  // Setup render worker
  useEffect(() => {
    if (canvasRef.current && !offscreenCanvasRef.current && !renderWorkerRef.current) {
      offscreenCanvasRef.current = canvasRef.current.transferControlToOffscreen()
      const w = new Worker(new URL('@worker/render/Render.worker.ts', import.meta.url), {
        type: 'module'
      })
      renderWorkerRef.current = w

      // Initialize with 30 FPS (navi video typically runs at 30fps)
      w.postMessage(new InitEvent(offscreenCanvasRef.current, videoChannel.port2, 30), [
        offscreenCanvasRef.current,
        videoChannel.port2
      ])
    }

    return () => {
      renderWorkerRef.current?.terminate()
      renderWorkerRef.current = null
      offscreenCanvasRef.current = null
    }
  }, [videoChannel])

  // Listen for render-ready message
  useEffect(() => {
    if (!renderWorkerRef.current) return
    const handler = (ev: MessageEvent<{ type: string }>) => {
      if (ev.data?.type === 'render-ready') {
        console.log('[NaviVideo] Render worker ready')
        setRenderReady(true)
      }
    }
    renderWorkerRef.current.addEventListener('message', handler)
    return () => renderWorkerRef.current?.removeEventListener('message', handler)
  }, [])

  // Setup video chunk handler
  useEffect(() => {
    if (!window.navi) {
      console.error('[NaviVideo] window.navi API not available')
      return
    }

    const handleVideo = (payload: unknown) => {
      if (!renderReady || !payload || typeof payload !== 'object') return
      const m = payload as { chunk?: { buffer?: ArrayBuffer } }
      const buf = m.chunk?.buffer
      if (!buf) return
      videoChannel.port1.postMessage(buf, [buf])
    }

    window.navi.onVideoChunk(handleVideo)
  }, [videoChannel, renderReady])

  // Setup resolution handler
  useEffect(() => {
    if (!window.navi) return

    window.navi.onResolution((res) => {
      console.log('[NaviVideo] Resolution:', res.width, 'x', res.height)
      setResolution(res)
    })
  }, [])

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden'
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain'
        }}
      />
      {!resolution && (
        <div
          style={{
            position: 'absolute',
            color: '#666',
            fontSize: '14px',
            textAlign: 'center'
          }}
        >
          Waiting for navigation video...
        </div>
      )}
    </div>
  )
}

export default NaviVideo
