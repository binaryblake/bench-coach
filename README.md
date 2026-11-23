# ORYA Bobcats Bench Coach

Mobile-first line-change app for the ORYA Bobcats 8U half-ice 4v4 bench.

## Run locally

```sh
npm install
npm run dev
```

## Standalone iPhone file

```sh
npm run build:standalone
```

The self-contained file is `dist/standalone/index.html`. Transfer it to the iPhone and open it with a browser or local HTML viewer that allows JavaScript. File-based pages may not retain roster data between launches, and screen wake lock requires a secure web origin, so it is unavailable from a local file.

## Bench flow

- Enter any roster of four or more skaters, name the goalie separately, and shuffle skaters into pairs. With an odd number, the extra skater rotates into a line; existing pairs stay together whenever both partners are on ice.
- Ice time and offense/defense are balanced across the rotation. Names and the current shift are saved in this browser.
- Use Previous or Reset game to correct the shift counter.
- Enable Keep screen awake while the app is open. This uses the browser Screen Wake Lock API when available.

## Schedule and game history

- Add games manually or import events from an `.ics` file or calendar URL in Schedule. Calendar event titles and start dates are imported; practices, skills sessions, and pre-season ice are filtered out and existing games are kept. URL imports require a host that permits browser cross-origin access (CORS); `webcal://` URLs are fetched over HTTPS.
- Each game can hold multiple saved lineup options. Shuffle another lineup or request a balanced suggestion, then select the version the coach wants; the selected lineup is saved in this browser.
- Each game has its own roster and goalie. New games prepopulate from the active game (or the latest scheduled game), but roster edits never affect another game. New games start without a lineup, and lineup options are saved only to that game.
- Unrecorded lineup options can be removed. Once a game is recorded, its lineup is labeled and protected from deletion; the recorded pairs and goalie are also shown. Edit the selected lineup or Golden Bobcat recipient, then re-record the game to replace its analytics snapshot.
- Select a Golden Bobcat recipient from that game's skaters or goalie, then use Record game to save the lineup and award together. Changing either enables Re-record game; analytics updates only when you re-record. Analytics lists each recipient, award count, dates, and game names.
- Analytics also lists zero-count pair combinations and known players with no goalie appearances or Golden Bobcat awards yet. The candidate players come from the current roster and saved game rosters.
- Use Set pairs manually in the roster editor to assign skaters to pair numbers, including a rotating skater when the roster is odd. This also lets you enter past game lineups before recording them.
- Suggestions minimize repeat pairings using player names from games marked as played, so the history remains accurate even when each game has its own player IDs. Ties are randomized.
- Record a game to save its selected pairs, goalie, Golden Bobcat recipient, and game date to Analytics. Pair counts are per recorded game, not per shift. Goalie analytics show game counts and dates.
- Games and lineup history use the same local browser storage as the roster. They are not synced across devices; keep browser storage available to retain them.

For iPhone use, serve the app from an HTTPS origin and add it to the Home Screen for a standalone view. Keeping the display awake depends on iOS Safari supporting Screen Wake Lock; a web app cannot bypass the device passcode or keep the display awake after it is backgrounded or locked.
