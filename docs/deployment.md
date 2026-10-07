# Hetzner deployment

Live URL: <https://buttery.wtf/dps-simulator/>.

The checkout is `/home/flamehorn/dps-simulator`, alongside the other projects.
SFTP access is also available through `/home/codex/sites/dps-simulator`.
Run installation, build, Git and PM2 commands as `flamehorn`;
use `PM2_HOME=/home/flamehorn/.pm2`.

```sh
cd /home/flamehorn/dps-simulator
git pull --ff-only
npm ci
npm run verify
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
curl --fail http://127.0.0.1:4009/
```

PM2 runs the production static server on `127.0.0.1:4009` and restores it
at boot through the existing `pm2-flamehorn` systemd service. The server
serves only `dist/`, rejects hidden files and traversal, and caches Vite's
hashed assets. `npm start` remains the development command; `npm run serve`
serves a previously built production bundle.

Caddy's existing `buttery.wtf, www.buttery.wtf` block contains:

```caddyfile
redir /dps-simulator /dps-simulator/ 308

handle_path /dps-simulator/* {
    reverse_proxy 127.0.0.1:4009
}
```

Keep `/etc/caddy/Caddyfile` authoritative. Back it up before edits, preserve
other routes, validate with `caddy validate --config /etc/caddy/Caddyfile`,
and reload Caddy only when its configuration changes. Its path handler
strips the prefix; Vite's relative asset URLs work below `/dps-simulator/`.

The menu entry and GitHub icon link are managed separately in
`/home/flamehorn/buttery-hub/projects.json`.

Inspect the process with `pm2 describe dps-simulator` and
`pm2 logs dps-simulator --lines 50 --nostream` as `flamehorn`.
For rollback, restore the previous Git commit, rebuild, reload this PM2
process, and save. Preserve unexpected checkout changes before pulling
or rolling back.
