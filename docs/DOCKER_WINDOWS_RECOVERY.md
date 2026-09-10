# Docker Desktop startup recovery on James's Windows machine

Recorded September 9, 2026 (America/Los_Angeles). The user confirmed that the safe-start shortcut worked.

## Installation and tested workaround

- Docker Desktop: `4.90.0.238679`; engine: `29.7.2`.
- Executable: `D:\abc\DockerDesktop\App\Docker Desktop.exe`
- Container data: `D:\abc\DockerDesktop\Data`
- Recovery launcher: `D:\abc\DockerDesktop\Start-Docker-Desktop.ps1`
- Desktop shortcut: `C:\Users\james\OneDrive\Desktop\Docker Desktop (Safe Start).lnk`
- The shortcut invokes Windows PowerShell with `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "D:\abc\DockerDesktop\Start-Docker-Desktop.ps1"`.

Use the **Docker Desktop (Safe Start)** desktop shortcut for normal starts. No special arguments to Docker Desktop itself are needed. The launcher and shortcut are machine-local files, not provisioned automatically by this repository.

## Diagnosis

Docker crashed before starting the engine because Windows would not let it remove or rename stale AF_UNIX socket files. Confirmed error paths included:

- `%LOCALAPPDATA%\Docker\run\sailor-ingest.sock`
- `%LOCALAPPDATA%\Docker\run\dockerInference`
- `%LOCALAPPDATA%\docker-secrets-engine\engine.sock`

The log said `The file cannot be accessed by the system`, sometimes with `The filename, directory name, or volume label syntax is incorrect`. These socket files showed the `ReparsePoint` attribute. The containing runtime directories were ordinary directories, not junctions.

The backend log is `%LOCALAPPDATA%\Docker\log\host\com.docker.backend.exe.log`. Read its recent entries and inspect running processes before taking action. An unavailable engine alone does not prove this particular issue.

Related upstream reports:

- https://github.com/docker/desktop-feedback/issues/448
- https://github.com/docker/desktop-feedback/issues/460

This is a tested workaround, not a confirmed permanent upstream fix. Do not promise it fixes every startup failure.

## What the launcher does

1. Takes a named mutex to avoid concurrent safe-start launches.
2. If `com.docker.backend` is running, opens Docker Desktop without touching runtime folders.
3. Otherwise, renames each nonempty runtime directory below to a timestamped sibling, then creates a fresh empty directory at its original path:
   - `%LOCALAPPDATA%\Docker\run`
   - `%LOCALAPPDATA%\docker-secrets-engine`
4. Refuses to rotate a runtime directory if the directory itself is a reparse point.
5. Starts the installed Docker Desktop executable. Errors are shown in a message box.

Old directories are retained as `.stale-<timestamp>`; previous manual recoveries used `.repair-<timestamp>`. They are not automatically deleted. The script does not alter images, volumes, settings, or the D: data directory.

## If a crashed backend is still running

The launcher intentionally does not kill an existing backend, so it will not recover a crash dialog with lingering backend processes by itself.

1. Inspect `docker info`, Docker processes, and the backend log. Confirm the stale-socket error.
2. Prefer a clean shutdown: `docker desktop stop --timeout 30`.
3. If a failed startup has left orphaned processes, stop the Docker Desktop/backend processes before rotating any runtime directories. Do not force-stop a healthy engine without considering running workloads.
4. Verify the backend has stopped, then run the safe-start launcher. Do not race directory rotation against a still-running or restarting backend.
5. Wait for startup and verify `docker info --format '{{.ServerVersion}}'` and `docker ps`.

If the launcher is missing, reconstruct its behavior above using native PowerShell `Rename-Item -LiteralPath` and `New-Item`. Rename both affected runtime directories while Docker is stopped; clearing only one can expose the next stale socket. Preserve backups and inspect exact paths first.

## Verified outcome and limits

After rotating the two runtime directories, Docker started. A subsequent clean shutdown followed by the safe-start launcher also succeeded, returning engine version `29.7.2`. Supabase database, auth, storage, and multiple other containers reported healthy. The user confirmed the shortcut worked.

The Supabase Vector logging container was restarting during verification; do not represent every Supabase component as healthy. That was separate from the resolved Desktop startup failure. A full Windows reboot was not tested.

Do not factory-reset Docker, delete volumes, remove the D: data directory, or reinstall/downgrade as a first response. The user wants the newer Docker version and moved installation/data to D: because C: has limited free space. Check current disk space rather than assuming every startup failure is storage-related.
