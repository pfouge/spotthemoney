# Flags

4x3 SVG flags inlined into charts at build time (`lib/flags.ts`, `rankBarsSvg` in `lib/viz.ts`).
No flag is requested from a third party at runtime and no flag emoji is used (Windows does not
draw them).

Source: [flag-icons](https://github.com/lipis/flag-icons) 7.6.0, MIT (licence alongside). Only
the flags a chart uses are vendored: au br ca ch cn de eu hk in jp kr sa se tw us za.

`es.svg` is not the flag-icons file. That one carries the full coat of arms and is 81 KB, which a
chart would inline three times (wide, narrow and phone builds) to draw a flag 19 px wide. This
file is Spain's flag without the arms (the civil flag), 3 stripes, drawn here.

To add a flag: copy `flags/4x3/<code>.svg` from the same flag-icons version into this folder.
