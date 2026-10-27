# Third-party notices for the harness

The harness in this folder is test code. None of it is in module.zip (the release workflow leaves
`test/` out), and none of it runs in Foundry.

## dnd5e

actor5e.mjs, activity5e.mjs, enchant5e.mjs, dnd5e-cards.mjs, favorites-core.mjs and transform5e.mjs
are stand-ins ported from the dnd5e system 5.3.3 (https://github.com/foundryvtt/dnd5e), as far as the
module's commands use it; transform5e.mjs ports its Actor5e#transformInto and #revertOriginalForm,
its transformation presets and TransformationSetting, and the Transform activity's data. dnd5e's software is distributed under the MIT license, whose notice follows. The
harness also loads dnd5e's own dice classes, its lang/en.json and one of its templates at run time,
from the releases pinned in `test/pins.env`; those are fetched by `test/dnd5e.sh` and never
committed here.

```
Copyright 2021 Andrew Clayton

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

transform5e.mjs also holds, as its fixtures, a few creatures' numbers (names, scores, armor class,
hit points, speeds, size, Challenge Rating and their first attack), the 2024 Wild Shape feature's
data and the druid's scale values, read from dnd5e 5.3.3's packs/_source, whose files mark them
CC-BY-4.0: the System Reference Document 5.2 by Wizards of the Coast LLC, licensed under the
Creative Commons Attribution 4.0 International License (https://creativecommons.org/licenses/by/4.0/legalcode). Its Moon Hare, Ogre and characters
are synthetic.

## Midi-QOL

midi-fake.mjs, midi-saves.mjs and midi-critical.mjs are stand-ins modelled on Midi-QOL
(https://gitlab.com/tposney/midi-qol, Creative Commons Attribution 3.0 Unported). A few short lines
follow its source: a method's signature and a chat card's markup. No Midi-QOL file is copied, shipped
in module.zip, or run.

## Foundry VTT

No Foundry VTT file is used. stub.mjs, dice-core.mjs, settings-app.mjs and crit-parentheticals.mjs
are stand-ins written for the harness.
