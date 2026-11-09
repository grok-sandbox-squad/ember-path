# Ember Path

Ember Path is a small, original, turn-based game you play against the computer in your browser, on a phone or a desktop. You and the computer share a single spark on a 6x6 board of glowing coals. You take turns moving the spark and grabbing points, and the board burns out behind you.

Play it at **https://grok-sandbox-squad.github.io/ember-path/**. It has no accounts, no tracking, and no outside scripts or fonts.

## How to play

- The board is 6 by 6. Each coal is worth 1 to 5 points, and the number is shown on it. Nothing is burned at the start.
- **The second player picks where the spark starts and begins with 1.5 points; there's no end bonus.** The picked cell can be any of the 36. It becomes the spark (◆), burns out and scores nothing. Then the first player makes the first move.
- On your turn, move the spark 1, 2 or 3 cells in a straight line: up, down, left or right. Diagonal moves aren't allowed.
- The path must be clear. The spark can't land on a burned-out cell (×) or jump over one, and it can't leave the board. For a 2- or 3-step move, every cell along the way must still be a coal.
- You score the number on the cell where the spark lands, and that cell burns out. Cells the spark only passed over stay as they are.
- When the player whose turn it is has no legal move, the game ends.
- The higher score wins. Because of the half point, there are no draws.

By default you move first, so the computer picks the start (and gets the 1.5 points). Tick **Computer moves first** to pick the start yourself. In that case every cell is outlined, and you tap the one where the spark should start.

On your turn, the cells you can reach are outlined in white with a dot in the corner, and the others fade back. Tap one to move there. With a keyboard, press Tab to move between the reachable cells and Enter to move. While the computer is thinking, the board is locked. The top bar shows the score, including the 1.5 head start, and whose turn it is. The line under it says what the last move was. The cell the spark just left has a dashed outline.

When the game ends, a panel shows who won, the final scores and who had the head start. From there you can **Play again** on a new board or **Replay this board**.

## Difficulty

- **Easy** picks a random legal move, but about half the time it grabs one of the highest-value cells.
- **Normal** (the default) is greedy. It takes the most points it can right now, and on ties it leaves you the weakest reply.
- **Hard** searches ahead with alpha-beta minimax, up to a fixed search budget, so it plans ahead, including where to pick the start and how to leave you dead ends.

You can change the difficulty or tick **Computer moves first** at any time. The new settings apply when you start your next game, and a note tells you so. The game in progress is never changed.

## Seeds

Every board comes from a seed, which is a whole number from 0 to 4294967295. The same seed always gives the same board, and if you play the same moves, the computer replies the same way too. **New game** picks a random seed. To replay a board, type its seed into **Board seed** and press **Play this seed**. The current seed is shown under the board. Anything other than a whole number in that range, such as an empty box, a negative number, a decimal, letters or spaces inside the number, gets a short error message and the current game carries on.

## Run it locally

You need any static file server, because browsers don't run ES modules from `file://` pages. Python's built-in server works:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

## Run the tests

You need Node.js 20 or newer. There's nothing to install.

```sh
node --test
```

The tests cover the rules engine (the start pick, moves, the path-clear rule, scoring with the 1.5 head start, game end and replays), the computer player (legal moves only, the same result for the same seed, Hard beating Easy, Hard's speed, and a Hard-vs-Hard balance check), and the UI. The UI tests are static and need no browser. They check that the page never builds HTML from strings, loads nothing from other sites, uses only relative imports and labels every input, and they test the seed parsing and other display helpers with bad input. GitHub Actions runs the same `node --test` on every pull request.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The page, with a strict Content-Security-Policy that only allows files from this site |
| `app.css` | Styles (mobile first, system fonts) |
| `app.js` | The UI: board, turns, the computer's thinking delay, end screen and settings |
| `src/rules.js` | Pure rules engine: seeded board, legal moves, scoring, game end |
| `src/ai.js` | The computer player (`chooseMove`) for Easy, Normal and Hard |
| `src/ai-worker.js` | Runs the computer's search in a Web Worker so the page stays responsive |
| `src/ui-logic.js` | Small pure helpers for the UI: seed parsing, move descriptions, the end-screen text |
| `tests/` | `node --test` suites |
| `PROGRESS.md` | The squad's plan, decisions and log |

## Known limitations

- **Balance is still under review.** The second player's start pick and 1.5-point head start were added to offset the first player's advantage. A Hard-vs-Hard test keeps the first player's win rate between 40% and 60% on a fixed set of seeds, but other seeds or human play may differ.
- Hard's search uses a fixed node budget, not a clock, so it plays the same on every device. Its start pick searches all 36 cells and takes longer than a normal move. The search runs off the main thread, so the page doesn't freeze.
- If a browser can't start the Web Worker (very old browsers), the computer thinks on the main thread, and the page may pause briefly on Hard.
- There's no undo, and nothing is saved between visits. Settings reset when you reload.
- The seed isn't in the page address, so to share a board you have to share the seed number.
- It's been tested in desktop Chrome (headless) at phone and desktop sizes. It hasn't been tested yet on real phones, Safari, Firefox or with screen readers.
