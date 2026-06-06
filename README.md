# Dr. Sherin Pharmacy

Local pharmacy follow-up system for:
- clients
- follow-ups
- import/export
- backup/restore
- Google Drive sync

## Delivery Start

For normal client use:

```bash
npm start
```

This starts:
- backend on `http://127.0.0.1:3001`
- built frontend on `http://127.0.0.1:4173`

On macOS you can also double-click:

- `Start Dr Sherin Pharmacy.command`
- `Dr Sherin Pharmacy.app`

On Windows you can double-click:

- `Start Dr Sherin Pharmacy.bat`
- `Start Dr Sherin Pharmacy Portable.bat` if a bundled runtime is included

PowerShell fallback:

- `Start Dr Sherin Pharmacy.ps1`

## Desktop App (.exe / .app)

This project now includes an Electron desktop wrapper, so the client can run it as a real app
window without a terminal.

Local desktop test:

```bash
npm run electron:start
```

Windows `.exe` build:

```bash
npm install
npm run electron:dist:win
```

Windows portable desktop build:

```bash
npm install
npm run electron:dist:portable
```

The generated Electron packages will be placed in:

- `release/electron`

## Windows Without Installing Anything

This project can be delivered to a Windows client without requiring them to install Node, but the
portable package must be prepared on a real Windows machine first because `better-sqlite3` uses
Windows-native binaries.

On a Windows build machine:

```bash
npm install
npm run package:windows-portable
```

That creates:

- `release/windows-portable`

Give that whole folder to the client, then they can run:

- `Start Dr Sherin Pharmacy Portable.bat`

## Development

Frontend dev server:

```bash
npm run dev
```

Backend:

```bash
npm run server
```

## Delivery Check

Run this before handover:

```bash
npm run check:delivery
```

It checks:
- `pharmacy.db` exists
- `clients` and `followups` tables exist
- backend syntax is valid
- production build succeeds

## Data Cleanup Tools

General cleanup:

```bash
npm run clean:db
```

Dry run:

```bash
npm run clean:db -- --dry-run
```

Exact duplicate removal:

```bash
npm run dedupe:db
```

## Handover Docs

See:

- [Client Handover](./docs/CLIENT-HANDOVER.md)
- [Operator Guide](./docs/OPERATOR-GUIDE.md)
# pharmacy-sys
