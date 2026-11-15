# Smart Alec

A TV quiz-show board game for 2–8 players. The TV shows the 64-space board; every phone is a private controller.
Win one token in each of 6 categories, then get 6 questions right in 60 seconds in the Final Round.

Built from NOGGIN (rooms, join by QR, reconnect, pause, sounds) and Pub Quiz Powerhouse (the question banks, A–D option builder and typed-answer marking).

## Play

1. Open `/tv/` on the TV and press **Start a new game**.
2. Everyone scans the QR code (or opens `/play/` and types the room code).
3. Pick a name and character, press **I'm ready**, then **Start the show** on the TV.

TV controls appear when you move the mouse: Pause (or Space bar), Skip waiting, Sound, End game.

## Run it on your own computer (Windows)

1. Install Node.js 22 LTS from https://nodejs.org (tick every default).
2. Open the project folder, click the address bar, type `cmd` and press Enter.
3. Type `npm install` and press Enter (first time only).
4. Type `npm start` and press Enter.
5. Open the TV address it prints. Phones must be on the same Wi-Fi.

## Deploy on Render

1. In Render choose **New → Blueprint** and pick the `SMART-ALEC` repository.
2. Render reads `render.yaml` and creates one free web service. Press **Apply**.
3. When it says Live, open `https://<your-service>.onrender.com/tv/`.

The free plan sleeps after 15 minutes idle; the first visit takes about a minute to wake it.

## Questions

- `data/questions.json` is built from the three banks in `source-banks/`. Rebuild with `npm run questions`.
- Questions from the 2020–2026 editorial preview are tagged `preview`. The lobby button **2020–2026 questions** switches them off.
- `data/options-review.csv` lists every question with its A–D options. To fix weak wrong options, add the question's id to `data/option-overrides.json`, e.g. `{"QD228-Q01": ["Corfu", "Crete", "Kos"]}`, then rebuild.

## Checks

- `npm test` runs the rule tests.
- `npm run simulate` plays hundreds of bot games to prove none get stuck.

## Status (v0.1.0)

Done: board, turns, Play Safe / Go Smart, Bonus Steal, tokens, Brains, all 8 special spaces, Final Round with predictions, Quick Game, time limit, catch-up dice, pause, reconnect, sound.

Next: NOGGIN mini-games on Mini-game spaces (a Lightning Round question stands in), NOGGIN Showdowns (a head-to-head question stands in), ChatGPT art, Alec host poses, more Music questions.
