# Roger, Roger! An OggDude XML Importer

A Foundry VTT module for the **Star Wars FFG** system (`starwarsffg`) that imports
OggDude Character Generator XML exports onto an existing character actor.

It adds an **Import XML** button to the character sheet header. Importing performs a
full replacement: existing items and effects are cleared first, then the character's
species, career, specialization, talents, skills, characteristics, gear, and derived
stats are rebuilt from the XML (linking to your world's compendia where possible).

## Compatibility

- Foundry VTT: v12–v14
- System: `starwarsffg`

## Installation (manifest URL)

In Foundry: **Add-on Modules → Install Module**, then paste the manifest URL:

```
https://github.com/OWNER/REPO/releases/latest/download/module.json
```

Updates are picked up via the same URL — Foundry's **Update** button will fetch the
newest release.

## Usage

1. Enable the module in your world.
2. Open a `character` actor sheet.
3. Click **Import XML** in the sheet header and choose your OggDude `.xml` export.

> Importing **replaces** the character. All existing items and effects on the actor
> are removed first, then the imported data is written in fresh.
