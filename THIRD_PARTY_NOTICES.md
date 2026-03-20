# Third-Party Notices

This project includes third-party software and third-party artwork in
distributed package artifacts under `dist/`.

This document lists the third-party packages bundled into those artifacts and
the applicable license notices.

## Scope

- This notice file applies to the published package artifacts produced by this
  repository.
- `dist/js/trackswitch.js` and `dist/js/trackswitch.min.js` are self-contained
  browser bundles and include third-party runtime code listed below.
- `dist/esm/**/*.js` preserves external package imports for runtime
  dependencies, but it does include embedded Font Awesome SVG path data from
  `src/ui/icons.ts`.
- `dist/css/trackswitch.min.css` is project-authored CSS and the distributed
  `dist/css/assets/*` directory includes bundled IBM Plex Sans font files.
- The project code itself remains licensed under MIT (see `LICENSE`).

## Included Third-Party Packages

### Runtime packages bundled into `dist/js/*`

| Package | Version | License |
| --- | --- | --- |
| d3 | 7.9.0 | ISC |
| opensheetmusicdisplay | 1.9.7 | BSD-3-Clause |
| papaparse | 5.5.3 | MIT |

### Embedded third-party artwork in distributed JavaScript

| Source | Version | License |
| --- | --- | --- |
| Font Awesome Free SVG icon data extracted from `@fortawesome/free-solid-svg-icons` | 7.2.0 | CC-BY-4.0 |
| Font Awesome Free SVG icon data extracted from `@fortawesome/free-regular-svg-icons` | 7.2.0 | CC-BY-4.0 |

No Font Awesome runtime/package code is bundled in the published artifacts.

### Embedded third-party font files in distributed CSS assets

| Source | Version | License |
| --- | --- | --- |
| IBM Plex Sans font files sourced from Google Fonts / Fontsource (`latin` subset, weights 400/600/700) | 23 | SIL OFL 1.1 |

### Additional packages bundled via `d3` in `dist/js/*`

- ISC: `d3-array` 3.2.4, `d3-axis` 3.0.0, `d3-brush` 3.0.0, `d3-chord` 3.0.1,
  `d3-color` 3.1.0, `d3-contour` 4.0.2, `d3-delaunay` 6.0.4,
  `d3-dispatch` 3.0.1, `d3-drag` 3.0.0, `d3-dsv` 3.0.1, `d3-fetch` 3.0.1,
  `d3-force` 3.0.0, `d3-format` 3.1.2, `d3-geo` 3.1.1,
  `d3-hierarchy` 3.1.2, `d3-interpolate` 3.0.1, `d3-path` 3.1.0,
  `d3-polygon` 3.0.1, `d3-quadtree` 3.0.1, `d3-random` 3.0.1,
  `d3-scale` 4.0.2, `d3-scale-chromatic` 3.1.0, `d3-selection` 3.0.0,
  `d3-shape` 3.2.0, `d3-time` 3.1.0, `d3-time-format` 4.1.0,
  `d3-timer` 3.0.1, `d3-transition` 3.0.1, `d3-zoom` 3.0.0,
  `internmap` 2.0.3, and `delaunator` 5.0.1.
- BSD-3-Clause: `d3-ease` 3.0.1.
- Unlicense: `robust-predicates` 3.0.2.

### Additional packages embedded in the published `opensheetmusicdisplay` browser build inside `dist/js/*`

- MIT: `vexflow` 1.2.93, `loglevel` 1.9.2, `typescript-collections` 1.3.3,
  `lie` 3.3.0, `setimmediate` 1.0.5, and `immediate` 3.0.6.
- MIT OR GPL-3.0-or-later: `jszip` 3.10.1. The MIT option is used for this
  distribution.
- MIT AND Zlib: `pako` 1.0.11.

## License Selection Notes

- `jszip` is available under dual licensing (MIT OR GPL-3.0-or-later). For
  this distribution, the MIT option is used.
- `pako` carries both MIT and Zlib license terms.
- The distributed JavaScript contains Font Awesome icon artwork only. It does
  not contain Font Awesome runtime/package code.
- The Font Awesome SIL OFL 1.1 license for font files does not apply here
  because these distributed artifacts do not bundle Font Awesome webfont or
  desktop font files.
- The distributed CSS assets bundle IBM Plex Sans font files for offline and
  consistent UI rendering. These files are redistributed under the SIL Open
  Font License 1.1.

## Full License Texts

The license texts below are embedded once per license family and apply to the
packages listed in each section.

### BSD-3-Clause (applies to: `opensheetmusicdisplay`, `d3-ease`)

Applicable copyright notices:

- Copyright 2019 PhonicScore (`opensheetmusicdisplay`)
- Copyright 2010-2021 Mike Bostock (`d3-ease`)
- Copyright 2001 Robert Penner (`d3-ease`)

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

### MIT (applies to: `vexflow`, `jszip` [MIT option], `pako`, `loglevel`, `typescript-collections`, `lie`, `setimmediate`, `immediate`, `papaparse`)

Applicable copyright notices:

- Copyright (c) 2010 Mohit Muthanna Cheppudira (`vexflow`)
- Copyright (c) 2009-2016 Stuart Knightley, David Duponchel, Franz Buchinger, Antonio Afonso (`jszip`)
- Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn (`pako`)
- Copyright (c) 2013 Tim Perry (`loglevel`)
- Copyright (c) 2010-2017 Tomasz Ciborski (`typescript-collections`)
- Copyright (c) 2014-2018 Calvin Metcalf, Jordan Harband (`lie`)
- Copyright (c) 2012 Barnesandnoble.com, llc, Donavon West, and Domenic Denicola (`setimmediate`)
- Copyright (c) 2012 Barnesandnoble.com, llc, Donavon West, Domenic Denicola, Brian Cavalier (`immediate`)
- Copyright (c) 2015 Matthew Holt (`papaparse`)
Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### CC BY 4.0 (applies to: Font Awesome Free icon artwork embedded as SVG path data)

Font Awesome Free icons are licensed under Creative Commons Attribution 4.0
International.

- Canonical license text: https://creativecommons.org/licenses/by/4.0/legalcode
- Human-readable summary: https://creativecommons.org/licenses/by/4.0/

Copyright (c) 2026 Fonticons, Inc.

### ISC (applies to: `d3`, `d3-array`, `d3-axis`, `d3-brush`, `d3-chord`, `d3-color`, `d3-contour`, `d3-delaunay`, `d3-dispatch`, `d3-drag`, `d3-dsv`, `d3-fetch`, `d3-force`, `d3-format`, `d3-geo`, `d3-hierarchy`, `d3-interpolate`, `d3-path`, `d3-polygon`, `d3-quadtree`, `d3-random`, `d3-scale`, `d3-scale-chromatic`, `d3-selection`, `d3-shape`, `d3-time`, `d3-time-format`, `d3-timer`, `d3-transition`, `d3-zoom`, `internmap`, `delaunator`)

Applicable copyright notices:

- Copyright 2010-2023 Mike Bostock (`d3` and the bundled `d3-*` packages)
- Copyright 2021 Mike Bostock (`internmap`)
- Copyright (c) 2021, Mapbox (`delaunator`)

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.

### SIL OFL 1.1 (applies to: `IBM Plex Sans` font files bundled in `dist/css/assets/*`)

Applicable copyright notice:

- Copyright 2019 IBM Corp. All rights reserved.

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.

### Zlib (applies to: `pako`)

Copyright notice:

(C) 1995-2013 Jean-loup Gailly and Mark Adler

This software is provided "as-is", without any express or implied warranty. In
no event will the authors be held liable for any damages arising from the use
of this software.

Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it freely,
subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim
   that you wrote the original software. If you use this software in a
   product, an acknowledgment in the product documentation would be appreciated
   but is not required.
2. Altered source versions must be plainly marked as such, and must not be
   misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution.

### Unlicense (applies to: `robust-predicates`)

This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or distribute
this software, either in source code form or as a compiled binary, for any
purpose, commercial or non-commercial, and by any means.

In jurisdictions that recognize copyright laws, the author or authors of this
software dedicate any and all copyright interest in the software to the public
domain. We make this dedication for the benefit of the public at large and to
the detriment of our heirs and successors. We intend this dedication to be an
overt act of relinquishment in perpetuity of all present and future rights to
this software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <http://unlicense.org>

If distributing built artifacts separately from source, include this file
together with the relevant third-party license texts.
