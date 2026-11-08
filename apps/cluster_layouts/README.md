# Cluster Layouts

*Part of [iDrive 7 cluster apps](../../README.md), with Cluster Info and [Cluster Centre](../cluster_centre/README.md).*

Custom layouts for the whole instrument cluster of a BMW with iDrive 7 (MGU), **drawn by the cluster
itself**. Seven original layouts (Analog sport, Digital round, Modern wide, Digital dash, Freedom, Retro and
Track), each in comfort, sport and efficient colours (following the selector's S / M
programme, or chosen), each with three centres: the **readings**, the **map** (Waze or the stock map shows in
the middle), or the **stock** centre content.

### Analog sport

Deep analog dials with satin metal bezels and warm backlit markings, coolant and oil dials set into them, and a
slim display with the time, outside temperature, gear, digital speed, fuel and electric range and the
battery's charge.

![Analog sport](../../docs/analog_sport.png)

| Sport colours (S on the selector) | Map in the centre |
|---|---|
| ![](../../docs/analog_sport_sport.png) | ![](../../docs/analog_sport_map.png) |

### Digital round

Round dials drawn as a display, a lit arc running to each needle, the fuel range in the speedometer and the
electric range and charge in the rev counter, and a card with the P R N D row, gear, speed and oil and
coolant arcs.

![Digital round](../../docs/digital_round.png)

| Efficient colours | Map in the centre |
|---|---|
| ![](../../docs/digital_round_efficient.png) | ![](../../docs/digital_round_map.png) |

### Modern wide

No round dials: segmented arcs frame the cluster, the speed and the gear stand large inside them, and the
centre holds the time, outside temperature, drive mode, ranges, charge, power and temperatures.

![Modern wide](../../docs/modern_wide.png)

| Sport colours | Map in the centre |
|---|---|
| ![](../../docs/modern_wide_sport.png) | ![](../../docs/modern_wide_map.png) |

### Digital dash

No dials at all, as much as the car tells: the engine speed as a long segmented bar under the camera's cowl,
the drive mode and engine on / off at its right end, the speed and battery power (charging or drawing) on the
left, the gear beside the KOMBI's dark box and the charge and ranges below it on the right, and six tiles in
the middle (oil, coolant, gearbox oil, intake air, the battery's temperature, boost; boost reads `--` with
the engine off), each with a trend line of its last two minutes and a bar that turns red where it is too
hot. Time, outside and the xDrive split along the bottom of the side columns. With the map in the centre the
tiles become a strip under it. 60 pieces: within the 64 layers the renderer gives an app.

Every layout keeps its readings off what the glass hides (from photos of a G05): the slanted top
corners, the camera's cowl over the top middle (to y 128), the KOMBI's dark box right of centre and its
small eDrive box at the top right (`layout_common.js`; `tools/clearance.js` checks every layout, and
`tools/test_engine.js` asserts it).

![Digital dash](../../docs/digital_dash.png)

| Sport colours | Map in the centre |
|---|---|
| ![](../../docs/digital_dash_sport.png) | ![](../../docs/digital_dash_map.png) |

### Freedom

Over the top and American: the stars and stripes wave behind everything, bald eagles fly across and
fireworks go off in red, white and blue, all drawn and moved by the cluster itself (`shaders.js`: `FLAG_FS`,
`EAGLE_FS`, `FIREWORKS_FS`, on the renderer's clock, so nothing is sent to animate them). Over it: a huge speed
inside a red-to-blue tach arc, the gear, the drive mode under a FREEDOM banner, a gold-edged plaque of readings
along the bottom, and the battery power (or engine torque) with the xDrive split right of the KOMBI's bracket.

![Freedom](../../docs/freedom.png)

### Retro

A tribute to the round-dial clusters of the 1980s and 90s: matte black faces with a thin dark rim, numerals
and ticks lit orange the way those clusters glowed at night, long slim red-orange needles over black hub caps.
A fuel gauge is set into the speedometer (the reserve in red), an economy gauge into the tach (the battery's
power on a plug-in hybrid, recuperation left of the top; boost with Vehicle: ICE), a small coolant gauge sits
between the dials over an amber LCD with the gear, the speed and the drive mode, and the ranges and the charge
are right of the KOMBI's box. With the engine off the tach's legend reads the battery's power. Comfort colours
are the classic orange, Sport a deeper red-orange, Efficient white daytime markings. An original design: no
maker's marks or names.

![Retro](../../docs/retro.png)

| Sport colours (engine off) | Efficient colours |
|---|---|
| ![](../../docs/retro_sport.png) | ![](../../docs/retro_efficient.png) |

### Track

A motorsport data display: a row of shift lights (green, yellow, then red, all flashing red 300 rpm before
the red line) over a segmented rpm bar, a huge gear with the engine speed in the middle, tiles for oil,
coolant, boost and battery power either side of it (timing and torque with Vehicle: ICE), the speed large on
the left with a **0-60 timer** (it times every run from a stop to 60 mph, or 0-100 km/h, and keeps the best of
the drive) and the drive's peak power (or boost), and the ranges and charge right of the KOMBI's box.

![Track](../../docs/track.png)

| Sport colours at the shift point |
|---|
| ![](../../docs/track_sport.png) |

*(Drawn by `tools/preview.js` from the same shaders the cluster runs; the map is a stand-in for the real one.)*

## Readings and where they come from

| Reading | Source |
|---|---|
| speed, engine speed, gear, oil, coolant | the car's signals (`kit/car.js`); both apps read through `shared/data.js` |
| S / M programme (the gear's letter, the Auto colours) | `MDrive.dataDisplayGearbox` |
| outside temperature | `EnvironmentalInformation.ExteriorTemperature` |
| gearbox oil, the xDrive split | `BasicDataSet.basicDataSet` (the split from the transfer case when the car sends none) |
| battery temperature, where the power goes | `Efficiencytainment2.statusBatteryTemperature`, `KombiIF.statusDisplayElectricalPowerDistribution` |
| intake air, boost | the engine unit over UDS, as M Vitals reads it (only while a layout that shows them is up) |
| battery charge and power | eDrive Live, through the shared folder `/dev/shm/cluster-info` (asked for while the layout shows, as Cluster Info does) |
| fuel range, electric range | an app that shares them (eDrive Live, `values.frange.km` / `values.erange.km` in that folder), else the car's `KombiIF.statusRangeTankStatus` and `VehicleInformation.Range`, numbers picked by field name (`shared/data.js` `rangesOf`) |
| drive mode (SPORT, SPORT INDIVIDUAL, HYBRID, HYBRID COMFORT, HYBRID ECO PRO, ELECTRIC, ELECTRIC INDIVIDUAL, BATTERY CONTROL, ADAPTIVE, + XTRABOOST) | `FES.statusFESVehicleDynamicSwitchHMI` (and `statusSwitchDriveDynamicSport2`), decoded with BMW's FES mode table (TAB_FES_MODUS_ARG); the Auto colours follow it |
| steering angle, yaw rate | `SteeringAngle.ActualSteeringAngleDriver`, `CDS2.statusYawVelocityVehicle` (scaling in `config.scaling`, from the CAN signals, to confirm) |
| engine running, why it started | `CDS.statusEngineStatus` (its strings as the car sends them), else engine speed |
| time | the head unit's clock |

**Signals page.** Every field above is one an installed app already declares with the same flags
(`tools/known_signals.json`; a field the car's catalog doesn't have makes the install fail). Where the field
names inside a value differ by car, the app shows what the car sends: press **Signals** on its page for (1)
the raw drive-mode, range, engine, steering and yaw values, (2) what the cluster has up besides this app
(every display slot the KOMBI reports, from Cluster renderer 0.3.107), then (3...) every range, fuel and
charge signal in the head unit's own catalog. A photo of those pages is what's needed to wire anything that
still reads `--`.

**Needs Cluster renderer 0.3.104 or later** (the eroobeeroo/idrive-apps build): it draws 64 layers an app,
where the original draws 8, and every piece of a layout is a layer.

**Logs.** The apps can't be reached from a phone over Wi-Fi: the head unit's firewall lets nothing connect
in, and an app's traffic out only through what the uplink allows. Instead, **Logs** on Cluster Layouts' page
shows what's needed (the renderer's status and slot report, the raw signals, the data now, the last lines of
the renderer's, this app's and Cluster Centre's logs) as QR codes, three to a page: photograph each page
(press Logs for the next) and send the photos; `python3 tools/decode_logs.py photo*.jpg -o logs.txt` puts the
text back together. The full logs go to a file on any USB stick plugged into the car
(`cluster-logs/cluster-logs-<time>.txt`) and to the app's data folder.

**Background: pure black** (the default; Settings > Background): backgrounds and dial faces black, so the
KOMBI's black box where its own gear readout sits blends in. *Tinted* is the layouts as designed.

**The dark box right of centre** while a layout is up is the KOMBI's own: the stock gear readout's place,
left empty when the panel covers it (the gear letter moves to the bottom bar). The layouts keep their
readings out of it. The renderer's slot report (Signals, page 2) shows what the KOMBI has up there. A gear letter drawn into the
box doesn't show on the car (only its top edge peeks out): the box sits above the panel, so nothing an app
draws can fill it. By default the layouts leave plain black round it, so the box's black window
disappears into the background; Settings > Frame behind the gear box puts a grey frame round it instead.

**M cars** (Settings > Cluster > M car): an M car's KOMBI leaves two more dark boxes in the middle of the
panel while a layout is up, over whatever is drawn there. With the setting on, each layout moves its readings
round them: Digital dash makes its middle and right top tiles one line high above the boxes, Track moves its gear
card and right tiles below them, Modern wide moves its centre readings and gear below them, Freedom moves the
speed to the left and the gear to the right, and the panel between the dials narrows. The rev counters of
Analog sport, Digital round and Retro are too big to move out of the middle, so the boxes still sit on their
faces. The boxes' places were measured from one photo of a car (`layout_common.M_BOXES`, to within about 10 px):
a straight-on photo would tighten them.

## Vehicles

Made and measured on a G05 X5 xDrive45e (iDrive 7 MGU, the 12.3" Live Cockpit Professional cluster); every
car is taken to have the same cluster. What differs between cars is a setting, or found from the car:

- **Vehicle** (default **Auto**): found from the car the way other apps identify one before assuming
  anything: a plug-in hybrid's drive mode names, or an answer from its high-voltage battery unit, say
  plug-in hybrid; that unit never answering while the engine unit does says petrol or diesel. A petrol or
  diesel car gets the engine readings (boost, timing, torque, fuel rail), its own drive modes and no eDrive
  page; nothing asks it for a battery. Or set it.
- **Fuel tank size** (40-90 L, 69 for an X5 45e): the fuel bar.
- **Battery readings**: the battery unit's charge and power over diagnostics (DDBC, DDB4, DD69 on ecu 7, as
  eDrive Live reads them on the X5 45e), or off (charge and power from eDrive Live or the car only).
- **Electric range when full**: the estimate shown (with ~) until the car's own electric range arrives.
- The glass and the KOMBI's boxes (the camera cowl, the gear bracket, the eDrive box, the warning lights)
  are taken as the same on every car with this cluster (`layout_common.js`; every layout is checked against
  them by `tools/clearance.js`).

**Clock:** the unit runs its apps on UTC, so both apps take the time zone from Settings > Time zone (US
Eastern by default; US and EU daylight saving built in) and Settings > Clock (12- or 24-hour).

## How it gets onto the cluster

The head unit never sends a picture of the cluster: a whole 1920x720 frame is 5.5 MB, and the link to
the KOMBI carries about 11.5 MB/s for everything, including the HMI's own content.

- The cluster is drawn with **RAMSES**: the head unit publishes a *scene* (a graph of quads, shaders,
  textures and uniforms), and the KOMBI's own renderer subscribes to it and draws it on the cluster's GPU.
  BMW's HMI draws its own cluster content this way.
- The [cluster render service](https://github.com/robertnisipeanu/idrive-apps/tree/main/native/cluster-render)
  (`cluster-render`, from idrive-apps) is that publisher for apps. It asks the KOMBI for display slots
  through Dcsm2. Its **`panel`** target is slot **0x203**: the whole 1920x720 cluster, over the stock
  gauges and **under the warning lights**.
- Each piece of a layout is an **effect layer**: a small GLSL ES 1.00 fragment shader over its own rectangle
  (`shared/shaders.js`). The dial (face, ticks, red zone, numerals, needle, hub) is one shader; each text is
  another; the background is a flat colour.
- **The render service draws at most 8 layers for an app** (32 for all apps together), so only a layout's
  first 8 pieces show today; the rest are refused (the app's page says so). Drawing many pieces with one big
  generated shader instead made the cluster restart, so that is not done. The way on is the render
  service allowing more layers an app.
- What is sent:
  - **once**: the shaders, their colours and one glyph atlas (a 1.5 KB-per-glyph distance field, ~96 KB):
    about **128 KB** in all;
  - **while driving**: the needles' values when they moved, and texts and colours when they changed: about **2.5 KB/s** at most (`tools/test_engine.js` measures it); **nothing** while nothing
    changes.

## Install on the car

1. Have [idrive-apps](https://github.com/eroobeeroo/idrive-apps) (cluster-render, with waze-on-cluster)
   and [idrive7-apps](https://github.com/eroobeeroo/idrive7-apps) (the GPU renderer and controller gate)
   installed from the Store, as now.
2. In the Store, add the GitHub repository `eroobeeroo/idrive7-cluster-info` as a source. The head unit builds
   the apps from source; no token is needed.
3. Open **Cluster Layouts** and press **Show on the cluster**. Settings: layout, colours (Auto follows S / M),
   centre (readings, map or stock), mph / km/h, °F / °C, red zone, rev scale, the needle sweep at start.

## Safety

- **Off by default.** Nothing covers the stock cluster until *Show on the cluster* is on.
- **Warning lights stay on top**: the panel slot is under the telltales.
- **The stock cluster comes back by itself** when the app stops, when the render service stops (its layers
  go with the connection), when *Show on the cluster* is off, and while the car's signals do not answer.
- The speed is the car's speed signal (`Vehicle2.statusCarSpeed2`, the centre of gravity), not the
  cluster's indicated speed, which by law reads a little high: expect this layout to read a few % below the
  stock speedometer.
- **The panel and the HUD share a scene id** (the KOMBI takes only two): while another app draws on the
  HUD, the panel cannot come up and the app's page says `scene id in use by another target`. Stop the HUD
  apps to use a layout.
- **Not seen on the car yet:** the KOMBI's renderer running these shaders (precision and speed on its
  GPU), whether the stock Check Control pop-ups still show above the panel, whether the map (slot 0x100)
  shows through the map window while the panel is up, and where the warning lights sit against the strips
  above and below the map. Check these parked before driving with it, and switch it off if anything is hidden.

## Writing a layout

The renderer side both apps use (engine, shaders, glyph atlas, render client, providers, signal finder) lives
in `shared/`; edit it there and run `node tools/sync_shared.js` (each app ships its own copy).

A layout is one file, `apps/cluster_layouts/layout_<id>.js`, listed in `layouts.js` and in `app.json`'s
`layout` setting. It lists **pieces** and draws nothing; `layout_common.js` has helpers (texts, readings,
bars, units, the map window). A piece is one shader in its rectangle (`engine.js` has the full list of fields; a
dynamic text's `chars` sets how many glyphs it can show):

| kind | what the cluster draws | main fields |
|---|---|---|
| `flat` | a colour | `colors: { color }` |
| `panel` | a rounded card: gradient, top light, border | `params.u_box` (radius, border, light, opacity) |
| `dial` | a round dial with its needle: face, metal bezel, ticks, red zone, numerals, backlight, value arc, shadow, hub, glass | `params.u_scale`, `u_arc`, `u_needle_dim`, `u_look`, `u_look2`; `value(d)`, `max` |
| `band` | a gauge along an arc (or a straight bar): segments, gradient fill, red zone, glowing tip, marks, numerals | `params.u_geo`, `u_span`, `u_marks`, `u_red`; `value(d)` 0..1 |
| `text` | a line of glyphs with an optional glow | `text` (fixed, or `(d, t) => string`), `align`, `tracking` |

```js
const C = require('./layout_common');
module.exports = {
    id: 'my_layout', title: 'My layout', gearText: C.gearText,
    palette: (look) => ({ bg: '#000000', text: '#ffffff', glow: '#3fa6ff', dim: '#5d6f82' }),
    pieces(o) {
        return [
            C.flat('bg', 0, 0, 1920, 720, 'bg'),
            C.text('gear', 800, 150, 320, 190, C.gearText, (t) => ({ color: [t.text, 1], glow: [t.glow, 0.5] })),
        ].concat(C.reading('fuel', 800, 400, 320, 40, (d) => C.distText(o, d.frange), 'FUEL RANGE',
            (t) => ({ color: [t.text, 1], glow: [t.glow, 0] }), (t) => ({ color: [t.dim, 1], glow: [t.glow, 0] })));
    },
};
```

`o` holds the options (units, red zone, rev scale, centre: `info`, `map` or `stock`); `d` the car's data
(`speed` km/h, `rpm`, `gear`, `stage`, `mode`, `oil`, `coolant`, `outside` °C, `soc` %, `kw`, `erange` and
`frange` km); `t` the layout's palette for the look now. Texts use the glyphs in `font.js`; add more there.

Check it before the car:

```sh
node tools/preview.js --layout my_layout --look sport --centre map --out preview.png   # WebGL, the cluster's shader language
node tools/test_engine.js && node tools/test_app.js && node tools/test_finder.js && node tools/test_centre.js && node tools/test_shared.js
node tools/preview_centre.js --page xdrive --accent orange --out page.png                # a Cluster Centre page
python3 kit/tools/build.py cluster_layouts     # needs an oap-sdk/ folder (a stub is enough to check the build)
```

`preview.js` needs Node with Playwright and Chromium.

## Free and open source — the credit mark

These apps are free. If you paid for one, ask for a refund. Each app shows this on its own screen on the head
unit (the app menu), with a link to this repo. The notice is not drawn on the cluster glass — only in the app.

The credit is **signed** (`shared/attribution.js`, `shared/attribution_sig.js`):

- `attribution_sig.js` holds the author's **public** key, a signature over the credit text, and a key
  fingerprint. It is committed.
- The matching **private** key lives only in `secret/attribution_key.pem`, which is git-ignored and never
  pushed. Keep a backup of it somewhere safe.
- At start-up each app verifies the signature. An official build shows the dim credit and its key fingerprint. A
  build whose credit text was changed can't be re-signed without the private key, so it fails the check and shows
  a red **MODIFIED BUILD** notice on the app screen instead.

Honest limit: this is open source, so anyone can fork it and delete the check in their own copy — nothing can
stop that. What the signature does stop is a reseller passing a modified build off as an official, unmodified
one: users can see the mark flip and check the fingerprint against this repo.

After an **intended** change to the credit text, re-sign:

```sh
node tools/sign_attribution.js     # signs with secret/attribution_key.pem, rewrites attribution_sig.js
node tools/sync_shared.js          # copies the shared files into each app
```

## Notices

See [NOTICE.md](../../NOTICE.md).
