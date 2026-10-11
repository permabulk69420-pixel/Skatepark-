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
  rollFriction: 0.22,        // m/s² of constant bearing drag
  airDrag: 0.0045,           // × speed² deceleration
  lateralGrip: 11,           // 1/s, how fast sideways slip dies on the ground
  pushImpulse: 1.9,          // m/s per kick at standstill
  pushMaxSpeed: 6.8,         // kicks fade out as you approach this
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
  landBailImpact: 11,        // m/s into the ground
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

  // Pumping: standing up out of a squat while on a curved surface adds speed (VR: your real knees do it)
  pumpGain: 3.2,             // m/s² of speed per m/s of extension, on a fully curved surface
  pumpMaxAccel: 4.5,
  pumpRefTime: 2.5,          // seconds the "standing height" baseline takes to follow your head
  pumpResponse: 14,          // smoothing of the head's vertical speed
  pumpCurve: 0.22,           // 1 - surface normal y at which the pump is at full strength
  pumpEventSpeed: 0.18,      // speed gained in one stand-up worth a haptic tick

  // Axle stall / rock to fakie: catching coping square-on while almost stopped
  stallLateral: 0.3,
  stallIntoPit: 0.6,         // heading over the coping this fast towards the drop is a drop-in, not a stall
  stallBackSpeed: 1.9,       // pop off a stall and you roll back down the way you came, this fast
  stallPopScale: 0.55,

  // Bail
  bailTime: 1.25,
  bailFallDrop: 0.8
});

// How the player is placed on the board.
export const RIDER = Object.freeze({
  crouchPress: 0.07,         // instant dip on press
  crouchHold: 0.13,          // settles to this while held
  crouchSettle: 18,
  popRebound: 0.035,
  landCompress: 0.09,
  eyeHeightDesktop: 1.65
});
