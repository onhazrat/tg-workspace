# SUMTAB-01: Touch gestures in the photo viewer

**What to build:** The full-size photo viewer works with fingers, everywhere it opens: the Posts
feed, the Channels grid, Channel avatars, and (later) the Summary tab's photo strip. Two fingers
pinch-zoom about their midpoint; a double-tap the viewer detects itself toggles zoom; at 1x a swipe
left or right steps to the next or previous photo, following the page's reading direction; a swipe
down closes. On touch, a single tap shows or hides the caption, arrows and close button instead of
closing. With a mouse nothing changes: a click at 1x closes, the wheel or trackpad zooms, a
double-click toggles zoom. The caption wraps to fit a phone screen and its hint names the gestures of
the input in use. See `.scratch/summary-tab/spec.md`, user stories 79-88, and "The photo viewer"
under Implementation Decisions.

**Blocked by:** None (can start immediately).

**Status:** done

### Gestures

- [x] The pan-and-zoom surface tracks every active pointer. With two down, the scale follows the ratio of the current finger distance to the starting distance, about the starting midpoint, through the existing zoom-about arithmetic, clamped as today
- [x] Lifting one finger of a pinch hands over to a one-finger pan with no jump, and a pinch never counts as a tap
- [x] Two taps close in time and space toggle 2.5x about the tap point, detected by the viewer, not by `dblclick`
- [x] At 1x, a mostly-horizontal swipe past a threshold steps photos; in a right-to-left page the directions are reversed. A mostly-downward swipe past a threshold closes
- [x] Above 1x, one finger pans and neither swipe applies
- [x] On touch, a single tap (once the double-tap window passes with no second tap) shows or hides the controls and does not close. A mouse click at 1x still closes
- [x] The surface keeps `touch-action: none`, so the page never zooms or scrolls underneath

### Caption

- [x] The caption wraps inside the screen on a 390px-wide phone instead of overflowing
- [x] Its hint reads pinch and double-tap on touch, scroll and double-click with a mouse, and the zoomed hint names the matching reset gesture

### Tests

- [x] The existing photo viewer component test gains: pinch scales about the midpoint and does not close; double-tap toggles 2.5x without closing; horizontal swipe steps, reversed in a right-to-left page; downward swipe closes; a touch tap toggles the controls and does not close; a mouse click at 1x still closes; above 1x one finger pans and does not step
- [x] The existing photo-viewer model tests cover the pinch scale arithmetic
