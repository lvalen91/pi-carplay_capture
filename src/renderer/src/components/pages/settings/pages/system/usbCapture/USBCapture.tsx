import React, { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Typography,
  Switch,
  FormControlLabel,
  Checkbox,
  Button,
  Paper,
  Divider,
  CircularProgress,
  Alert
} from '@mui/material'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import StopIcon from '@mui/icons-material/Stop'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import RefreshIcon from '@mui/icons-material/Refresh'

declare global {
  interface Window {
    usbCapture?: {
      getStatus: () => Promise<{
        enabled: boolean
        hasActiveSession: boolean
        config: {
          enabled: boolean
          includeVideoData?: boolean
          includeMicData?: boolean
          includeSpeakerData?: boolean
          includeAudioData?: boolean
          separateStreams?: boolean
        }
        stats: {
          packetsIn: number
          packetsOut: number
          bytesIn: number
          bytesOut: number
          elapsed: number
        }
        sessionFiles: { textLog: string; binaryCapture: string; jsonIndex: string } | null
      }>
      enable: (options?: {
        config?: {
          includeVideoData?: boolean
          includeMicData?: boolean
          includeSpeakerData?: boolean
          includeAudioData?: boolean
          separateStreams?: boolean
        }
        resetAdapter?: boolean
      }) => Promise<{ ok: boolean; enabled: boolean; sessionFiles: any }>
      disable: () => Promise<{ ok: boolean; enabled: boolean; finalStats: any; sessionFiles: any }>
      getStats: () => Promise<any>
      endSession: () => Promise<any>
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

export const USBCapture: React.FC = () => {
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasActiveSession, setHasActiveSession] = useState(false)
  const [stats, setStats] = useState({ packetsIn: 0, packetsOut: 0, bytesIn: 0, bytesOut: 0, elapsed: 0 })
  const [sessionFiles, setSessionFiles] = useState<{ textLog: string; binaryCapture: string; jsonIndex: string } | null>(null)

  // Capture options
  const [includeVideo, setIncludeVideo] = useState(false)
  const [includeAudio, setIncludeAudio] = useState(false)
  const [separateStreams, setSeparateStreams] = useState(true)
  const [resetAdapter, setResetAdapter] = useState(true)

  const refreshStatus = useCallback(async () => {
    if (!window.usbCapture) return
    try {
      const status = await window.usbCapture.getStatus()
      setEnabled(status.enabled)
      setHasActiveSession(status.hasActiveSession)
      setStats(status.stats)
      setSessionFiles(status.sessionFiles)
      if (status.config) {
        setIncludeVideo(status.config.includeVideoData ?? false)
        setIncludeAudio(status.config.includeAudioData ?? false)
        setSeparateStreams(status.config.separateStreams ?? true)
      }
      setError(null)
    } catch (err) {
      setError('Failed to get capture status')
    }
  }, [])

  useEffect(() => {
    refreshStatus().finally(() => setLoading(false))
    // Refresh stats every 2 seconds when enabled
    const interval = setInterval(() => {
      if (enabled) refreshStatus()
    }, 2000)
    return () => clearInterval(interval)
  }, [enabled, refreshStatus])

  const handleToggle = async () => {
    if (!window.usbCapture) return
    setLoading(true)
    setError(null)

    try {
      if (!enabled) {
        // Enable capture
        await window.usbCapture.enable({
          config: {
            includeVideoData: includeVideo,
            includeAudioData: includeAudio,
            separateStreams
          },
          resetAdapter
        })
        setEnabled(true)
      } else {
        // Disable capture
        const result = await window.usbCapture.disable()
        setEnabled(false)
        setStats(result.finalStats)
        setSessionFiles(result.sessionFiles)
      }
      await refreshStatus()
    } catch (err) {
      setError(`Failed to ${enabled ? 'disable' : 'enable'} capture`)
    } finally {
      setLoading(false)
    }
  }

  const handleEndSession = async () => {
    if (!window.usbCapture) return
    setLoading(true)
    try {
      const result = await window.usbCapture.endSession()
      setStats(result.stats)
      setSessionFiles(result.sessionFiles)
      setHasActiveSession(false)
    } catch (err) {
      setError('Failed to end session')
    } finally {
      setLoading(false)
    }
  }

  if (loading && !enabled) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>
        USB Packet Capture
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Capture USB communication with the CarPlay adapter for debugging and protocol analysis.
        Files are saved to ~/.pi-carplay/usb-capture/
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Main Toggle */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="subtitle1">
              {enabled ? 'Capture Active' : 'Capture Disabled'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {enabled ? 'Recording USB packets...' : 'Click to start capturing'}
            </Typography>
          </Box>
          <Button
            variant="contained"
            color={enabled ? 'error' : 'primary'}
            startIcon={enabled ? <StopIcon /> : <PlayArrowIcon />}
            onClick={handleToggle}
            disabled={loading}
          >
            {enabled ? 'Stop Capture' : 'Start Capture'}
          </Button>
        </Box>
      </Paper>

      {/* Capture Options - only show when not capturing */}
      {!enabled && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Capture Options
          </Typography>

          <FormControlLabel
            control={
              <Checkbox
                checked={resetAdapter}
                onChange={(e) => setResetAdapter(e.target.checked)}
              />
            }
            label={
              <Box>
                <Typography variant="body2">Reset adapter on start</Typography>
                <Typography variant="caption" color="text.secondary">
                  Recommended: Captures full initialization sequence
                </Typography>
              </Box>
            }
          />

          <Divider sx={{ my: 1 }} />

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Data to capture (control packets always included):
          </Typography>

          <FormControlLabel
            control={
              <Checkbox
                checked={includeAudio}
                onChange={(e) => setIncludeAudio(e.target.checked)}
              />
            }
            label="Include audio data (mic + speaker)"
          />

          <FormControlLabel
            control={
              <Checkbox
                checked={includeVideo}
                onChange={(e) => setIncludeVideo(e.target.checked)}
              />
            }
            label="Include video data (large files)"
          />

          <FormControlLabel
            control={
              <Checkbox
                checked={separateStreams}
                onChange={(e) => setSeparateStreams(e.target.checked)}
              />
            }
            label="Separate stream files (video, audio-in, audio-out, control)"
          />
        </Paper>
      )}

      {/* Session Stats */}
      {(enabled || hasActiveSession) && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="subtitle2">Session Statistics</Typography>
            <Button size="small" startIcon={<RefreshIcon />} onClick={refreshStatus}>
              Refresh
            </Button>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">Packets In</Typography>
              <Typography variant="body2">{stats.packetsIn.toLocaleString()}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Packets Out</Typography>
              <Typography variant="body2">{stats.packetsOut.toLocaleString()}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Data In</Typography>
              <Typography variant="body2">{formatBytes(stats.bytesIn)}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Data Out</Typography>
              <Typography variant="body2">{formatBytes(stats.bytesOut)}</Typography>
            </Box>
            <Box sx={{ gridColumn: 'span 2' }}>
              <Typography variant="caption" color="text.secondary">Duration</Typography>
              <Typography variant="body2">{formatDuration(stats.elapsed)}</Typography>
            </Box>
          </Box>

          {enabled && (
            <Button
              size="small"
              variant="outlined"
              sx={{ mt: 2 }}
              onClick={handleEndSession}
            >
              End Session (keep capture enabled)
            </Button>
          )}
        </Paper>
      )}

      {/* Session Files */}
      {sessionFiles && (
        <Paper sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <FolderOpenIcon fontSize="small" />
            <Typography variant="subtitle2">Capture Files</Typography>
          </Box>
          <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', display: 'block' }}>
            {sessionFiles.textLog}
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', display: 'block' }}>
            {sessionFiles.binaryCapture}
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', display: 'block' }}>
            {sessionFiles.jsonIndex}
          </Typography>
        </Paper>
      )}
    </Box>
  )
}
