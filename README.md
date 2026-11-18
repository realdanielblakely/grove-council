# Canopy Council

A walkable council chamber in a jungle clearing, explored in the browser as a third-person character.

Twelve tall white shell seats stand around a segmented stone table on a circular platform with a gold inlay ring. Gnarled trees, a dense canopy, waterfalls, and dappled light close in around the clearing. Walk in through the gaps in the table, sit in any seat, and look around.

Built with three.js, TypeScript, and Vite. Every model and texture is generated in code at load time, and the project ships no image or model files.

## Run it locally

You need Node.js 20.19 or newer (22 LTS recommended).

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:47317>. The loading card builds the clearing, which takes a few seconds. Then choose **Enter the clearing**.

To make a production build:

```bash
npm run build     # type-checks, then writes a static site to dist/
npm run preview   # serves dist/ at http://127.0.0.1:47318
```

`dist/` is a plain static site with relative asset paths, so any static host can serve it, including from a sub-path.

## Controls

### Keyboard and mouse

| Input                   | Action                                                         |
| ----------------------- | -------------------------------------------------------------- |
| `W` `A` `S` `D` / arrows | Move, relative to the camera                                   |
| `Shift`                 | Run                                                            |
| `Space`                 | Jump (stands you up when seated)                               |
| Mouse                   | Look: click the scene to lock the pointer (`Esc` releases it), or drag |
| Mouse wheel             | Camera distance in third person                                |
| `E`                     | Sit in the nearest chair, or stand up                          |
| `V`                     | Switch between first and third person                          |
| `M`                     | Fill the empty seats with faceless mannequins, or clear them   |
| `O`                     | Overview from above, press again to return                     |
| `H`                     | Hide or show the controls card                                 |

To sit, walk up to any chair until the **Sit down** prompt appears, then press `E` or click the prompt. Your character walks around to the open front of the seat and sits. The camera settles into a seated view facing the center, and you can still look around. To get up, press `E` or `Space`, or start walking.

You collide with the tables, chairs, and tree trunks. You can jump onto the table slabs.

### Touch

- **Left half of the screen:** a floating joystick. Push it to the edge to run.
- **Right half:** drag to look around.
- **Buttons:** Jump, Sit, View (first or third person), Seats (mannequins), and Above (overview).
- **Controls title:** tap it to collapse the card.

## Performance

The scene targets 60 fps in a laptop browser:

- The shadow map is static and re-renders only when something in it changes.
- Foliage and rocks are instanced.
- The moving character uses a soft blob shadow.

The renderer also adapts its pixel ratio to frame time. It ranges from 0.75 up to your display's ratio, capped at 1.75 (1.5 on touch devices). Add `?ratio=` to the URL to pin it, for example <http://127.0.0.1:47317/?ratio=1>. Lower values help weaker GPUs.

## Project layout

```
src/
  app.ts            renderer, main loop, adaptive resolution, action wiring
  camera.ts         third-person, first-person, seated, and overview camera rig
  input.ts          keyboard, mouse and pointer lock, touch joystick
  config.ts         chamber dimensions and player tuning
  physics/          circle and polygon collision with heights
  player/           character controller, sit and stand routes, avatar and mannequins
  world/            platform, table, chairs, trees, foliage, ground, water, light, textures
  ui/hud.ts         HUD, prompts, loading and error states
```

Development builds expose `window.council`, which can step or freeze the simulation for scripted screenshots. Production builds leave it out.

## Credits and licenses

- [three.js](https://threejs.org), MIT License. Rendering.
- [Cinzel](https://fonts.google.com/specimen/Cinzel) by Natanael Gama and [Inter](https://rsms.me/inter/) by Rasmus Andersson, both under the SIL Open Font License 1.1. They're bundled through [Fontsource](https://fontsource.org) (`@fontsource/cinzel`, `@fontsource-variable/inter`).
- [Vite](https://vite.dev), MIT License, and [TypeScript](https://www.typescriptlang.org), Apache License 2.0. Tooling only.
- All geometry and all textures were generated procedurally in code for this project:
  - Geometry: chairs, table, platform, trees, foliage, waterfalls, avatar, and mannequins.
  - Textures: stone, leaf litter, leaves, ferns, grass, and the light cookie.
  - No third-party models, textures, or audio are used.
- The chamber, chairs, and character are original designs. No existing characters, likenesses, costumes, names, or logos appear, and the floor inlay is an abstract gold ring with no emblem.

## Known issue

`npm audit` reports a high-severity advisory in `picomatch` ([GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)). Vite pulls it in through its file-globbing dependencies. No patched release exists yet. The issue affects only the local dev server and build tooling, never the built site, and npm's suggested fix is a breaking downgrade of Vite, so the dependency is left as is.
