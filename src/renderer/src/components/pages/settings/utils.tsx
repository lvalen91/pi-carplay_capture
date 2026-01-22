import { SettingsNode } from '../../../routes'
import { ExtraConfig } from '@main/Globals'

export const getValueByPath = (obj: any, path: string) => {
  if (!obj || !path) return undefined

  // Check for flat key first (state uses 'naviScreen.enabled' as literal keys)
  if (path in obj) return obj[path]

  // Fall back to nested traversal for actual nested objects
  return path.split('.').reduce((acc, key) => {
    if (acc == null) return undefined
    return acc[key]
  }, obj)
}

export const setValueByPath = (obj: any, path: string, value: any) => {
  const keys = path.split('.')
  let cur = obj

  keys.slice(0, -1).forEach((k) => {
    if (typeof cur[k] !== 'object' || cur[k] === null) {
      cur[k] = {}
    }
    cur = cur[k]
  })

  cur[keys[keys.length - 1]] = value
}

export const getNodeByPath = (
  root: SettingsNode<ExtraConfig>,
  segments: string[]
): SettingsNode<ExtraConfig> | null => {
  let current: SettingsNode<ExtraConfig> | null = root

  for (let i = 0; i < segments.length; i++) {
    if (!current || current.type !== 'route') return null

    const segment = segments[i]

    const routeChild = current.children.find((c) => c.type === 'route' && c.route === segment)

    if (routeChild) {
      current = routeChild
      continue
    }

    const leafChild = current.children.find((c) => 'path' in c && c.path === segment)

    if (leafChild) {
      return leafChild
    }

    return null
  }

  return current
}
