import React, { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Typography,
  TextField,
  Button,
  Paper,
  Divider,
  CircularProgress,
  Alert,
  Chip
} from '@mui/material'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import LinkIcon from '@mui/icons-material/Link'
import LinkOffIcon from '@mui/icons-material/LinkOff'
import RefreshIcon from '@mui/icons-material/Refresh'

declare global {
  interface Window {
    adapterLog?: {
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
      connect: (config?: {
        host?: string
        port?: number
        username?: string
        password?: string
      }) => Promise<{ ok: boolean; error?: string; logFile?: string }>
      disconnect: () => Promise<{ ok: boolean }>
      updateConfig: (config: {
        host?: string
        port?: number
        username?: string
        password?: string
      }) => Promise<{ ok: boolean; config: any }>
    }
  }
}

export const AdapterLog: React.FC = () => {
  const [connected, setConnected] = useState(false)
  const [tailing, setTailing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [logFile, setLogFile] = useState<string | null>(null)

  // Config fields
  const [host, setHost] = useState('192.168.43.1')
  const [port, setPort] = useState(22)
  const [username, setUsername] = useState('root')
  const [password, setPassword] = useState('')

  const refreshStatus = useCallback(async () => {
    if (!window.adapterLog) return
    try {
      const status = await window.adapterLog.getStatus()
      setConnected(status.connected)
      setTailing(status.tailing)
      setLogFile(status.logFile)
      if (status.config) {
        setHost(status.config.host)
        setPort(status.config.port)
        setUsername(status.config.username)
        setPassword(status.config.password)
      }
      setError(null)
    } catch (err) {
      setError('Failed to get adapter log status')
    }
  }, [])

  useEffect(() => {
    refreshStatus().finally(() => setLoading(false))
    // Refresh status every 5 seconds when connected
    const interval = setInterval(() => {
      if (connected) refreshStatus()
    }, 5000)
    return () => clearInterval(interval)
  }, [connected, refreshStatus])

  const handleConnect = async () => {
    if (!window.adapterLog) return
    setLoading(true)
    setError(null)

    try {
      const result = await window.adapterLog.connect({
        host,
        port,
        username,
        password
      })

      if (result.ok) {
        setConnected(true)
        setLogFile(result.logFile || null)
      } else {
        setError(result.error || 'Connection failed')
      }
    } catch (err) {
      setError('Failed to connect to adapter')
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnect = async () => {
    if (!window.adapterLog) return
    setLoading(true)
    setError(null)

    try {
      await window.adapterLog.disconnect()
      setConnected(false)
      setTailing(false)
    } catch (err) {
      setError('Failed to disconnect')
    } finally {
      setLoading(false)
    }
  }

  if (loading && !connected) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>
        Adapter TTYLog Capture
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Capture serial debug logs from the CarPlay adapter via SSH.
        Pulls /tmp/ttyLog and follows new entries in real-time.
        Files are saved to ~/.pi-carplay/adapter-logs/
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Connection Status */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box>
              <Typography variant="subtitle1">
                {connected ? 'Connected' : 'Disconnected'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {connected
                  ? tailing
                    ? 'Tailing adapter logs...'
                    : 'Connected, waiting for data...'
                  : 'Click Connect to start capturing'}
              </Typography>
            </Box>
            {connected && (
              <Chip
                size="small"
                color={tailing ? 'success' : 'warning'}
                label={tailing ? 'Tailing' : 'Idle'}
              />
            )}
          </Box>
          <Button
            variant="contained"
            color={connected ? 'error' : 'primary'}
            startIcon={connected ? <LinkOffIcon /> : <LinkIcon />}
            onClick={connected ? handleDisconnect : handleConnect}
            disabled={loading}
          >
            {connected ? 'Disconnect' : 'Connect'}
          </Button>
        </Box>
      </Paper>

      {/* Connection Settings - only show when not connected */}
      {!connected && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            SSH Connection Settings
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
            Configure SSH connection to your CarPlay adapter
          </Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 2, mb: 2 }}>
            <TextField
              label="Host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              size="small"
              fullWidth
              placeholder="192.168.43.1"
            />
            <TextField
              label="Port"
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              size="small"
              fullWidth
            />
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              size="small"
              fullWidth
              placeholder="Leave empty if none"
            />
          </Box>

          <Divider sx={{ my: 2 }} />

          <Typography variant="caption" color="text.secondary">
            Note: Requires sshpass to be installed on your system.
            The adapter must be reachable via SSH (usually via its WiFi hotspot).
          </Typography>
        </Paper>
      )}

      {/* Log File Info */}
      {logFile && (
        <Paper sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <FolderOpenIcon fontSize="small" />
            <Typography variant="subtitle2">Capture File</Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Button size="small" startIcon={<RefreshIcon />} onClick={refreshStatus}>
              Refresh
            </Button>
          </Box>
          <Typography
            variant="caption"
            sx={{ fontFamily: 'monospace', wordBreak: 'break-all', display: 'block' }}
          >
            {logFile}
          </Typography>
        </Paper>
      )}
    </Box>
  )
}
