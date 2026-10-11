// Every number that decides how the skateboarding feels lives here. Metres, seconds, radians.
export const BOARD = Object.freeze({
  // Measured from RIFT_Skateboard.glb (origin on the ground between the wheels, nose toward -Z).
  deckTop: 0.145,        // standing surface above the origin
  deckBottom: 0.084,     // underside of the deck, what a boardslide rides on
  truckBottom: 0.014,    // bottom of the hangers, what a 50-50 rides on
  wheelRadius: 0.026,
  wheelHalfTrack: 0.082,
  wheelHalfBase: 0.239,
  length: 0.81
});

export const TUNING = Object.freeze({
  gravity: 9.81,
  maxSubstep: 1 / 120,

  // Rolling and pushing
  rollFriction: 0.16,        // m/s² of constant bearing drag
  airDrag: 0.003,            // × speed² deceleration
  lateralGrip: 11,           // 1/s, how fast sideways slip dies on the ground
  pushImpulse: 1.9,          // m/s per kick at standstill
  pushMaxSpeed: 7.4,         // kicks fade out as you approach this
  pushInterval: 0.62,
  pushDrain: 14,             // m/s² the kick is applied at
  brakeDecel: 5.2,
  driveThreshold: 0.5,

  // Steering
  maxYawRate: 2.1,
  maxLateralAccel: 7.5,      // limits turn rate as speed rises
  steerSpeedRef: 1.4,        // below this speed the trucks barely bite
  pivotRate: 0.9,            // tail-pivot turning when nearly stopped
  airSpinRate: 5.2,
  airSpinDeadzone: 0.4,
  airSpinResponse: 14,

  // Ollie
  popMin: 3.05,              // m/s along the surface normal for a tap (~0.47 m)
  popMax: 4.0,               // full charge (~0.82 m)
  popChargeTime: 0.42,
  popBodyHold: 0.55,         // how long a hold keeps charging the crouch visual
  popAnimTime: 0.38,
  popUpBias: 2,              // pop direction leans from the surface normal towards straight up as the surface steepens (n.y^this)

  // Ground following
  maxStep: 0.08,             // free rise allowed per step before it counts as a wall
  maxSlopeTan: 1.7,          // plus this × horizontal travel (≈60°) beyond what the board's own climb explains
  steepNormalY: 0.55,        // surfaces steeper than this are tracked with rays along the board's normal, not straight down
  wallProbe: 0.33,           // how far ahead of the board centre a wall is noticed
  edgeGrace: 0.3,            // seconds after rolling off an edge when the trailing wheels are ignored
  sweepLandMinNormalY: 0.2,  // the centre of the board lands on any surface at least this far from vertical
  steepContact: 0.12,        // on a steep wall a wheel counts as touching within this of the surface
  steepLeave: 0.07,          // average hover above the wall beyond this and the board has left it
  wheelAgreement: 0.85,      // any single wheel's surface this far (≈32°) off the fitted plane means a lip, not a slope
  hugTime: 0.7,              // a drop-in rider leans into the wall for this long after rolling off the lip
  hugMaxSpeed: 3,
  hugReach: 1,
  hugDamp: 9,
  planeAgreement: 0.92,      // wheel plane vs the surfaces they hit: below this the wheels straddle an edge
  wallCos: 0.45,             // a surface this much steeper than the one you are on counts as a wall
  snapDistance: 0.05,        // stay glued to the ground within this
  transitionKeep: 0.8,       // how much speed survives a sudden change of surface angle
  wallBailSpeed: 3.4,        // m/s into a wall that throws you off
  wallEventSpeed: 0.7,       // below this a bump makes no noise
  landMaxAngle: 0.78,        // rad (45°) board-vs-travel misalignment that still lands
  landAngleMinSpeed: 3.0,
  wallLandFrom: 0.9,         // surfaces steeper than this (normal y) are ridden when you land on them…
  wallLandSpan: 0.5,         // …fully by this much steeper
  wallLandKeep: 0.75,        // share of the speed that would have gone into the wall that carries on down it
  landBailImpact: 13,        // m/s into the ground
  bounds: Object.freeze({ x: 54.6, z: 46.3 }),
  killY: -12,

  // Grinding
  grindAlign: 0.52,          // rad (30°) from parallel for a 50-50
  slideAlign: 0.52,          // rad from perpendicular for a boardslide
  truckLateral: 0.11,        // how far the rail may be from the board's centreline
  slideLateral: 0.15,        // how far from the middle of the deck a boardslide can catch
  catchBelow: 0.07,
  catchAbove: 0.05,
  catchMaxRise: 1.0,
  grindMinSpeed: 0.9,
  grindStallSpeed: 0.35,
  grindCooldown: 0.3,
  grindFriction: Object.freeze({ rail: 0.5, coping: 0.7, ledge: 1.1 }),
  grindAlignRate: 14,
  exitAlignRate: 7,
  exitAlignTime: 0.35,
  // Balance: bal'' = instab·bal + wobble + control·stick − damp·bal'
  balInstab0: 2.0,
  balInstabGrow: 0.35,
  balInstabMax: 6.5,
  balWobble: 1.25,
  balControl: 7.5,
  balDamp: 1.4,
  balEntryScale: 0.8,
  balMaxTilt: 0.34,          // board lean at the edge of the meter
  railTopOffset: Object.freeze({ rail: 1, coping: 1, ledge: -0.9 }), // × path radius above the stored line (ledge lines sit just above their surface)

  // Pumping with the stick: holding forward on a curved surface (a transition, a bank) pumps it, the same way forward pushes
  // on the flat. This is how you build the speed to reach a lip and air out of it.
  autoPump: 3.4,             // m/s² of speed at full curvature
  autoPumpMaxSpeed: 10.5,    // no more pumping beyond this

  // Pumping: standing up out of a squat while on a curved surface adds speed (VR: your real knees do it)
  pumpGain: 3.2,             // m/s² of speed per m/s of extension, on a fully curved surface
  pumpMaxAccel: 4.5,
  pumpRefTime: 2.5,          // seconds the "standing height" baseline takes to follow your head
  pumpResponse: 14,          // smoothing of the head's vertical speed
  pumpCurve: 0.22,           // 1 - surface normal y at which the pump is at full strength
  pumpEventSpeed: 0.18,      // speed gained in one stand-up worth a haptic tick

  // Airs at a lip: you stay in the pipe unless you mean to go over. Going over takes two things: holding forward (a sustained
  // hold, not a tap: it builds while you hold and drains fast when you let go) and enough speed carried to the lip to
  // clear it (the board remembers its energy at launch; a pop does not count). Otherwise the air is held over the pit and
  // comes back down into the transition.
  passHold: 2,               // seconds of forward held before an air will pass over
  passHoldMax: 4,
  passHoldDrain: 2,          // how many times faster letting go empties it than holding fills it
  lipPassFrom: 4.0,          // m/s carried to the lip needed to clear it…
  lipPassTo: 4.8,            // …fully by here
  lipZone: 3.2,              // how far from a lip (horizontally) this applies
  lipHoldDist: 0.28,         // an air that should stay is held this far inside the lip line, against the wall, so it rides back down the face
  lipSpring: 60,
  lipDamp: 15,
  lipMaxAccel: 30,
  lipOutwardAccel: 12,
  lipOutwardSpeed: 2.6,      // an air that earned it is sent this fast out over the lip
  lipOutwardZone: 2.5,       // …while it is within this of the lip line

  // In the air the board keeps the tilt it left the surface with (come out of a wall vertical and you stay vertical) and
  // eases towards whatever it is about to land on, faster the closer that gets.
  airTiltFar: 0.9,           // 1/s while far from anything
  airTiltNear: 7,            // 1/s as the landing surface gets close
  airTiltReach: 3,           // metres below which "close" starts

  // Axle stall / rock to fakie: catching coping square-on while almost stopped
  stallLateral: 0.3,
  stallIntoPit: 0.6,         // heading over the coping this fast towards the drop is a drop-in, not a stall
  stallCooldown: 1.4,        // after rocking out of a stall you cannot catch that same lip again for this long
  stallMaxVertical: 1.4,     // no stall catch while moving this fast up or down
  stallBackSpeed: 1.9,
  stallBlockHold: 0.5,       // holding forward this long means you are going over, so no stall catch       // pop off a stall and you roll back down the way you came, this fast
  stallPopScale: 0.55,

  // Manuals. Flick the stick forward then back (quickly) for a manual; back then forward for a nose manual. Then balance it with
  // forward/back on the stick, like a grind meter. Ollie out of it, or let it run out of speed.
  flickThreshold: 0.5,       // how far the stick has to go either way to count as a flick
  flickWindow: 0.55,         // seconds between the two halves of the flick
  manualQueueWindow: 0.7,    // a manual asked for in the air (or just before landing) starts when you land, if it was this recent
  manualMinSpeed: 1.5,       // you need to be rolling to start one
  manualEndSpeed: 0.7,       // below this a manual runs out
  manualTilt: 0.26,          // rad the board sits at when balanced (≈15°)
  manualMaxTilt: 0.24,       // extra rad at the edge of the meter
  manualDrag: 0.45,          // m/s² extra drag on one pair of wheels
  manualSteer: 0.7,          // turning is weaker while balancing
  manualInstab0: 1.6,
  manualInstabGrow: 0.2,
  manualInstabMax: 4.5,
  manualWobble: 0.9,
  manualControl: 6.5,
  manualDamp: 1.6,

  // Bail
  bailTime: 1.25,
  bailFallDrop: 0.8
});

// How the player is placed on the board.
export const RIDER = Object.freeze({
  // How much the view eases into a change of surface angle. Small tilts (a fun box, a bank edge) are smoothed so they do
  // not snap the camera; steep ones (a half-pipe wall) are followed almost rigidly so the world still swings with you.
  tiltRateGentle: 7,         // 1/s for slopes under ~20°
  tiltRateSteep: 90,         // 1/s for walls past ~50°
  tiltGentleAngle: 0.35,     // rad
  tiltSteepAngle: 0.87,      // rad
  tiltRateGrind: 30,
  crouchPress: 0.07,         // instant dip on press
  crouchHold: 0.13,          // settles to this while held
  crouchSettle: 18,
  popRebound: 0.035,
  landCompress: 0.09,
  eyeHeightDesktop: 1.65
});
