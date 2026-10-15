/**
 * The Directory's columns (DCOL): the deployment's defaults, the Account's
 * own On and Off over them, and which columns a list read asks for.
 */
import { describe, expect, test } from "bun:test"
import {
  type ColumnCatalogue,
  choiceCount,
  choicesFromHidden,
  columnsToSend,
  isOn,
  mayMakeDefaults,
  setChoice,
  shownColumns,
} from "./directory-columns"

const CATALOGUE: ColumnCatalogue = [
  { key: "language", default: true },
  { key: "subscribers", default: true },
  { key: "reach", default: true },
  { key: "photos", default: false },
  { key: "bio", default: false },
]

describe("a column's state", () => {
  test("an untouched column follows the default", () => {
    expect(shownColumns(CATALOGUE, {})).toEqual([
      "language",
      "subscribers",
      "reach",
    ])
  })

  test("an explicit choice beats the default, in table order", () => {
    expect(
      shownColumns(CATALOGUE, { reach: "off", bio: "on", photos: "on" }),
    ).toEqual(["language", "subscribers", "photos", "bio"])
    expect(isOn(CATALOGUE[0], { language: "off" })).toBe(false)
    expect(isOn(CATALOGUE[3], { photos: "on" })).toBe(true)
  })

  test("a choice for a column the catalogue does not list shows nothing", () => {
    // An Internal set On while the Account held DATA_ADMIN.
    expect(shownColumns(CATALOGUE, { attempts: "on" })).toEqual([
      "language",
      "subscribers",
      "reach",
    ])
  })

  test("Default takes the choice away; a choice equal to the default stays", () => {
    expect(setChoice({ reach: "off" }, "reach", undefined)).toEqual({})
    expect(setChoice({}, "reach", "on")).toEqual({ reach: "on" })
  })
})

describe("the Custom count", () => {
  test("counts every listed choice, even one equal to its default", () => {
    expect(choiceCount(CATALOGUE, { reach: "on", bio: "on" })).toBe(2)
  })

  test("leaves out a choice the catalogue does not list", () => {
    expect(choiceCount(CATALOGUE, { attempts: "on" })).toBe(0)
  })
})

describe("who may set the defaults", () => {
  test("the catalogue lists the Internals only for DATA_ADMIN, which the PUT needs", () => {
    expect(mayMakeDefaults(CATALOGUE)).toBe(false)
    expect(
      mayMakeDefaults([...CATALOGUE, { key: "attempts", default: false }]),
    ).toBe(true)
  })
})

describe("the old hidden list", () => {
  test("each hidden column becomes an explicit Off", () => {
    expect(choicesFromHidden(["reach", "mine", "nonsense"])).toEqual({
      reach: "off",
      mine: "off",
    })
  })
})

describe("what a list read asks for", () => {
  test("with nothing loaded yet, the shown columns", () => {
    expect(columnsToSend(["reach", "language"], undefined)).toEqual([
      "language",
      "reach",
    ])
  })

  test("turning one off keeps the last request, so nothing is read", () => {
    expect(
      columnsToSend(["language"], ["language", "reach", "subscribers"]),
    ).toEqual(["language", "reach", "subscribers"])
  })

  test("turning on one the page lacks asks again, for the shown ones", () => {
    expect(columnsToSend(["language", "bio"], ["language", "reach"])).toEqual([
      "bio",
      "language",
    ])
  })
})
