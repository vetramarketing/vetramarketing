# MongoDB workspace storage

VETRA Marketing uses a single private workspace on a loopback-bound Next.js server. Keep the MongoDB URI in the server environment. The server selects the database from `MONGODB_DB`, then the database name in the URI, then `vetra_marketing`. Use a MongoDB replica set or Atlas cluster with transaction support. The database account needs read/write access to this project's database.

## Local access

Run the project with its loopback-bound start or dev script. The workspace API accepts HTTP requests for localhost, 127.0.0.1 or IPv6 loopback on the configured port (3100 by default). Set `VETRA_WORKSPACE_ORIGIN` to pin a particular loopback origin. Browser mutations require a matching Origin. Public or cross-site requests cannot access database-backed records. A public, multi-user deployment requires sign-in and server-side workspace authorization.

## Workspace and file storage

The wire format is the same versioned JSON contract as workspace backups. Current writes use v12. The server validates the workspace and preserves application IDs, ordering, nested records, order sequences, shipping settings, applied data updates and Trash. The active browser key and older recovery keys remain available during migration. The locale, selected company and daily click counters are browser preferences.

Nine MongoDB collections store records individually. Each `vetra_` collection uses the stable application ID as its unique document key and stores the record and its position. The collections cover companies, business types, customers, scripts, orders, products, groups, destinations and posts. The `vetra_workspace` document holds workspace metadata, the current revision, the content checksum and the initial source checksum. This layout lets a workspace exceed the size of a single MongoDB document. Names beginning with `vetra_` in the chosen database are reserved for this application.

Company logos and product images are verified through Cloudinary before the corresponding changes commit. Orders keep carrier-document references. Private carrier PDF binaries are stored separately in MongoDB and must match the saved references. The bundled Facebook directory remains a reference catalog.

## Migration and edits

A GET to `/api/workspace` reads a consistent transaction snapshot and checks its checksum. An empty database returns `WORKSPACE_NOT_INITIALIZED`. A missing URI allows browser-only operation. If the local API identifies a temporary MongoDB outage, operators with a cached snapshot for the same configured database can choose **Open last synced workspace**. The app displays when it received the snapshot and opens it read-only. Settings can export the cached records and file references. Reload reconnects to MongoDB when service resumes.

POST uses a serialized workspace, an operation ID and the expected revision. A null expected revision is create-only. An initial import preserves any existing post-identity collisions. Later edits reject newly introduced active duplicates. A stale revision returns HTTP 409. Unrelated records or orphaned rows in the project's entity collections prevent first initialization until reviewed.

The server verifies referenced carrier PDFs and uploads changed catalog images before the transaction. The transaction compares the revision again, writes changed records, updates collection order and saves a retry receipt together. A retry with the same operation and content can acknowledge an already committed current revision. An older operation cannot overwrite newer work. Writes use majority acknowledgement and reads use snapshot isolation. MongoDB stores each saved catalog URL and its verified media metadata for use by Trash and restores.

For migration verification, read the committed workspace back, compare all source records and references, and account explicitly for image URLs replaced by Cloudinary. Keep the original browser data or exported backup for recovery. Use the application's existing retention behavior for expired Trash rather than independently expiring group or order records at the database level.
