# Running a verified local service build

A locally modified build can differ from the newer package installed by npm. A
service registered with a global `jaw` symlink follows that installation, so a
package update can remove local features even when its version number increases.

This launcher is opt-in. Installing the npm package does not enable it or change
any service registration. The package includes the launcher and all five hidden
zsh forwarding files through its existing `scripts/` allowlist.

For an operator-managed local build, deploy the complete package and runtime
dependencies to a dedicated versioned directory outside npm's global prefix.
Keep that directory unchanged while it is active. `scripts/service-artifact.mjs`
verifies a complete regular-file inventory before importing the CLI in the same
process. Its manifest digest must be recorded outside the release, in the service
manager's command arguments. This detects accidental changes; it is not a signature
or a sandbox against an owner who can edit both the launcher and its digest.

The launcher prepends the verified entrypoint directory to child PATH. Package
regular executable `jaw` and `cli-jaw` aliases beside `cli-jaw.js` (byte-identical
copies), so shell tools use the same build as the service. Verify resolution inside
the actual agent shell too; a shell startup file may override inherited PATH.
When the complete `scripts/service-shell/zsh` set is packaged, the launcher uses
a service-scoped ZDOTDIR that forwards the original user startup files and then
restores the verified CLI directory. User dotfiles and ordinary terminal sessions
are unchanged. Explicit other shells or absolute global binary paths are outside
this zsh command-resolution guarantee. The same applies to `zsh -f`, startup
files that exit/exec, and PATH edits after startup. Logout forwarding follows
zsh itself: noninteractive shells do not run `.zlogout`.

The release must contain no symlinks. Materialize contained dependency links when
packaging, and reject links escaping the selected dependency tree. The manifest
itself is the sole file excluded from its inventory:

```json
{
  "schemaVersion": 1,
  "version": "2.17.42",
  "entrypoint": "dist/bin/cli-jaw.js",
  "files": { "relative/file": "64 lowercase hexadecimal SHA-256 characters" }
}
```

First inspect without starting the service:

```sh
node /absolute/release/scripts/service-artifact.mjs \
  --root /absolute/release --manifest-sha256 EXPECTED_DIGEST --check
```

Register that same launcher, root and digest with the existing service manager;
append `-- --home /absolute/private/home serve --port PORT`. Preserve the existing
home, log paths, environment and label. Back up its registration first, check the
current service is idle, and use the home-scoped lifecycle owner to stop it before
loading the replacement registration. Verify readiness, PID/start time, actual
loaded command and the exact artifact digest after startup. Validate the intended
feature too; process health and a larger package version do not prove its presence.

Normal `jaw --home … service restart` retains the existing native registration.
A global npm update or global bin-link change does not affect this dedicated
release. Explicit `jaw service` / `jaw launchd` registration can replace its command:
inspect the registration again after any such operation. Pinning deliberately does
not adopt later npm releases automatically. Build and verify a new artifact when
updating this service; keep the old artifact and registration until the new one
passes its smoke checks. Roll back by restoring the saved native registration,
not by modifying the active release in place.
