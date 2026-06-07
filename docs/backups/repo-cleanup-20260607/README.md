# Repo Cleanup Backup, 2026-06-07

This backup was created before repository cleanup.

Full recoverable copies are stored on disk in `current-root/` and `sibling/`, and copied to S3 under `s3://presttige-ulttra-backups-343218208384/repo-cleanup/repo-cleanup-20260607/`.

Git intentionally tracks this README plus `git-safe/` manifests and text snapshots. The full audit artifact tree is not committed to Git because it is approximately 1.1 GB and contains generated deployment artifacts. Presigned AWS URL material was sanitized in the backup copies before S3 upload.
