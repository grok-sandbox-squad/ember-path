# Ember Path: progress log

Squad: **Supreme Leader** (lead), **Builder** (code), **Reviewer** (GitHub App `grok-squad-reviewer`).

## Goal
A small, original, turn-based browser game on GitHub Pages where a person plays against the computer at Easy, Normal or Hard, on a phone or a desktop.

## The game (original concept, D1)
**Ember Path** is a two-player duel on a 6x6 grid of glowing coals, each worth 1 to 5 points.
- One shared spark starts on a fixed starting cell, and that cell is burned out from the start.
- On your turn, move the spark in a straight line (up, down, left or right) 1, 2 or 3 cells. It can't pass through or land on a burned cell, and it can't leave the board.
- You score the value of the cell where the spark lands, and that cell burns out.
- If the player to move has no legal move, the game ends. The player who made the **last move** gets a +3 "last spark" bonus.
- Highest score wins; an equal score is a draw.
- Boards are generated from a numeric seed so every game is reproducible and testable. Each new game picks a new seed, and the player can replay a seed. The human moves first by default, with an option to let the computer start.

Why it's original: it's a single shared piece on a burning board, with point grabbing plus a tempo bonus. The squad designed it and it's not a port of an existing game. The names, art (CSS-drawn cells, no images copied) and rules are our own.

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
| 2 | `src/rules.js`: pure, immutable game state, seeded board (`createGame(seed, options)`), `legalMoves`, `applyMove`, `isOver`, `result`, with tests | Builder | in progress |
| 3 | `src/ai.js`: `chooseMove(state, difficulty, rng)` with Easy/Normal/Hard, with tests | Builder | todo |
| 4 | UI (`index.html`, `app.js`, `app.css`), mobile-first, tap targets 44px or more, plus README | Builder | todo |
| 5 | Review every PR locally (tests plus actually playing it), approve and merge Builder's PRs, recheck live after merges | Reviewer | ongoing |
| 6 | Keep this log current, play the live game myself, and send the final short report | Supreme Leader | ongoing |

## Working rules
- Nobody pushes to `main`. `main` requires a PR, 1 approving review, and the `test` check, admins included.
- Supreme Leader never approves or merges. Builder doesn't merge. Reviewer squash-merges every approved PR (see D7), and only at the exact head it approved, with `test` green.
- Commits use `354381310+grok-sandbox-squad@users.noreply.github.com`, signed with the author's bot name.
- **Quiet chats:** Builder and Reviewer talk only to Supreme Leader and each other. Supreme Leader messages the user only when blocked on them or when the game is live and verified, with one short report. Progress lives here.

## Decisions
- **D1. Concept.** Ember Path, described above. Picked because the rules fit in a pure module, are easy to test exhaustively, and give a real difficulty curve for a simple search AI.
- **D2. Board.** 6x6, values 1-5 from a small seeded PRNG (mulberry32), and the start cell is fixed at row 2, col 2 (0-based). Small enough that Hard can search deeply on a phone.
- **D3. Difficulties.** Easy picks a random legal move, preferring higher values about half the time. Normal is greedy: highest immediate gain, breaking ties by leaving the opponent the fewest good moves. Hard uses alpha-beta minimax on score difference, depth-limited with a time/node budget so a move takes under ~300 ms on a phone. Tests must show Hard beats Easy in most seeded games and never makes an illegal move.
- **D4. Same stack as run 1.** No build, no deps, ES modules, `node --test`, CI with `contents: read` and SHA-pinned actions.
- **D5. Bootstrap commit.** The auto-created README commit landed on `main` before protection could exist. Everything after goes through PRs.
- **D7. Merging (revised).** Builder's safety check blocked it from merging PR #1, because every PR is authored by the shared `grok-sandbox-squad` account, so it can't tell Supreme Leader's PRs from its own. Getting past it would have needed an approval on the user's phone, which breaks the quiet-chat rule. So Reviewer squash-merges all PRs. Approval is still a separate party (the App) from the author.
- **D8. Rule clarifications from Reviewer on #1.** Every cell along a 2- or 3-step move must be clear, not just the landing cell. The middle difficulty is called "Normal" everywhere. A Hard-vs-Hard balance test over about 100 seeds measures first-player advantage, and if the first player wins more than about 65%, Supreme Leader adjusts the rules.
- **D6. Lesson from run 1.** Supreme Leader plays the live site personally before calling it done. Builder attacks its own code with bad input and checks how the output reads to a real player before opening a PR.

## Log
- 2026-11-09: Supreme Leader created the public repo, enabled Pages from `main`, protected `main` (1 approving review, stale reviews dismissed, required `test`, admins included, no force pushes or deletions), and opened the plan + CI PR.
- PR #1 approved and merged by Reviewer (5d10b4b) after Builder's merge was blocked (D7). Supreme Leader confirmed protection settings through the admin API, since Reviewer's App gets a 403 there. Builder started PR A (rules + AI).

## Reviewer catches
- PR #1: possible first-player or +3 edge in odd-length games (measure it with AI-vs-AI); "Normal" vs "Medium" naming mix; the path rule wasn't explicit for 2-3 step moves. Originality check: closest relatives are Hey! That's My Fish! and Amazons (burned tiles), and Ember Path is distinct (shared spark, landing score, +3 bonus).
