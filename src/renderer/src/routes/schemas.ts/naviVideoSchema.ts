import { SettingsNode } from '../types'
import { ExtraConfig } from '@main/Globals'

export const naviVideoSchema: SettingsNode<ExtraConfig> = {
  type: 'route',
  route: 'navi-video',
  label: 'Navigation Video',
  path: '',
  children: [
    {
      type: 'checkbox',
      label: 'Enabled',
      path: 'naviScreen.enabled'
    },
    {
      type: 'number',
      label: 'Width',
      path: 'naviScreen.width',
      displayValue: true,
      page: {
        title: 'Width',
        description: 'Navigation video width in pixels (sent to adapter)'
      }
    },
    {
      type: 'number',
      label: 'Height',
      path: 'naviScreen.height',
      displayValue: true,
      page: {
        title: 'Height',
        description: 'Navigation video height in pixels (sent to adapter)'
      }
    },
    {
      type: 'number',
      label: 'FPS',
      path: 'naviScreen.fps',
      displayValue: true,
      page: { title: 'FPS', description: 'Navigation video frames per second' }
    }
  ]
}
