"""A spread's bars, zoomed or not: one rule for the Directory's bound editor
and the Logs tab's Logged editor.

A pure transform. It builds the bucket expression and turns per-bar counts
into bars, and executes nothing: each caller counts under its own scoping.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from sqlalchemy import ColumnElement, Float, func
from sqlalchemy import cast as sa_cast

#: Bars in a spread.
SPREAD_BARS = 32


@dataclass(frozen=True)
class Bin:
    """One bar: values from `lo` to `hi`, the last bar's `hi` included."""

    lo: float
    hi: float
    count: int


@dataclass(frozen=True)
class SpreadRange:
    """The values the bars cover, `[first, last]`, on a linear or log scale."""

    first: float
    last: float
    log: bool = False

    def _to_scale(self, v: float) -> float:
        return math.log(max(v, 0) + 1) if self.log else v

    def _from_scale(self, u: float) -> float:
        return math.exp(u) - 1 if self.log else u

    def holds(self, value: ColumnElement[Any]) -> list[ColumnElement[bool]]:
        """The values inside the range, the only ones a bar counts."""
        return [value >= self.first, value <= self.last]

    def bar_of(self, value: ColumnElement[Any]) -> ColumnElement[int]:
        """Which bar, 1 to `SPREAD_BARS`, a value falls in; `last` shares the last."""
        scaled = func.ln(func.greatest(value, 0) + 1) if self.log else value
        return func.least(
            func.width_bucket(
                sa_cast(scaled, Float),
                self._to_scale(self.first),
                self._to_scale(self.last),
                SPREAD_BARS,
            ),
            SPREAD_BARS,
        )

    def bars(self, counts: Mapping[int, int]) -> list[Bin]:
        """Every bar, from per-bar counts keyed as `bar_of` numbers them."""
        first, last = self._to_scale(self.first), self._to_scale(self.last)
        step = (last - first) / SPREAD_BARS
        return [
            Bin(
                lo=self._from_scale(first + i * step),
                hi=self._from_scale(first + (i + 1) * step),
                count=counts.get(i + 1, 0),
            )
            for i in range(SPREAD_BARS)
        ]


def spread_range(
    lowest: float | None,
    highest: float | None,
    zoom: tuple[float, float] | None,
    *,
    log: bool = False,
) -> SpreadRange | None:
    """What the bars cover: the whole spread, or the zoom clamped inside it.

    `None` when there is nothing to bin: no values, or a single instant.
    """
    if lowest is None or highest is None:
        return None
    first, last = float(lowest), float(highest)
    if zoom is not None:
        first, last = max(zoom[0], first), min(zoom[1], last)
    return SpreadRange(first, last, log) if last > first else None
