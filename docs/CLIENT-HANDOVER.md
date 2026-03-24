# Client Handover

## What To Open

Use:

- `Start Dr Sherin Pharmacy.command`
- `Dr Sherin Pharmacy.app` on macOS
- `Start Dr Sherin Pharmacy.bat` on Windows
- `Start Dr Sherin Pharmacy Portable.bat` on Windows if a portable package was prepared

or run:

```bash
npm start
```

Then open:

- `http://127.0.0.1:4173`

## Main Daily Use

1. Open `Clients` to add or edit client data.
2. Open `Follow-Ups` to add new follow-up records.
3. Use `Dashboard` and `Progress` to review activity and trends.

## Backup

Open `Settings`:

- `Backup Now` downloads a `.db` backup
- `System Backup Workbook` downloads an `.xlsx` backup

Recommended:
- create a `.db` backup daily
- keep the `.xlsx` file as a readable secondary backup

## Restore

Open `Settings`:

- use the restore card to upload a `.db` backup

Important:
- restoring replaces the current live data
- the system creates a safety backup first

## Import

Open `Import Data`:

- use the normal importer for normal sheets
- use the system backup importer for exported system `.xlsx` files
- use the Arabic legacy flow for old Arabic workbooks

## Sync

Open `Sync` if Google Drive sync is configured.

## Important Notes

- Do not work directly inside `pharmacy.db`
- Always create a backup before large imports
- Do not close the system during backup, restore, or import
