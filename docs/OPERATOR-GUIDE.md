# Operator Guide

## Start The System

Preferred:

- double-click `Start Dr Sherin Pharmacy.command`
- or `Dr Sherin Pharmacy.app` on macOS
- or `Start Dr Sherin Pharmacy.bat` on Windows
- or `Start Dr Sherin Pharmacy Portable.bat` on Windows if using the portable release folder

Terminal alternative:

```bash
npm start
```

## Verify Before Delivery

Run:

```bash
npm run check:delivery
```

## Backup Workflow

Daily:
- open `Settings`
- click `Backup Now`

Before imports:
- click `Backup Now`
- optionally export `System Backup Workbook`

## Restore Workflow

Use only when needed:

1. Open `Settings`
2. Upload `.db` backup
3. Wait until the restore finishes
4. Confirm counts in `Clients` and `Follow-Ups`

## Export / Import

Export:
- `Settings` -> `System Backup Workbook`

Import:
- `Import Data` for manual sheets
- `Upload System Backup` for exported system `.xlsx`

## Cleanup Tools

Dry run cleanup:

```bash
npm run clean:db -- --dry-run
```

Real cleanup:

```bash
npm run clean:db
```

Exact duplicate cleanup:

```bash
npm run dedupe:db
```

## Support Notes

- Frontend local URL: `http://127.0.0.1:4173`
- Backend local URL: `http://127.0.0.1:3001`
- Database file: `pharmacy.db`
- Backups folder: `backups/`

## Final Delivery Checklist

- `npm run check:delivery`
- create one manual `.db` backup
- create one `System Backup Workbook`
- confirm `Clients`, `Follow-Ups`, `Import Data`, `Settings`, and `Sync` open correctly
- hand over this guide with the app

## Windows Portable Build

Run this only on a Windows machine:

```bash
npm install
npm run package:windows-portable
```

Then deliver:

- `release/windows-portable`
