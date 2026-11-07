# Cluster Centre

The factory cluster as it is - speedometer, rev counter, warning lights - with **its centre taken over** by
pages of data most drivers never see. The centre is the stock map's area (slot 0x100, 1088x480), taken over
the way Waze on cluster takes it; set **Instrument cluster > Central display area** to **Map view**. Like the
layouts, every page is drawn by the cluster's own GPU, a small shader per piece; only the page shown is built
(changing page builds the new one before the old goes), and driving sends about 2 KB a second. **The render
service draws at most 8 layers for an app**, so only a page's first 8 pieces show until it allows more.

Two looks (Settings > Look):

- **Like the factory cluster** (the default): readings float on a dark blue-black; no boxes, hairline dividers; thin numerals; thin bars and arcs; outlined icons; cool white and
  blue, orange for warnings; a thin segmented shift light. Its own design in the factory cluster's spirit (no
  BMW artwork, icons or fonts).
- **Modern**: glass cards, bold numerals, glowing bars and arcs, filled icons, round shift lights.

**Size in the centre**: the stock cluster draws its own readouts over the edges of the centre (the digital
speed and its line on the left, the efficiency gauge and the range on the right, the flanks of both dials).
By default the pages are made smaller and sit between them (about x 290 to 850 of the 1088); **The whole
middle** draws them at full size, under those readouts at its edges.

Both have an icon by every reading, a trend line of its last two minutes, a mark where it turns too hot, and
the top-down xDrive car whose axles light up with their share while the torque flows to them (animated by the
cluster, nothing sent to move it).

![Temperatures](../../docs/centre/temps.png)

## Pages

Turn each on or off in the settings; they show in this order, changed with **Next page** or by themselves
(every 5 s to every minute). A **shift light** with the gear runs along the top of every page (it fills from
the rpm you pick and flashes at the shift point), and the **turbo cool-down** countdown sits at the top right
while it runs.

| Page | What it shows | From |
|---|---|---|
| Temperatures | oil, coolant, gearbox oil, intake air, intake air above outside, outside | the car's signals; intake air from the engine unit |
| Fuel and boost | high and low pressure fuel, boost (with its target), ignition timing | the engine unit (UDS) |
| Warm-up | oil temperature, minutes and the time until it is warm (from how fast it is warming), the rev limit for now (rising from the cold limit to the redline as the oil warms), coolant | the car's signals |
| Turbo cool-down | the countdown after hard driving (30 s to 3 min, from how long it was hard), counting down below 3000 rpm and at idle | the car's signals |
| xDrive | front / rear torque split, the car from above with its axles lit by their share | the car's split signal; the transfer case when the car sends none |
| eDrive | battery charge and electric range, battery power (charging / drawing, either side of zero), battery temperature and its cells' spread, where the power goes (driving, climate, seats), fuel range | the car (battery temperature, power distribution); eDrive Live (charge, power) |
| Engine | engine on or off (electric), engine speed, minutes the engine ran this drive and the share of it, starts this drive, why it started (when the car's signal is found) | the car's signals |
| Steering | steering angle and yaw rate (when the car's signals are found), lateral g | the car's signals |
| 0-60 and quarter mile | arm with **Arm 0-60 timer**, stop, go: the time to 60 mph (100 km/h), the quarter mile and its trap speed, the last run and the best | the car's speed |
| Custom 1 and 2 | 1, 2, 3, 4 or 6 slots, each any of 23 readings, as numbers, bars or arc gauges | as the readings |

| Fuel and boost | Warm-up |
|---|---|
| ![](../../docs/centre/fuel.png) | ![](../../docs/centre/warmup.png) |
| **xDrive** | **eDrive** |
| ![](../../docs/centre/xdrive.png) | ![](../../docs/centre/edrive.png) |
| **Turbo cool-down** | **0-60 and quarter mile** |
| ![](../../docs/centre/cooldown.png) | ![](../../docs/centre/timer.png) |
| **Engine** | **Custom page, arc gauges** |
| ![](../../docs/centre/engine.png) | ![](../../docs/centre/custom2.png) |
| **Steering** | **Arc gauges, orange, metric** |
| ![](../../docs/centre/steering.png) | ![](../../docs/centre/temps-arc-metric.png) |

### Modern look

| Temperatures | xDrive |
|---|---|
| ![](../../docs/centre/modern/temps.png) | ![](../../docs/centre/modern/xdrive.png) |
| **eDrive** | **Warm-up** |
| ![](../../docs/centre/modern/edrive.png) | ![](../../docs/centre/modern/warmup.png) |

## The app

![The app's screen](../../docs/centre/app-screen.png)

The screen shows the page as the cluster shows it now (drawn on the head unit, simpler than on the cluster:
flat cards, dots for icons, no trend lines or glow),
and what feeds it: the cluster renderer, the diagnostic link to the engine units, eDrive Live, the timer.
Buttons: **Show in the cluster**, **Next page**, **Arm 0-60 timer** (it turns the timer page on and shows it),
**Signals**, **Settings**.

Settings, 52 of them, kept for each driver profile:

- **Pages**: each page on or off; change page by itself (off, 5 s ... 1 min).
- **Look**: like the factory cluster or modern; tiles on the built-in pages (number and bar, arc gauge, number only), colour (blue, white,
  orange, red, green), number size.
- **Shift light**: on or off, where it starts, where it flashes. The cool-down countdown on every page.
- **Warm-up**: the oil temperature that counts as warm, the rev limit while cold and when warm. The cool-down:
  what counts as hard driving.
- **Units**: temperature (°F / °C), pressure (psi / bar / kPa), speed and distance (mph / km/h), torque
  (lb-ft / Nm).
- **Warnings**: when oil, coolant, intake air, gearbox and battery count as too hot, and low pressure fuel as
  too low (the value and its bar turn red).
- **Custom pages**: how many slots, the tile style, and the reading in each slot.

## Signals

Steering angle, yaw rate and the engine's state now come from fields installed apps already read
(`SteeringAngle.ActualSteeringAngleDriver`, `CDS2.statusYawVelocityVehicle`, `CDS.statusEngineStatus`);
the steering and yaw scaling is the CAN signals' (`config.scaling`, to confirm on the car). Their raw values
show on Cluster Layouts' Signals page. **Signals** here still lists every steering, yaw and engine-start
signal in the car's own catalog (`/etc/oap/someip/someip-interfaces.json`).

**Needs Cluster renderer 0.3.104 or later** (64 layers an app; a page is up to 51 pieces). While Cluster
Layouts shows a layout over the whole panel, Cluster Centre waits (its page would be hidden under it), and its
screen says so.

## Not seen on the car yet

The centre take-over is the one Waze on cluster uses on this car, and every signal and engine-unit read is
one the community apps already read on G05s, but this app as a whole has not run on a car. Check parked
first: the pages appear in the centre with Map view, the stock dials and warning lights stay on top, the
shift light keeps up with the engine. While this shows, it covers a Waze map in the centre; turn **Show in
the cluster** off for the map.
