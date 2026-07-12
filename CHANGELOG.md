# Roger, Roger! An OggDude XML Importer

## Current Build Summary for the Next Foundry VTT Update

Version: 1.3.0

This build includes the full importer workflow for bringing OggDude Character Generator XML exports into a Star Wars FFG character actor inside Foundry VTT.

## What Has Been Built

### Core Import Workflow
- Added an Import XML action to the character sheet header.
- Added a file selection dialog for importing OggDude XML files.
- Implemented a full replacement import flow that clears existing actor items and effects before rebuilding the character from the XML.
- Rebuilds the imported character from the XML into the actor, including name and core sheet data.

### Character Data Import
- Imports and rebuilds:
  - species
  - career
  - specialization(s)
  - characteristics
  - skills
  - talents
  - gear
  - derived stats
- Recreates the character’s important mechanical state from the XML rather than only copying raw text values.

### Compendium and Item Linking
- Attempts to link imported items to existing world or compendium content where matching records are available.
- Uses compendium-backed sources when possible to preserve the expected Star Wars FFG item structure.
- Includes support for resolving linked catalogs for items, attachments, and other imported content.

### Equipment and Attachment Support
- Imports weapons, armor, and gear with the correct item type handling.
- Supports installed attachments on gear and equipment.
- Applies attachment-based bonuses where the system expects them.
- Handles crafted or installed mods on attachments where possible.
- Applies hard-point capacity adjustments from attachment mods such as HPADD.
- Includes support for superior-quality armour bonuses where the system would otherwise lose them.

### Talent, Specialization, and Force Power Handling
- Imports purchased talents and marks them as learned on linked specialization trees.
- Supports specialization talent-tree preparation so purchased talents reflect the system’s expected state.
- Imports purchased force powers and marks learned upgrades when applicable.
- Handles talent and attachment-based stat changes that need to be applied as actor effects.

### Skill and Effect Compatibility
- Supports the active skill theme configured in the world when available.
- Includes fallback handling for the standard Star Wars FFG skill list.
- Corrects skill die-modifier effects that were previously collapsing incorrectly for grouped skill talents.
- Applies and preserves the correct effect structure so imported talents and modifiers behave more like native system data.

## Current Module Behavior

- The importer is designed to replace the current character data with the imported XML data.
- Existing actor items and effects are removed first to avoid stale or mixed state.
- If matching compendium or catalog entries are not found, the importer will report those items as stubbed rather than silently failing.
- The UI warns users that importing replaces the character, which is intentional and part of the module’s workflow.

## Compatibility

- Foundry VTT: v12–v14
- System: Star Wars FFG (starwarsffg)

## Summary

This update packages the importer’s current feature set into a release-ready module build for Foundry VTT users who want to bring OggDude character exports into Star Wars FFG characters with a more complete and structured import process.
