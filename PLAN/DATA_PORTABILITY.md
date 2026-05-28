# CodeStock Data Portability Policy

## Decision

CodeStock keeps the local database as the primary runtime storage.

JSON plus an attachments zip is used only as a migration, backup, and restore
format. It is not the normal persistence format.

## Runtime Storage

- Desktop app: local SQLite database under the Tauri app data directory.
- Attachments: files under the Tauri app data `attachments` directory.
- Browser fallback: localStorage, only for development and fallback use.

Normal create, edit, search, copy, and preview flows should continue to read
from local storage directly. Export and import must not be part of the hot path.

## Migration Format

An export bundle should contain:

- `codestock-export.json`
  - snippets
  - code blocks
  - tags
  - snippet-tag relationships
  - attachment metadata
- `attachments/`
  - image files copied from the local attachment store

The bundle should be packaged as a zip file for transfer to another PC.

## Import Behavior

- Import should run as an explicit user action.
- Database writes should run in a transaction.
- Attachment files should be copied into the local app attachment directory.
- Imported attachment metadata should point to the new local file paths.
- Re-import should avoid accidental duplicates where possible.

## Performance Rule

Export and import may take time for large image collections.

That cost is acceptable because it happens only during migration, backup, or
restore. The default local database workflow must stay fast.
