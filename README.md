## Pi-Carplay with RAW USB recording and Navi Video

CPC200-CCPA Adapter for firmware 2025.10 supports Navigation Video from Carplay.

With an exploited CPC200-CCPA with telnet or ssh access. Use riddleBoxCfg and set 'AdvanceFeature' from 0 to 1

## Use for usb capture

USB_LOG=1 npm run dev

```
  | USB_LOG=1       | Control packets only (config, touch, commands) |
  | USB_LOG=mic     | Control + microphone (audio TO dongle)         |
  | USB_LOG=speaker | Control + speaker (audio FROM dongle)          |
  | USB_LOG=audio   | Control + mic + speaker                        |
  | USB_LOG=video   | Control + video frames                         |
  | USB_LOG=all     | Everything + auto separate streams             |
  | USB_LOG=combine | Everything - No separte streams                |
```

## Output Files Per Session

```
  ~/.pi-carplay/usb-logs/
  ├── usb-capture-<timestamp>.log           # Human-readable text
  ├── usb-capture-<timestamp>.bin           # Combined binary (all packets)
  ├── usb-capture-<timestamp>.json          # Combined index
  ├── usb-capture-<timestamp>-video.bin     # Video only
  ├── usb-capture-<timestamp>-video.json    # Video index
  ├── usb-capture-<timestamp>-audio-in.bin  # Microphone only (host → dongle)
  ├── usb-capture-<timestamp>-audio-in.json # Microphone index
  ├── usb-capture-<timestamp>-audio-out.bin # Speaker only (dongle → host)
  ├── usb-capture-<timestamp>-audio-out.json# Speaker index
  ├── usb-capture-<timestamp>-control.bin   # Commands/config only
  └── usb-capture-<timestamp>-control.json  # Control index
```

  Stream Naming Convention
```
  | Stream    | Direction | Content                          |
  |-----------|-----------|----------------------------------|
  | video     | IN        | H.264 video frames from dongle   |
  | audio-in  | OUT       | PCM microphone data TO dongle    |
  | audio-out | IN        | PCM speaker data FROM dongle     |
  | control   | Both      | Commands, touch, config, BT/WiFi |
```
