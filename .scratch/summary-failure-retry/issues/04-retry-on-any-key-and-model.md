# SFR-04: Retry on any Key and model

**What to build:** When one AI Key is out of quota or a model is down, the retry can use any of the Account's Keys and any model that Key offers, without changing the Account's defaults. Before retrying, the page warns when the saved prompt won't fit the chosen model.

Spec: `.scratch/summary-failure-retry/spec.md`; ADR-016 (who pays) still holds: the chosen Key belongs to the caller and is checked before it is used.

**Blocked by:** SFR-02.

**Status:** ready-for-agent

- [ ] The "Try again" card has Key and Model chips styled like the Action tab's "Run with" bar, starting at the last Attempt's Key and model (falling back to the selected Key when that Key is gone).
- [ ] The Model chip lists the chosen Key's own models, accepts a typed id, and switching Key restores the model last run on that Key.
- [ ] Choosing a Key or model for a retry never changes the Account's selected Key or any Key's remembered model.
- [ ] Starting an Attempt accepts a Key and model; a Key the caller does not own is refused before it is decrypted and answers as an absent one.
- [ ] The model listing for a Key returns each model's context length when the Provider offers one (OpenRouter does; Gemini ids by rule; none for an endpoint without it).
- [ ] The card estimates the saved prompt at four characters per token and shows "won't fit" past the chosen model's window and "tight" past 80% of it; it never blocks, and shows nothing when the window is unknown or no prompt is stored.
- [ ] The Attempt list shows each Attempt's Key by its label.
- [ ] Backend tests over HTTP: a retry on a second Key and model records them and finishes the Summary with them; a foreign Key id is refused before decrypt; the model listing carries context lengths where available and stays free text where not. Guards met, none loosened: AI-key payment rule and callers, the OpenAI-compatible provider tests.
- [ ] Frontend: unit tests for the size thresholds, render tests for the chips and the warning states, and the Playwright journey covering a retry on another Key and model and the "won't fit" warning, with the Action tab's selection unchanged afterwards.
