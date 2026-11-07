# homebridge-x5-link

Your car in Apple Home, from the **Home Link** app on its iDrive 7 head unit (the cluster-layouts repo).

While the car is on and joined to your home Wi-Fi, Home Link sends this plugin its readings every few seconds.
The plugin shows them as HomeKit sensors and keeps the last values while the car is away or off:

| Accessory | What it shows |
|---|---|
| X5 Charge | the high-voltage battery's charge (as a humidity %, and a battery) |
| X5 Fuel | the tank's level, % |
| X5 Electric Range, X5 Fuel Range | miles or km (shown by the Home app as lux) |
| X5 Outside | the outside temperature |
| X5 Connected | occupancy: the car is on and reporting |
| X5 Arrived | motion for a minute: the car came into Wi-Fi range already driving, after being away |
| X5 Started | motion for a minute: the car came on at home |
| X5 Leaving | motion for a minute: the car drove out of Wi-Fi range |
| X5 Charging | occupancy: the car is charging (its head unit stays on while it charges) |
| X5 Charge Power | kW into the battery while charging (shown as lux) |
| X5 Charge Done | motion for a minute: charging stopped, or the car went to sleep at 90% or more |

**Finding and pairing.** The car looks for this plugin on your Wi-Fi itself (it tries every address on port
8582), so nothing needs typing in the car. Enter the pairing code the Home Link app shows in this plugin's
settings; every report is signed with it and numbered, so nothing else on the network can pass for the car or
replay it. Reports travel unencrypted on your home network (signed, not hidden).

**Settings:** pairing code (required), ranges in miles or km, the name in front of each sensor.

No dependencies beyond Homebridge itself. Not affiliated with or endorsed by BMW. MIT licence.
