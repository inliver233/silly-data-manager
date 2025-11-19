# SillyTavernchat Data Upload Service (`dmsystem/`)

This directory contains a standalone Node.js + Express service and a small SPA
frontend that implements the "cloud tavern data upload system" described in
`data上传系统技术报告.md`.

The service is designed to run side-by-side with the main SillyTavernchat
process and only interacts with it via the shared `DATA_ROOT` directory
(`./data` by default, or `/root/SillyTavernchat/data` in production).

## Features (high-level)

- LinuxDo OAuth2 login, mapped to SillyTavern `handle` via `normalizeHandle`.
- Per-user data status view for `DATA_ROOT/{handle}`.
- Upload of `data.zip` (≤ 100MB), safe extraction, structure detection
  (single user directory vs `data/` root), and security checks.
- Pre-upload backup of `DATA_ROOT/{handle}` and merge/overwrite logic for
  characters, chats, presets, assets, and key JSON files.
- One-click rollback to the previous upload snapshot.
- Admin backend with separate credentials and JSONL logs under
  `DATA_ROOT/_upload_service/logs/`.

## Running locally

From the repository root:

```bash
cd dmsystem
cp .env.example .env
# edit .env as needed (DATA_ROOT, CLIENT_ID, CLIENT_SECRET, etc.)
npm install
npm run start
```

The service listens on `PORT` (default `23669`) and serves the SPA at `/`.


