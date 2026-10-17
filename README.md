# Football Dynasty

A browser-based football management simulation.

## Release

The 1.23f publishing package contains the 1.23b game engine and 1.23d web launcher. The 414 game files are unchanged.

`football-dynasty-site.zip` contains the website. The GitHub Pages workflow verifies its SHA-256 checksum, extracts it, validates asset paths and content integrity, and deploys it. Changes to the archive or workflow on `main` trigger deployment; the workflow can also be run manually from Actions.

## Playing and saves

The published root opens the career hub. `play.html` opens the single-player launcher, and `hosting-check.html` checks the deployed assets and optional SHA-256 hashes.

Careers are stored locally in your browser for this website address. Export a backup before moving from another host, then import it using Settings → Career Files → Import backup. Saves do not automatically transfer between domains or devices. Cloud saves and multiplayer are not connected.

## Release validation

The packaged static preflight passes 99 asset-link and content-integrity checks. Hosted gameplay and save testing are separate checks.

No exported careers, browser storage, passwords, or access tokens belong in this repository.
