import { createWriteStream, existsSync, mkdirSync, writeFileSync, WriteStream } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { MessageType } from '../messages/common.js'

export interface USBLoggerConfig {
  enabled: boolean
  logDir?: string
  logToConsole?: boolean
  logToFile?: boolean          // Text/hex log file
  logToBinary?: boolean        // Binary capture + JSON index
  separateStreams?: boolean    // Write separate files per stream type
  includeVideoData?: boolean   // Video frames are large, option to skip
  includeMicData?: boolean     // Outgoing microphone audio (host → dongle)
  includeSpeakerData?: boolean // Incoming speaker audio (dongle → host)
  includeAudioData?: boolean   // Shorthand: enables BOTH mic and speaker
  includeControlData?: boolean // Control/config packets (non-audio/video)
  maxPayloadHexBytes?: number  // Limit hex dump size (0 = unlimited)
}

const DEFAULT_CONFIG: USBLoggerConfig = {
  enabled: false,
  logToConsole: true,
  logToFile: true,
  logToBinary: true,          // Enable binary capture by default
  separateStreams: true,      // Write separate files by default
  includeVideoData: false,    // Skip video by default (large)
  includeMicData: false,      // Skip mic by default (frequent)
  includeSpeakerData: false,  // Skip speaker by default (frequent)
  includeAudioData: false,    // Shorthand for both
  includeControlData: true,   // Always include control packets
  maxPayloadHexBytes: 256     // Show first 256 bytes of payload
}

// Stream types for separate file capture
type StreamType = 'video' | 'audio-in' | 'audio-out' | 'control'

// Packet direction constants
const DIR_IN = 0
const DIR_OUT = 1

export interface PacketIndexEntry {
  seq: number
  dir: 'IN' | 'OUT'
  type: number
  typeName: string
  timestampMs: number
  offset: number
  length: number
}

export interface SessionIndex {
  version: string
  session: {
    id: string
    started: string
    ended?: string
    durationMs?: number
  }
  config: {
    includeVideoData: boolean
    includeAudioData: boolean
    includeMicData: boolean
    includeSpeakerData: boolean
  }
  packets: PacketIndexEntry[]
  stats: {
    packetsIn: number
    packetsOut: number
    bytesIn: number
    bytesOut: number
  }
}

const MESSAGE_TYPE_NAMES: Record<number, string> = {
  [MessageType.Open]: 'Open',
  [MessageType.Plugged]: 'Plugged',
  [MessageType.Phase]: 'Phase',
  [MessageType.Unplugged]: 'Unplugged',
  [MessageType.Touch]: 'Touch',
  [MessageType.VideoData]: 'VideoData',
  [MessageType.AudioData]: 'AudioData',
  [MessageType.Command]: 'Command',
  [MessageType.LogoType]: 'LogoType',
  [MessageType.DisconnectPhone]: 'DisconnectPhone',
  [MessageType.CloseDongle]: 'CloseDongle',
  [MessageType.BluetoothAddress]: 'BluetoothAddress',
  [MessageType.BluetoothPIN]: 'BluetoothPIN',
  [MessageType.BluetoothDeviceName]: 'BluetoothDeviceName',
  [MessageType.WifiDeviceName]: 'WifiDeviceName',
  [MessageType.BluetoothPairedList]: 'BluetoothPairedList',
  [MessageType.ManufacturerInfo]: 'ManufacturerInfo',
  [MessageType.MultiTouch]: 'MultiTouch',
  [MessageType.HiCarLink]: 'HiCarLink',
  [MessageType.BoxSettings]: 'BoxSettings',
  [MessageType.MediaData]: 'MediaData',
  [MessageType.AltVideoData]: 'AltVideoData',
  [MessageType.NaviVideoData]: 'NaviVideoData',
  [MessageType.SendFile]: 'SendFile',
  [MessageType.HeartBeat]: 'HeartBeat',
  [MessageType.UpdateProgress]: 'UpdateProgress',
  [MessageType.UpdateState]: 'UpdateState',
  [MessageType.SoftwareVersion]: 'SoftwareVersion',
  [MessageType.PeerBluetoothAddress]: 'PeerBluetoothAddress',
  [MessageType.PeerBluetoothAddressAlt]: 'PeerBluetoothAddressAlt',
  [MessageType.UiHidePeerInfo]: 'UiHidePeerInfo',
  [MessageType.UiBringToForeground]: 'UiBringToForeground',
  [MessageType.VendorCarPlaySessionBlob]: 'VendorCarPlaySessionBlob',
  [MessageType.NaviFocusRequest]: 'NaviFocusRequest',
  [MessageType.NaviFocusRelease]: 'NaviFocusRelease'
}

// Per-stream state
interface StreamState {
  stream: WriteStream | null
  offset: number
  packetIndex: PacketIndexEntry[]
  packetCount: number
  byteCount: number
}

// Format timestamp as YYMMMDD_HH-MM-SS (e.g., 25JAN13_19-45-01)
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

export class USBLogger {
  private config: USBLoggerConfig
  private fileStream: WriteStream | null = null
  private binaryStream: WriteStream | null = null
  private sessionStart: number = Date.now()
  private sessionId: string = ''
  private packetCount = { in: 0, out: 0 }
  private byteCount = { in: 0, out: 0 }
  private binaryOffset: number = 0
  private packetIndex: PacketIndexEntry[] = []
  private indexFilePath: string = ''
  private logDir: string = ''

  // Separate stream states
  private streams: Record<StreamType, StreamState> = {
    'video': { stream: null, offset: 0, packetIndex: [], packetCount: 0, byteCount: 0 },
    'audio-in': { stream: null, offset: 0, packetIndex: [], packetCount: 0, byteCount: 0 },
    'audio-out': { stream: null, offset: 0, packetIndex: [], packetCount: 0, byteCount: 0 },
    'control': { stream: null, offset: 0, packetIndex: [], packetCount: 0, byteCount: 0 }
  }

  constructor(config: Partial<USBLoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    if (this.config.enabled && this.config.logToFile) {
      this.initFileStream()
    }
  }

  private initFileStream() {
    this.logDir = this.config.logDir || join(homedir(), '.pi-carplay', 'usb-capture')
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true })
    }
    const timestamp = formatCaptureTimestamp()
    this.sessionId = timestamp
    this.sessionStart = Date.now()

    // Text log file
    const logFile = join(this.logDir, `picarplay-capture_${timestamp}.log`)
    this.fileStream = createWriteStream(logFile, { flags: 'a' })

    const header = [
      '================================================================================',
      `USB PACKET CAPTURE - Pi-Carplay`,
      `Session started: ${new Date().toISOString()}`,
      `Log file: ${logFile}`,
      '================================================================================',
      ''
    ].join('\n')

    this.writeLog(header)
    console.log(`[USBLogger] Text log: ${logFile}`)

    // Binary capture file + JSON index (combined)
    if (this.config.logToBinary) {
      const binFile = join(this.logDir, `picarplay-capture_${timestamp}.bin`)
      this.indexFilePath = join(this.logDir, `picarplay-capture_${timestamp}.json`)
      this.binaryStream = createWriteStream(binFile, { flags: 'a' })
      this.binaryOffset = 0
      this.packetIndex = []
      console.log(`[USBLogger] Binary capture: ${binFile}`)
      console.log(`[USBLogger] Packet index: ${this.indexFilePath}`)
    }

    // Separate stream files
    if (this.config.separateStreams) {
      const streamTypes: StreamType[] = ['video', 'audio-in', 'audio-out', 'control']
      for (const streamType of streamTypes) {
        const binFile = join(this.logDir, `picarplay-capture_${timestamp}-${streamType}.bin`)
        this.streams[streamType] = {
          stream: createWriteStream(binFile, { flags: 'a' }),
          offset: 0,
          packetIndex: [],
          packetCount: 0,
          byteCount: 0
        }
      }
      console.log(`[USBLogger] Separate streams: video, audio-in, audio-out, control`)
    }
  }

  private isVideoMessage(msgType: number): boolean {
    return msgType === MessageType.VideoData ||
           msgType === MessageType.NaviVideoData ||
           msgType === MessageType.AltVideoData
  }

  private getStreamType(direction: number, msgType: number): StreamType {
    if (this.isVideoMessage(msgType)) {
      return 'video'
    } else if (msgType === MessageType.AudioData) {
      // IN = from dongle = speaker output, OUT = to dongle = microphone input
      return direction === DIR_IN ? 'audio-out' : 'audio-in'
    } else {
      return 'control'
    }
  }

  private writeBinaryPacket(direction: number, msgType: number, data: Buffer) {
    const timestampMs = Date.now() - this.sessionStart

    // Write raw protocol packets directly (no capture prefix)
    // This matches carlink_native format for cross-compatibility
    // Metadata (direction, timestamp, type) is stored in JSON index only

    const seq = this.packetCount.in + this.packetCount.out
    const indexEntry: PacketIndexEntry = {
      seq,
      dir: direction === DIR_IN ? 'IN' : 'OUT',
      type: msgType,
      typeName: this.getMessageTypeName(msgType),
      timestampMs,
      offset: this.binaryOffset,
      length: data.length
    }

    // Write to combined binary stream (raw packet data only)
    if (this.binaryStream) {
      this.binaryStream.write(data)
      this.packetIndex.push({ ...indexEntry, offset: this.binaryOffset })
      this.binaryOffset += data.length
    }

    // Write to separate stream file (raw packet data only)
    if (this.config.separateStreams) {
      const streamType = this.getStreamType(direction, msgType)
      const streamState = this.streams[streamType]
      if (streamState.stream) {
        streamState.stream.write(data)
        streamState.packetIndex.push({ ...indexEntry, offset: streamState.offset })
        streamState.offset += data.length
        streamState.packetCount++
        streamState.byteCount += data.length
      }
    }
  }

  /**
   * Enable capture with optional config update
   * @param config - Optional config overrides
   * @param startNewSession - If true, starts a new capture session (closes any existing)
   */
  enable(config?: Partial<USBLoggerConfig>, startNewSession = true) {
    if (config) {
      this.config = { ...this.config, ...config }
    }
    this.config.enabled = true

    if (startNewSession) {
      // Close any existing session first
      if (this.fileStream || this.binaryStream) {
        this.endSession()
      }
      // Start fresh session
      if (this.config.logToFile) {
        this.initFileStream()
      }
    } else if (this.config.logToFile && !this.fileStream) {
      this.initFileStream()
    }
    console.log('[USBLogger] Packet capture ENABLED')
  }

  /**
   * Disable capture and optionally end the current session
   * @param endCurrentSession - If true, closes files and writes indices
   */
  disable(endCurrentSession = false) {
    this.config.enabled = false
    if (endCurrentSession) {
      this.endSession()
    }
    console.log('[USBLogger] Packet capture DISABLED')
  }

  /**
   * End the current capture session - closes files and writes JSON indices
   * Can be called on adapter disconnect, app quit, or manual stop
   */
  endSession() {
    this.close() // Reuse existing close logic
  }

  /**
   * Start a new capture session (closes any existing first)
   */
  startSession() {
    if (this.fileStream || this.binaryStream) {
      this.endSession()
    }
    if (this.config.logToFile || this.config.logToBinary) {
      this.initFileStream()
    }
    // Reset counters
    this.packetCount = { in: 0, out: 0 }
    this.byteCount = { in: 0, out: 0 }
    console.log('[USBLogger] New capture session started')
  }

  isEnabled(): boolean {
    return this.config.enabled
  }

  /**
   * Get current configuration (for UI display)
   */
  getConfig(): USBLoggerConfig {
    return { ...this.config }
  }

  /**
   * Check if a session is currently active (files open)
   */
  hasActiveSession(): boolean {
    return this.fileStream !== null || this.binaryStream !== null
  }

  /**
   * Update config without changing enabled state
   */
  updateConfig(config: Partial<USBLoggerConfig>) {
    const wasEnabled = this.config.enabled
    this.config = { ...this.config, ...config }
    this.config.enabled = wasEnabled // Preserve enabled state
  }

  private writeLog(message: string) {
    if (this.config.logToConsole) {
      console.log(message)
    }
    if (this.config.logToFile && this.fileStream) {
      this.fileStream.write(message + '\n')
    }
  }

  private getTimestamp(): string {
    const now = Date.now()
    const elapsed = ((now - this.sessionStart) / 1000).toFixed(3)
    return `[${elapsed.padStart(10)}s]`
  }

  private hexDump(buffer: Buffer, maxBytes?: number): string {
    // 0 or undefined means unlimited
    const configLimit = this.config.maxPayloadHexBytes
    const effectiveLimit = maxBytes !== undefined
      ? maxBytes
      : (configLimit === 0 || configLimit === undefined)
        ? buffer.length
        : configLimit

    const limit = Math.min(buffer.length, effectiveLimit)
    const data = buffer.subarray(0, limit)
    const lines: string[] = []

    for (let i = 0; i < data.length; i += 16) {
      const chunk = data.subarray(i, Math.min(i + 16, data.length))
      const hex = Array.from(chunk)
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' ')
      const ascii = Array.from(chunk)
        .map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.')
        .join('')
      lines.push(`  ${i.toString(16).padStart(4, '0')}: ${hex.padEnd(48)} |${ascii}|`)
    }

    if (buffer.length > limit) {
      lines.push(`  ... (${buffer.length - limit} more bytes truncated)`)
    }

    return lines.join('\n')
  }

  private getMessageTypeName(type: number): string {
    return MESSAGE_TYPE_NAMES[type] || `Unknown(0x${type.toString(16)})`
  }

  private shouldLogIncoming(msgType: number): boolean {
    if (!this.config.enabled) return false
    // Filter all video types (VideoData, NaviVideoData, AltVideoData)
    if (this.isVideoMessage(msgType) && !this.config.includeVideoData) return false
    if (msgType === MessageType.AudioData) {
      // Incoming audio = speaker data from dongle
      if (!this.config.includeSpeakerData && !this.config.includeAudioData) return false
    }
    return true
  }

  private shouldLogOutgoing(msgType: number): boolean {
    if (!this.config.enabled) return false
    // Filter all video types (VideoData, NaviVideoData, AltVideoData)
    if (this.isVideoMessage(msgType) && !this.config.includeVideoData) return false
    if (msgType === MessageType.AudioData) {
      // Outgoing audio = microphone data to dongle
      if (!this.config.includeMicData && !this.config.includeAudioData) return false
    }
    return true
  }

  /**
   * Log incoming USB packet (from dongle to host)
   */
  logIncoming(header: Buffer, payload?: Buffer) {
    if (!this.config.enabled) return

    // Parse header to get message type
    const msgType = header.length >= 12 ? header.readUInt32LE(8) : 0
    if (!this.shouldLogIncoming(msgType)) return

    this.packetCount.in++
    this.byteCount.in += header.length + (payload?.length || 0)

    // Write to binary capture (full packet: header + payload)
    if (this.config.logToBinary) {
      const fullPacket = payload && payload.length > 0
        ? Buffer.concat([header, payload])
        : header
      this.writeBinaryPacket(DIR_IN, msgType, fullPacket)
    }

    // Write to text log
    const typeName = this.getMessageTypeName(msgType)
    const payloadLen = payload?.length || 0

    const lines = [
      `${this.getTimestamp()} <<< IN  #${this.packetCount.in} | ${typeName} | ${header.length + payloadLen} bytes`,
      `  Header (${header.length} bytes):`,
      this.hexDump(header, 16),
    ]

    if (payload && payload.length > 0) {
      lines.push(`  Payload (${payload.length} bytes):`)
      lines.push(this.hexDump(payload))
    }

    lines.push('')
    this.writeLog(lines.join('\n'))
  }

  /**
   * Log outgoing USB packet (from host to dongle)
   */
  logOutgoing(data: Buffer, messageName?: string) {
    if (!this.config.enabled) return

    // Parse message type from header if present
    const msgType = data.length >= 12 ? data.readUInt32LE(8) : 0
    if (!this.shouldLogOutgoing(msgType)) return

    this.packetCount.out++
    this.byteCount.out += data.length

    // Write to binary capture
    if (this.config.logToBinary) {
      this.writeBinaryPacket(DIR_OUT, msgType, data)
    }

    // Write to text log
    const typeName = messageName || this.getMessageTypeName(msgType)

    const lines = [
      `${this.getTimestamp()} >>> OUT #${this.packetCount.out} | ${typeName} | ${data.length} bytes`,
      `  Data:`,
      this.hexDump(data),
      ''
    ]

    this.writeLog(lines.join('\n'))
  }

  /**
   * Log a marker/annotation in the capture stream
   */
  logMarker(message: string) {
    if (!this.config.enabled) return
    this.writeLog(`${this.getTimestamp()} --- ${message} ---\n`)
  }

  /**
   * Get statistics about captured packets
   */
  getStats() {
    return {
      packetsIn: this.packetCount.in,
      packetsOut: this.packetCount.out,
      bytesIn: this.byteCount.in,
      bytesOut: this.byteCount.out,
      elapsed: Date.now() - this.sessionStart
    }
  }

  /**
   * Log current statistics
   */
  logStats() {
    const stats = this.getStats()
    const elapsed = (stats.elapsed / 1000).toFixed(1)
    this.writeLog([
      '--- STATISTICS ---',
      `  Elapsed: ${elapsed}s`,
      `  Packets IN:  ${stats.packetsIn} (${stats.bytesIn} bytes)`,
      `  Packets OUT: ${stats.packetsOut} (${stats.bytesOut} bytes)`,
      `  Total: ${stats.packetsIn + stats.packetsOut} packets, ${stats.bytesIn + stats.bytesOut} bytes`,
      ''
    ].join('\n'))
  }

  /**
   * Close the logger and flush files
   */
  close() {
    if (this.config.enabled) {
      this.logStats()
      this.writeLog(`\n[USBLogger] Session ended: ${new Date().toISOString()}\n`)
    }

    const endTime = new Date().toISOString()
    const durationMs = Date.now() - this.sessionStart

    // Write combined JSON index file
    if (this.config.logToBinary && this.indexFilePath && this.packetIndex.length > 0) {
      const sessionIndex: SessionIndex = {
        version: '1.0',
        session: {
          id: this.sessionId,
          started: new Date(this.sessionStart).toISOString(),
          ended: endTime,
          durationMs
        },
        config: {
          includeVideoData: this.config.includeVideoData || false,
          includeAudioData: this.config.includeAudioData || false,
          includeMicData: this.config.includeMicData || false,
          includeSpeakerData: this.config.includeSpeakerData || false
        },
        packets: this.packetIndex,
        stats: {
          packetsIn: this.packetCount.in,
          packetsOut: this.packetCount.out,
          bytesIn: this.byteCount.in,
          bytesOut: this.byteCount.out
        }
      }

      try {
        writeFileSync(this.indexFilePath, JSON.stringify(sessionIndex, null, 2))
        console.log(`[USBLogger] Wrote packet index: ${this.indexFilePath}`)
      } catch (err) {
        console.error('[USBLogger] Failed to write index file:', err)
      }
    }

    // Write separate stream JSON index files
    if (this.config.separateStreams) {
      const streamTypes: StreamType[] = ['video', 'audio-in', 'audio-out', 'control']
      for (const streamType of streamTypes) {
        const streamState = this.streams[streamType]
        if (streamState.packetIndex.length > 0) {
          const indexPath = join(this.logDir, `picarplay-capture_${this.sessionId}-${streamType}.json`)
          const streamIndex: SessionIndex = {
            version: '1.0',
            session: {
              id: `${this.sessionId}-${streamType}`,
              started: new Date(this.sessionStart).toISOString(),
              ended: endTime,
              durationMs
            },
            config: {
              includeVideoData: streamType === 'video',
              includeAudioData: streamType.startsWith('audio'),
              includeMicData: streamType === 'audio-in',
              includeSpeakerData: streamType === 'audio-out'
            },
            packets: streamState.packetIndex,
            stats: {
              packetsIn: streamState.packetIndex.filter(p => p.dir === 'IN').length,
              packetsOut: streamState.packetIndex.filter(p => p.dir === 'OUT').length,
              bytesIn: streamState.packetIndex.filter(p => p.dir === 'IN').reduce((sum, p) => sum + p.length, 0),
              bytesOut: streamState.packetIndex.filter(p => p.dir === 'OUT').reduce((sum, p) => sum + p.length, 0)
            }
          }

          try {
            writeFileSync(indexPath, JSON.stringify(streamIndex, null, 2))
            console.log(`[USBLogger] Wrote ${streamType} index: ${indexPath} (${streamState.packetCount} packets)`)
          } catch (err) {
            console.error(`[USBLogger] Failed to write ${streamType} index:`, err)
          }
        }

        // Close stream
        if (streamState.stream) {
          streamState.stream.end()
          streamState.stream = null
        }
      }
    }

    // Close main streams
    if (this.fileStream) {
      this.fileStream.end()
      this.fileStream = null
    }
    if (this.binaryStream) {
      this.binaryStream.end()
      this.binaryStream = null
    }

    // Reset state
    this.packetIndex = []
    this.binaryOffset = 0
    for (const streamType of Object.keys(this.streams) as StreamType[]) {
      this.streams[streamType] = { stream: null, offset: 0, packetIndex: [], packetCount: 0, byteCount: 0 }
    }
  }

  /**
   * Get the current session's file paths
   */
  getSessionFiles() {
    if (!this.sessionId) return null
    return {
      textLog: join(this.logDir, `picarplay-capture_${this.sessionId}.log`),
      binaryCapture: join(this.logDir, `picarplay-capture_${this.sessionId}.bin`),
      jsonIndex: join(this.logDir, `picarplay-capture_${this.sessionId}.json`)
    }
  }
}

// Global singleton instance for easy access
export const usbLogger = new USBLogger()
