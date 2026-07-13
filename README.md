# Pixel Quest Camping Day 🏕️

An 8-bit Zelda-style camping adventure, originally designed and drawn by two kids
in Scratch, rebuilt as a mobile web game (PWA).

**Play:** pick Pixely or Emily, explore the 3×3 forest world, collect 15 treasures,
dodge (or BONK) the ants, sleep in the tent, bank your loot in the chest, defeat
the Queen Ant, and spend your savings on hats.

- Works on any phone, tablet, or computer browser — add to home screen for
  full-screen offline play
- Touch: drag anywhere to move (virtual joystick), tap BONK to swing
- Keyboard: arrows/WASD to move, Space to bonk

## Tech

Vanilla JavaScript + Canvas, zero dependencies, no build step. All map art is
drawn in code; the characters, ants, collectibles, and screens are the kids'
original pixel art from their Scratch project (preserved in `scratch-export/`).

Run locally: `node .claude/serve.mjs` then open http://127.0.0.1:8321

When releasing changes, bump the `CACHE` version in `sw.js` so players get the
update instead of the cached copy.
