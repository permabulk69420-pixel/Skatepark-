// Quest controllers expose a pulse actuator on the input-source gamepad. Everything the game feels goes through here.
export function createHaptics(renderer) {
  const lastPulse = new Map();
  let enabled = true;

  function pulseSource(source, intensity, ms) {
    const pad = source.gamepad;
    if (!pad) return;
    const actuator = pad.hapticActuators?.[0];
    try {
      if (actuator?.pulse) actuator.pulse(intensity, ms)?.catch?.(() => {});
      else if (pad.vibrationActuator?.playEffect) {
        pad.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity })?.catch?.(() => {});
      }
    } catch { /* a controller that cannot buzz is not an error */ }
  }

  // One-shot thump on one or both hands.
  function pulse(intensity, ms = 30, hand = 'both') {
    if (!enabled) return;
    const session = renderer.xr.getSession?.();
    if (!session) return;
    const strength = Math.max(0, Math.min(1, intensity));
    for (const source of session.inputSources) {
      if (hand !== 'both' && source.handedness !== hand) continue;
      lastPulse.set(source.handedness, performance.now());
      pulseSource(source, strength, Math.max(1, Math.min(250, ms)));
    }
  }

  // Continuous texture (wheels on concrete, a grind): call every frame, it re-pulses at most every `every` ms.
  function rumble(intensity, hand = 'both', every = 45) {
    if (!enabled || intensity <= 0.005) return;
    const session = renderer.xr.getSession?.();
    if (!session) return;
    const now = performance.now();
    const strength = Math.max(0, Math.min(1, intensity));
    for (const source of session.inputSources) {
      if (hand !== 'both' && source.handedness !== hand) continue;
      if (now - (lastPulse.get(source.handedness) || 0) < every) continue;
      lastPulse.set(source.handedness, now);
      pulseSource(source, strength, every + 12);
    }
  }

  return { pulse, rumble, setEnabled: (value) => { enabled = !!value; }, isEnabled: () => enabled };
}
