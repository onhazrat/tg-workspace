/**
 * A filter tree's text form (CTB-01, PTR-03), shared by the Channel filter's
 * `?channelFilter=` and the Post filter's `?postFilter=`. Each tab says how
 * one of its Conditions prints and how a word or a bound reads back; the
 * operators, the parentheses and the grammar are this module's.
 */

import {
  type BaseCond,
  emptyTree,
  type FilterNode,
  type FilterTree,
  flip,
  type Joiner,
  mapGroups,
  newId,
} from "@/lib/filter-tree"

const WORD = /^[\p{L}\p{N}_.-]+$/u
/** Quoted when not a plain word, with `"` and `\` escaped by a backslash. */
export const quote = (text: string) =>
  WORD.test(text) ? text : `"${text.replace(/["\\]/g, "\\$&")}"`

function nodeText<C extends BaseCond>(
  node: FilterNode<C>,
  condText: (cond: C) => string,
  top: boolean,
): string {
  const not = node.not ? "not " : ""
  if (node.kind === "atom") return `${not}${condText(node.cond)}`
  const inner = node.children
    .map((child) => nodeText(child, condText, false))
    .join(` ${node.op} `)
  if (node.not) return `not (${inner})`
  return top ? inner : `(${inner})`
}

/**
 * The tree as text: `not`, `and`, `or` and parentheses around each tab's
 * Conditions. A root holding one negated group is parenthesised, so it reads
 * back as that child and not as a negated root.
 */
export function printTree<C extends BaseCond>(
  filter: FilterTree<C>,
  condText: (cond: C) => string,
): string {
  const [only] = filter.children
  if (
    !filter.not &&
    filter.children.length === 1 &&
    only.kind === "group" &&
    only.not
  ) {
    return `(${nodeText(only, condText, false)})`
  }
  return nodeText(filter, condText, true)
}

export type Token<C> =
  | { t: "(" | ")" | "and" | "or" | "not" }
  | { t: "atom"; cond: C }

export class ParseError extends Error {}

/** How a tab reads its Conditions back. */
export type TextVocabulary<C> = {
  /** A bound at the start of `rest`, with how many characters it took. */
  bound?: (rest: string) => { cond: C; length: number } | null
  /** A word, with its `key:` prefix if it had one; throws `ParseError` if unknown. */
  word: (prefix: string | undefined, text: string) => C
}

/** `src` as tokens; throws `ParseError` on a character nothing reads. */
export function tokenize<C>(src: string, vocab: TextVocabulary<C>): Token<C>[] {
  const word = /^([a-z]+:)?(?:"((?:[^"\\]|\\.)*)"|([\p{L}\p{N}_.-]+))/iu
  const out: Token<C>[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === "(" || ch === ")") {
      out.push({ t: ch })
      i++
      continue
    }
    if (ch === "!") {
      out.push({ t: "not" })
      i++
      continue
    }
    if (ch === "&" || ch === "|") {
      out.push({ t: ch === "&" ? "and" : "or" })
      i += src[i + 1] === ch ? 2 : 1
      continue
    }
    const bound = vocab.bound?.(src.slice(i))
    if (bound) {
      out.push({ t: "atom", cond: bound.cond })
      i += bound.length
      continue
    }
    const w = word.exec(src.slice(i))
    if (!w) throw new ParseError(`Unexpected ${ch}`)
    const prefix = w[1]?.slice(0, -1).toLowerCase()
    const text = w[2]?.replace(/\\(.)/g, "$1") ?? w[3]
    const lower = text.toLowerCase()
    if (
      !prefix &&
      w[3] &&
      (lower === "and" || lower === "or" || lower === "not")
    ) {
      out.push({ t: lower })
    } else {
      out.push({ t: "atom", cond: vocab.word(prefix, text) })
    }
    i += w[0].length
  }
  return out
}

/** Whether the first token's parenthesis closes on the last token. */
function wholeIsParenthesised<C>(tokens: Token<C>[]): boolean {
  if (tokens[0]?.t !== "(") return false
  let depth = 0
  for (const [i, token] of tokens.entries()) {
    if (token.t === "(") depth++
    if (token.t === ")") depth--
    if (depth === 0) return i === tokens.length - 1
  }
  return false
}

/**
 * Parentheses around one block ("(a)", as a chip put in parentheses by
 * itself prints) do not write their operator. They read back with the
 * opposite of their parent's, which is what wrapping gave them.
 */
const opposeLoneGroups = <C extends BaseCond>(
  root: FilterTree<C>,
): FilterTree<C> =>
  mapGroups(root, (group) => ({
    ...group,
    children: group.children.map((child) =>
      child.kind === "group" && child.children.length === 1
        ? { ...child, op: flip(group.op) }
        : child,
    ),
  }))

/**
 * or-expr  := and-expr ("or" and-expr)*
 * and-expr := primary ("and"? primary)*
 * primary  := "not" primary | atom | "(" or-expr ")"
 * NOT binds tightest, then AND, then OR: "not a or b and c" is
 * "(not a) or (b and c)". Anything that does not parse is `null`, which the
 * tab ignores rather than showing as an error.
 */
export function parseTree<C extends BaseCond>(
  src: string,
  vocab: TextVocabulary<C>,
): FilterTree<C> | null {
  let tokens: Token<C>[]
  try {
    tokens = tokenize(src, vocab)
  } catch (error) {
    if (error instanceof ParseError) return null
    throw error
  }
  if (tokens.length === 0) return emptyTree()
  let i = 0
  const peek = () => tokens[i]?.t
  const group = (op: Joiner, children: FilterNode<C>[]): FilterNode<C> =>
    children.length === 1
      ? children[0]
      : { kind: "group", id: newId(), op, children }

  const primary = (): FilterNode<C> | null => {
    const token = tokens[i++]
    if (token?.t === "not") {
      const inner = primary()
      return inner && { ...inner, not: !inner.not }
    }
    if (token?.t === "atom")
      return { kind: "atom", id: newId(), cond: token.cond }
    if (token?.t !== "(") return null
    const inner = orExpr()
    if (!inner || tokens[i++]?.t !== ")") return null
    return inner.kind === "group"
      ? inner
      : { kind: "group", id: newId(), op: "and", children: [inner] }
  }
  const andExpr = (): FilterNode<C> | null => {
    const parts = [primary()]
    while (["and", "atom", "(", "not"].includes(peek() ?? "")) {
      if (peek() === "and") i++ // two Conditions side by side mean AND
      parts.push(primary())
    }
    return parts.every(Boolean) ? group("and", parts as FilterNode<C>[]) : null
  }
  const orExpr = (): FilterNode<C> | null => {
    const parts = [andExpr()]
    while (peek() === "or") {
      i++
      parts.push(andExpr())
    }
    return parts.every(Boolean) ? group("or", parts as FilterNode<C>[]) : null
  }

  const body = orExpr()
  if (!body || i < tokens.length) return null
  const root: FilterTree<C> =
    body.kind === "group" && !wholeIsParenthesised(tokens)
      ? { ...body, id: "root" }
      : { ...emptyTree<C>(), children: [body] }
  return opposeLoneGroups(root)
}
