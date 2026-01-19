import { EventEmitter } from 'events'
import { spawn, ChildProcess } from 'child_process'
import { createWriteStream, WriteStream, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface AdapterLogConfig {
  host: string
  port: number
  username: string
  password: string
  remoteLogPath: string
}

const DEFAULT_CONFIG: AdapterLogConfig = {
  host: '192.168.43.1',
  port: 22,
  username: 'root',
  password: '',
  remoteLogPath: '/tmp/ttyLog'
}

// Format timestamp as YYMMMDD_HH-MM-SS (e.g., 25JAN13_19-45-01) - matches USBLogger format
function formatCaptureTimestamp(date: Date = new Date()): string {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  const yy = String(date.getFullYear()).slice(-2)
  const mmm = months[date.getMonth()]
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${yy}${mmm}${dd}_${hh}-${min}-${ss}`
}

export class AdapterLogService extends EventEmitter {
  private config: AdapterLogConfig
  private sshProcess: ChildProcess | null = null
  private logFileStream: WriteStream | null = null
  private logFilePath: string | null = null
  private isConnected = false
  private isTailing = false
  private buffer = ''

  constructor(config: Partial<AdapterLogConfig> = {}) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  private getLogDir(): string {
    const logDir = join(homedir(), '.pi-carplay', 'adapter-logs')
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true })
    }
    return logDir
  }

  private generateLogFileName(): string {
    return `adapter-ttylog_${formatCaptureTimestamp()}.log`
  }

  async connect(): Promise<{ ok: boolean; error?: string; logFile?: string }> {
    if (this.isConnected) {
      return { ok: true, logFile: this.logFilePath ?? undefined }
    }

    try {
      // Create local log file
      const logDir = this.getLogDir()
      const logFileName = this.generateLogFileName()
      this.logFilePath = join(logDir, logFileName)
      this.logFileStream = createWriteStream(this.logFilePath, { flags: 'a' })

      // Write header
      const header = `================================================================================
ADAPTER LOG CAPTURE
Connected to: ${this.config.host}:${this.config.port}
Remote log: ${this.config.remoteLogPath}
Started: ${new Date().toISOString()}
================================================================================

`
      this.logFileStream.write(header)
      this.emit('log-line', header)

      // First, pull existing log content using sshpass + ssh + cat
      console.log('[AdapterLogService] Pulling existing log content...')
      await this.pullExistingLog()

      // Then start tailing
      console.log('[AdapterLogService] Starting tail...')
      await this.startTail()

      this.isConnected = true
      this.emit('connected', { logFile: this.logFilePath })

      return { ok: true, logFile: this.logFilePath }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error('[AdapterLogService] Connection failed:', errorMsg)
      this.cleanup()
      return { ok: false, error: errorMsg }
    }
  }

  private async pullExistingLog(): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = this.buildSshpassArgs(['cat', this.config.remoteLogPath])

      const proc = spawn('sshpass', args, {
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let stdout = ''
      let stderr = ''

      proc.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString()
        stdout += chunk
        this.logFileStream?.write(chunk)
        this.emitLines(chunk)
      })

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        if (code === 0 || stdout.length > 0) {
          console.log(`[AdapterLogService] Pulled ${stdout.length} bytes of existing log`)
          resolve()
        } else {
          // Don't fail if file doesn't exist yet, just continue
          if (stderr.includes('No such file')) {
            console.log('[AdapterLogService] Remote log file does not exist yet')
            resolve()
          } else {
            reject(new Error(`Failed to pull log: ${stderr}`))
          }
        }
      })

      proc.on('error', (err) => {
        reject(err)
      })

      // Timeout after 10 seconds
      setTimeout(() => {
        proc.kill()
        if (stdout.length > 0) {
          resolve()
        } else {
          reject(new Error('Timeout pulling existing log'))
        }
      }, 10000)
    })
  }

  private async startTail(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use tail -f to follow the log file
      const args = this.buildSshpassArgs(['tail', '-f', '-n', '0', this.config.remoteLogPath])

      this.sshProcess = spawn('sshpass', args, {
        stdio: ['ignore', 'pipe', 'pipe']
      })

      this.isTailing = true

      this.sshProcess.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString()
        this.logFileStream?.write(chunk)
        this.emitLines(chunk)
      })

      this.sshProcess.stderr?.on('data', (data: Buffer) => {
        const errStr = data.toString()
        console.error('[AdapterLogService] SSH stderr:', errStr)
        this.emit('error', errStr)
      })

      this.sshProcess.on('close', (code) => {
        console.log(`[AdapterLogService] Tail process exited with code ${code}`)
        this.isTailing = false
        if (this.isConnected) {
          this.emit('disconnected', { code })
        }
      })

      this.sshProcess.on('error', (err) => {
        console.error('[AdapterLogService] SSH process error:', err)
        this.emit('error', err.message)
        reject(err)
      })

      // Consider connected once we start tailing
      setTimeout(() => resolve(), 500)
    })
  }

  private buildSshpassArgs(remoteCmd: string[]): string[] {
    const args: string[] = []

    // Add password via -p option (empty string for no password)
    args.push('-p', this.config.password)

    // SSH command with options
    args.push('ssh')
    args.push('-o', 'StrictHostKeyChecking=no')
    args.push('-o', 'UserKnownHostsFile=/dev/null')
    args.push('-o', 'ConnectTimeout=5')
    args.push('-o', 'LogLevel=ERROR')
    args.push('-p', String(this.config.port))
    args.push(`${this.config.username}@${this.config.host}`)

    // Remote command
    args.push(...remoteCmd)

    return args
  }

  private emitLines(chunk: string): void {
    this.buffer += chunk
    const lines = this.buffer.split('\n')

    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.trim()) {
        this.emit('log-line', line)
      }
    }
  }

  async disconnect(): Promise<void> {
    console.log('[AdapterLogService] Disconnecting...')
    this.cleanup()
    this.emit('disconnected', { code: 0 })
  }

  private cleanup(): void {
    this.isConnected = false
    this.isTailing = false

    if (this.sshProcess) {
      try {
        this.sshProcess.kill('SIGTERM')
      } catch {}
      this.sshProcess = null
    }

    if (this.logFileStream) {
      try {
        this.logFileStream.write(`\n================================================================================
Log capture ended: ${new Date().toISOString()}
================================================================================\n`)
        this.logFileStream.end()
      } catch {}
      this.logFileStream = null
    }
  }

  getStatus(): {
    connected: boolean
    tailing: boolean
    logFile: string | null
    config: AdapterLogConfig
  } {
    return {
      connected: this.isConnected,
      tailing: this.isTailing,
      logFile: this.logFilePath,
      config: this.config
    }
  }

  updateConfig(config: Partial<AdapterLogConfig>): void {
    this.config = { ...this.config, ...config }
  }

  getLogFilePath(): string | null {
    return this.logFilePath
  }
}
