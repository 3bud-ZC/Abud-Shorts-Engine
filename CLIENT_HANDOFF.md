# ABUD Shorts Engine V2.4.0-rc.1 - Client Handoff

## What The Client Receives

- `ABUD-Shorts-Engine-2.4.0-rc.1.tar.gz`
- `update-manifest.json`
- `ABUD-Shorts-Engine-2.2.0.tar.gz.sha256`
- Release notes and quick-start documentation

## Install

Windows: extract the package, then double-click `INSTALL-ABUD-SHORTS.bat`.

Linux/VPS:

```bash
sudo ./install.sh --url https://shorts.yourdomain.com
```

## Operate

Linux/VPS:

```bash
sudo abud-shorts status
sudo abud-shorts update
sudo abud-shorts backup
sudo abud-shorts diagnostics
sudo abud-shorts restart
sudo abud-shorts rollback
```

Windows: double-click `START-ABUD-SHORTS.bat` / `UPDATE-ABUD-SHORTS.bat` /
`BACKUP-ABUD-SHORTS.bat` / `DIAGNOSTICS-ABUD-SHORTS.bat` in the install
folder, or use the **ABUD Shorts** Start Menu shortcuts.

## First Setup

Open the installer URL with `/setup`, create the administrator account, add
optional provider keys, configure brand defaults and create the first video.

Arabic videos require a customer ElevenLabs key configured in the app. Secrets
are stored encrypted and are not returned in diagnostics or package artifacts.

## Support

Use **Settings -> System -> Download Support Bundle** or run
`sudo abud-shorts diagnostics`. The bundle is designed to redact passwords,
API keys and OAuth tokens.
