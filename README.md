# Pixel Quest Camping Day 🏕️

An 8-bit camping adventure, originally designed and drawn by two kids in Scratch,
rebuilt as a mobile web game (PWA).

## The Story

One day, Pixely, Emily, and their family packed up all their camping gear.

> "Hey Dad," said Pixely. "When are we going?"
>
> "Yes," Dad replied.

Then they started the car and set off up the mountain. But partway along the
winding mountain road — *BUMP!* — they hit a giant pothole. "Ahhh!" screamed Mom.
The car slammed down on its tires, and *POP!* — the tires blew out.

Stranded, with all their camping gear piled in the woods right beside them, they
had no choice but to make camp right there — not at all where they'd planned to
go. So they unpacked the tent, set up camp, and headed off into the trees to hunt
for food.

*The end.* (Or is it just the beginning?)

## Play

Pick Pixely or Emily and explore the forest world. BONK the ants to clear each
area and uncover the 7 hidden keys, collect treasures to unlock a flashlight and
earn hat powers, sleep in the tent to heal, and bank your loot in the chest. Once
you've found all 7 keys, open the cave — then delve into the dark dungeon, defeat
the Queen Ant, and escape before it collapses on you!

- Works on any phone, tablet, or computer browser — add to home screen for
  full-screen offline play
- Touch: drag anywhere to move (virtual joystick), tap BONK to swing
- Keyboard: arrows/WASD to move, Space to bonk

## Tech

Vanilla JavaScript + Canvas, zero dependencies, no build step. All map art is
drawn in code; the characters, ants, collectibles, and screens are the kids'
original pixel art from their Scratch project (preserved in `scratch-export/`).

When releasing changes, bump the `CACHE` version in `sw.js` so players get the
update instead of the cached copy.
