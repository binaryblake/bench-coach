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

For iPhone use, serve the app from an HTTPS origin and add it to the Home Screen for a standalone view. Keeping the display awake depends on iOS Safari supporting Screen Wake Lock; a web app cannot bypass the device passcode or keep the display awake after it is backgrounded or locked.
