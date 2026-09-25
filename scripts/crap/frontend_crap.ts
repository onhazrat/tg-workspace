// Per-function CRAP rows for frontend/src: ESLint-style cyclomatic complexity
// from the TS AST, line coverage from bun's lcov. Nested functions are scored
// on their own and their lines don't count toward the enclosing function,
// which is how radon treats closures on the backend.
//
// Any extra lcov files are Playwright's (frontend/tests/fixtures.ts), merged as
// a per-line union: a line bun reports is covered if either side ran it, and a
// file bun never loaded takes its lines from e2e alone. Lines only e2e reports
// in a file bun has are dropped, so e2e can raise a function's coverage but
// never lower it.
//
// Usage: bun scripts/crap/frontend_crap.ts <frontend-dir> <lcov.info> <out.json> [e2e.info...]
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Glob } from "bun"
import ts from "typescript"

const [root, lcovPath, outPath, ...e2ePaths] = process.argv.slice(2)

function parseLcov(path: string) {
  const out = new Map<string, Map<number, number>>()
  let cur: Map<number, number> | null = null
  const lcov = existsSync(path) ? readFileSync(path, "utf8") : ""
  for (const line of lcov.split("\n")) {
    if (line.startsWith("SF:")) {
      cur = new Map()
      out.set(line.slice(3), cur)
    } else if (line.startsWith("DA:") && cur) {
      const [n, c] = line.slice(3).split(",").map(Number)
      cur.set(n, c)
    }
  }
  return out
}

const hits = parseLcov(lcovPath)
const unitFiles = new Set(hits.keys())
for (const path of e2ePaths)
  for (const [file, e2e] of parseLcov(path)) {
    const da = hits.get(file) ?? new Map<number, number>()
    hits.set(file, da)
    for (const [n, c] of e2e)
      if (!unitFiles.has(file) || da.has(n)) da.set(n, (da.get(n) ?? 0) + c)
  }

// The generated client and the vendored shadcn components are not ours to test.
const skip = /(^src\/client\/|^src\/components\/ui\/|\.test\.tsx?$|\.conform\.ts$|routeTree\.gen\.ts$|\.d\.ts$)/
const rows: object[] = []

const isFn = (n: ts.Node) =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isConstructorDeclaration(n) ||
  ts.isGetAccessor(n) ||
  ts.isSetAccessor(n)

const BRANCH_OPERATORS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
])
const BRANCH_NODES = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.CaseClause,
])

function fnName(n: ts.Node, sf: ts.SourceFile): string {
  const named = (n as ts.FunctionDeclaration).name
  if (named) return named.getText(sf)
  const p = n.parent
  if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p))
    return p.name.getText(sf)
  if (ts.isCallExpression(p)) return `<arg of ${p.expression.getText(sf).slice(0, 40)}>`
  if (ts.isJsxExpression(p)) return "<jsx callback>"
  return "<anonymous>"
}

for (const file of new Glob("src/**/*.{ts,tsx}").scanSync(root)) {
  if (skip.test(file)) continue
  const text = readFileSync(join(root, file), "utf8")
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const da = hits.get(file)
  const line = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1

  const visitFn = (fn: ts.Node) => {
    let cc = 1
    const nestedLines = new Set<number>()
    const walk = (n: ts.Node) => {
      if (n !== fn && isFn(n)) {
        for (let l = line(n.getStart(sf)); l <= line(n.getEnd()); l++) nestedLines.add(l)
        visitFn(n)
        return
      }
      if (BRANCH_NODES.has(n.kind)) cc++
      else if (ts.isBinaryExpression(n) && BRANCH_OPERATORS.has(n.operatorToken.kind)) cc++
      ts.forEachChild(n, walk)
    }
    ts.forEachChild(fn, walk)

    const start = line(fn.getStart(sf))
    const end = line(fn.getEnd())
    let total = 0
    let covered = 0
    if (da)
      for (let l = start; l <= end; l++) {
        if (nestedLines.has(l) && l !== start) continue
        const c = da.get(l)
        if (c === undefined) continue
        total++
        if (c > 0) covered++
      }
    // A file no test imports is absent from lcov, so 0% by definition.
    const cov = !da || total === 0 ? 0 : covered / total
    rows.push({ file: `frontend/${file}`, line: start, name: fnName(fn, sf), cc, cov })
  }

  const top = (n: ts.Node) => {
    if (isFn(n)) visitFn(n)
    else ts.forEachChild(n, top)
  }
  top(sf)
}

writeFileSync(outPath, JSON.stringify(rows))
console.log(`frontend: ${rows.length} functions`)
