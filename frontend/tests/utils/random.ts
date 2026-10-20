export const randomEmail = () =>
  `test_${crypto.randomUUID().slice(0, 8)}@example.com`

export const randomTeamName = () =>
  `Team ${crypto.randomUUID().slice(0, 8)}`

export const randomPassword = () => crypto.randomUUID()

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
