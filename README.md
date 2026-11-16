# Smart Alec

A TV quiz-show board game for 2–8 players. The TV shows the 64-space board; every phone is a private controller.
Win one token in each of 6 categories, then get 6 questions right in 60 seconds in the Final Round.

Built from NOGGIN (rooms, join by QR, reconnect, pause, sounds, the 16 mini-games and 4 Showdowns in `server/games/`) and Pub Quiz Powerhouse (the question banks, A–D option builder and typed-answer marking).

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
- Questions from the 2020–2026 editorial preview and any new `source-banks/smart-alec-*.json` pack are tagged `preview` until you sign them off. The lobby button **Unreviewed questions** switches them off.
- `npm run questions` also writes `data/weak-options.csv`: questions whose wrong options look nothing like the right answer, worst first. `node tools/score-options.js` refreshes it.
- To remove a question entirely, add its id to the `_exclude` list in `data/option-overrides.json`.
- `data/options-review.csv` lists every question with its A–D options. To fix weak wrong options, add the question's id to `data/option-overrides.json`, e.g. `{"QD228-Q01": ["Corfu", "Crete", "Kos"]}`, then rebuild.

## Checks

- `npm test` runs the rule tests.
- `npm run simulate` plays hundreds of bot games to prove none get stuck.

## Status (v0.1.0)

Done: board, turns, Play Safe / Go Smart, Bonus Steal, tokens, Brains, all 8 special spaces, Final Round with predictions, Quick Game, time limit, catch-up dice, pause, reconnect, sound.

v0.2.0: Alec on the TV (4 poses, drawn stand-in until the art arrives), 123 questions with hand-written wrong options, smarter automatic options, 52 new Music questions.

v0.3.0: all 16 NOGGIN mini-games on Mini-game spaces and all 4 NOGGIN Showdowns on the Showdown space, played on the TV and phones exactly as in NOGGIN but paying Brains (every mini-game winner +3; Showdown winner takes up to 4 from the loser; correct backers +1). Music now 350 questions (5 new batches awaiting review).

v0.4.0: 2,474 questions. 598 questions now have hand-written wrong options (every Screen Time and Sport question, most of Time & Place and Brainbox). Eight new packs add 441 questions across Screen Time, Sport, Time & Place and Brainbox (awaiting review).

v0.5.0: 2,639 questions. Every question now has hand-written or hand-checked wrong options (1,521 hand-written; the rest are number questions with sensible nearby numbers). 13 broken "The Link?" and ambiguous questions removed. Three more packs: Time & Place 3, Brainbox 3, Sport 3.

v0.5.1: the ChatGPT art is in: logo, Alec's four poses, all backgrounds, board icons, special-space badges, category tokens (shown as won tokens on the scoreboard) and 27 avatar poses. The board track now sits on the art's cream rim, and the Final Round has its own spotlight stage.

v0.5.2: the twelve characters and their names on the title screen; the Smart Alec logo on the phone join and lobby screens.

Next: the last nine "lose" avatar poses, your review of the new packs.
