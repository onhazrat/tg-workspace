export const GROUP_TAG_PREFIX = "group:"

export const toVirtualGroupTagName = (groupName: string): string =>
  `${GROUP_TAG_PREFIX}${groupName}`

export const isVirtualGroupTag = (tagName: string): boolean =>
  tagName.trim().toLowerCase().startsWith(GROUP_TAG_PREFIX)
