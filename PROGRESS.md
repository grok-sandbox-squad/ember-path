# Ember Path: progress log

Squad: **Supreme Leader** (lead), **Builder** (code), **Reviewer** (GitHub App `grok-squad-reviewer`).

## Goal
A small, original, turn-based browser game on GitHub Pages where a person plays against the computer at Easy, Normal or Hard, on a phone or a desktop.

## The game (original concept, D1)
**Ember Path** is a two-player duel on a 6x6 grid of glowing coals, each worth 1 to 5 points.
- One shared spark. Before the first move, the **second player picks the starting cell**, which burns out and scores nothing. Any of the 36 cells can be picked. The first player then makes the first move from there.
- On your turn, move the spark in a straight line (up, down, left or right) 1, 2 or 3 cells. It can't pass through or land on a burned cell, and it can't leave the board.
- You score the value of the cell where the spark lands, and that cell burns out.
- The second player starts with **1.5 points** to offset the first-move edge. (The +3 last-move bonus in the first draft was dropped; see D9.)
- If the player to move has no legal move, the game ends.
- Highest score wins. The half point means a draw can't happen.
- Boards are generated from a numeric seed so every game is reproducible and testable. Each new game picks a new seed, and the player can replay a seed. The human moves first by default, with an option to let the computer start.

Why it's original: it's a single shared piece on a burning board, with point grabbing, plus a start pick and head start for the second player. The squad designed it and it's not a port of an existing game. The names, art (CSS-drawn cells, no images copied) and rules are our own.

## Scope
In: pure rules module, seeded board generator, computer opponent with Easy/Normal/Hard, phone-friendly UI with tap-to-move, move highlights, score, turn indicator, end screen, new game/replay seed, README with how to play, tests in Actions.
Out: online multiplayer, accounts, storage beyond optional localStorage settings, tracking, external scripts/fonts, sound files.

## Done means
- Live at https://grok-sandbox-squad.github.io/ember-path/ and Supreme Leader played a full game on it at each difficulty before reporting.
- Every change reached `main` through a PR approved by `grok-squad-reviewer`.
- Real tests of the rules module and AI run in GitHub Actions on every PR (required `test` check).
- README covers what it is, how to play, and how to run tests.
- This file has the plan, decisions, who did what, and Reviewer catches.

## Task list
| # | Task | Owner | Status |
|---|------|-------|--------|
| 1 | Repo, Pages from `main`, protection, hardened tests workflow, this plan | Supreme Leader | done (#1) |
| 2 | `src/rules.js`: pure, immutable game state, seeded board (`createGame(seed, options)`), `legalMoves`, `applyMove`, `isOver`, `result`, with tests | Builder | done (#3) |
| 3 | `src/ai.js`: `chooseMove(state, difficulty, rng)` with Easy/Normal/Hard, with tests | Builder | done (#3) |
| 4 | UI (`index.html`, `app.js`, `app.css`), mobile-first, tap targets 44px or more, plus README | Builder | done (#5) |
| 5 | Review every PR locally (tests plus actually playing it), approve and squash-merge every PR (D7), recheck live after merges | Reviewer | ongoing |
| 6 | Keep this log current, play the live game myself, and send the final short report | Supreme Leader | ongoing |

## Working rules
- Nobody pushes to `main`. `main` requires a PR, 1 approving review, and the `test` check, admins included.
- Supreme Leader never approves or merges. Builder doesn't merge. Reviewer squash-merges every approved PR (see D7), and only at the exact head it approved, with `test` green.
- Commits use `354381310+grok-sandbox-squad@users.noreply.github.com`, signed with the author's bot name.
- **Quiet chats:** Builder and Reviewer talk only to Supreme Leader and each other. Supreme Leader messages the user only when blocked on them or when the game is live and verified, with one short report. Progress lives here.

## Decisions
- **D1. Concept.** Ember Path, described above. Picked because the rules fit in a pure module, are easy to test exhaustively, and give a real difficulty curve for a simple search AI.
- **D2. Board.** 6x6, values 1-5 from a small seeded PRNG (mulberry32), with any of the 36 cells usable as the start (picked by the second player, D9). The first draft fixed the start at row 2, col 2 (0-based). Small enough that Hard can search deeply on a phone.
- **D3. Difficulties.** Easy picks a random legal move, preferring higher values about half the time. Normal is greedy: highest immediate gain, breaking ties by leaving the opponent the fewest good moves. Hard uses alpha-beta minimax on score difference, depth-limited with a time/node budget so a move takes under ~300 ms on a phone. Tests must show Hard beats Easy in most seeded games and never makes an illegal move.
- **D4. Same stack as run 1.** No build, no deps, ES modules, `node --test`, CI with `contents: read` and SHA-pinned actions.
- **D5. Bootstrap commit.** The auto-created README commit landed on `main` before protection could exist. Everything after goes through PRs.
- **D6. Lesson from run 1.** Supreme Leader plays the live site personally before calling it done. Builder attacks its own code with bad input and checks how the output reads to a real player before opening a PR.
- **D7. Merging (revised).** Builder's safety check blocked it from merging PR #1, because every PR is authored by the shared `grok-sandbox-squad` account, so it can't tell Supreme Leader's PRs from its own. Getting past it would have needed an approval on the user's phone, which breaks the quiet-chat rule. So Reviewer squash-merges all PRs. Approval is still a separate party (the App) from the author.
- **D8. Rule clarifications from Reviewer on #1.** Every cell along a 2- or 3-step move must be clear, not just the landing cell. The middle difficulty is called "Normal" everywhere. A Hard-vs-Hard balance test over about 100 seeds measures first-player advantage, and if the first player wins more than about 65%, Supreme Leader adjusts the rules.
- **D9. Balance fix.** Under the first-draft rules, Hard vs Hard gave the first player 98% of wins (Builder, 100 seeds) and 93% at 20k nodes (Reviewer). The +3 decided about 36% of games. Builder measured each candidate with the AI actually playing under it: no bonus 96%, +3 to the stuck player 96% (Reviewer's rescoring estimate of 47% didn't survive real play), plain komi swings 25-40 points per point and never lands in range, the second player picking the start 84%, and a pie/swap rule 41% (but it needs an awkward swap dialog on a phone). Chosen: **the second player picks the start + no bonus + 1.5-point head start**, which gave 51/49/0 on seeds 5000-5099 (halves 44 and 58) and 57/43/0 on fresh seeds 7000-7099. It's the only option within 40-60 on every set without a swap dialog. **Status: done.** Landed in PR #3 (fb98c33) with a balance test asserting 40-60% on seeds 5000-5099; the test fails with no head start or a head start of 5. Reviewer verified it independently before merge: 48.3% / 51.7% first/second on fresh seeds (n=120), 0 draws, and the landed code gives 46/54 on seeds 5000-5099 (the 51/49 above was Builder's prototype).
  Builder's implementation choices, accepted by Supreme Leader:
  1. The first player is whoever makes the first spark move; the other player picks the start.
  2. History entry 0 is the start pick.
  3. Hard's pick searches each cell with a 16k-node budget and takes the cell that minimizes the first player's best minimax margin (ties go to row order).
  4. Normal's pick is deterministic: the smallest best immediate move for the first player, then the fewest moves, then the lowest total in reach.
  5. Easy picks at random among the better 18 cells.
  6. Balance is sensitive to Hard's pick budget (8k per cell gave 64%), so the balance test guards it.

## Log
- 2026-11-09: Supreme Leader created the public repo, enabled Pages from `main`, protected `main` (1 approving review, stale reviews dismissed, required `test`, admins included, no force pushes or deletions), and opened the plan + CI PR.
- PR #1 approved and merged by Reviewer (5d10b4b) after Builder's merge was blocked (D7). Supreme Leader confirmed protection settings through the admin API, since Reviewer's App gets a 403 there. Builder started PR A (rules + AI).
- PR #2 (docs) approved and merged by Reviewer (3ddb58a).
- PR #3 (rules + AI) opened by Builder. Engine verified by Reviewer, but the balance test showed a first-player win rate of 98%. Supreme Leader chose the D9 fix, and Builder implemented it in #3.
- PR #4 (docs: D9 recorded as pending) approved and merged by Reviewer (963bd29).
- PR #3 approved at head f5be4a0 and squash-merged by Reviewer (fb98c33). 40/40 tests.
- PR #5 (UI + README) opened by Builder at e48b666, with 59 unit tests and 102 headless-browser checks. Approved at e48b666 and squash-merged by Reviewer (48e8396). Pages deploy succeeded. Reviewer played the live site in headless Chromium and Firefox at 390 px wide (Easy, Normal and Hard, as first and second player). Not yet checked: Safari/WebKit, a real phone, screen readers.

## Reviewer catches
- PR #1: possible first-player or +3 edge in odd-length games (measure it with AI-vs-AI); "Normal" vs "Medium" naming mix; the path rule wasn't explicit for 2-3 step moves. Reviewer's App gets a 403 from the branch-protection API (no admin), so Supreme Leader confirmed protection. Originality check: closest relatives are Hey! That's My Fish! and Amazons (burned tiles), and Ember Path is distinct (shared spark, landing score, +3 last-move bonus at the time; the start pick came later with D9).
- PR #2: task #5 wording didn't match D7, and the #1 notes didn't mention the 403 (both fixed here).
- PR #3 (first pass): engine correct. 0 mismatches against Reviewer's independent move generator over 42,013 positions; all illegal moves rejected; 0 illegal AI moves in 180 games; deterministic; Hard about 9 ms/move median. **Blocker:** first-player win rate of 93% (see D9). Nits: `isLegalMove` throws on a bad state instead of returning false; the balance test should assert, not just report; decision numbering gap (fixed here).
- PR #4: first draft wrote D9 as if it had already landed; reworded as pending until Reviewer verified it.
- PR #3 (final): 0 legality mismatches over 21,016 positions; start pick can't be bypassed; 0 draws. Hard beats Easy 100%, Normal beats Easy 96%, Hard beats Normal 94%. Hard move p95 10.7 ms; Hard start pick median 87 ms, max 131 ms (about 0.5-0.65 s estimated on a phone). UI must-haves passed to PR #5: show a thinking state during the computer's pick, and offer the pick only to the real second player, since the engine doesn't check who picks.
- PR #5: thinking state shows before Hard's search (longest freeze about 103 ms); taps blocked while the computer thinks; only the real second player is offered the pick; New game mid-turn never applies a stale move; worker failure falls back to the main thread; XSS attempts fail and the CSP blocks network calls; no sideways scroll at 320/390/1280. Non-blocking: first Tab can land on the page body, New game doesn't reset the scroll, long status intros, stiff "You don't pick the start" copy.
- PR #6: first draft still showed #5 as in review; D9 quoted prototype numbers instead of the landed code's.
