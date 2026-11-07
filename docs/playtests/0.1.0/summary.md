# Playtest summary: 0.1.0

## Scripted run

`tests/play.cjs` ran against the live site at build `0.1.0+g38ed312`, on a desktop and a phone profile, using software rendering. It plays all five days with wrong answers, and passed on both profiles with no page errors and no horizontal overflow.

It also covers real walking, drag and stick input, reloading a save, loading the old two-day save format, skipping days, and a spent ballot next to Cherry offering the crate.

## Human playtests

- The owner played the first build.
- One outside tester reported wordy instructions and a Day 4 ballot that would not go in the crate. Both were addressed in #1. The tester's exact failure was not reproduced, so that fix needs a retest.

## Not tested

- Real phones and real GPUs.
