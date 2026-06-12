/// WebAudio-synthesized UI sounds. No audio files: each sound is a short
/// sequence of oscillator tones (same approach as the original notification
/// chime), so there's nothing to load and nothing to ship. Every call is
/// wrapped so a blocked or unavailable AudioContext never throws into the UI.
///
/// A single module-level mute flag gates everything, wired to the bell's
/// SOUND ON/OFF toggle so one switch silences the whole app.

type Tone = { freq: number; start: number; dur: number; type?: OscillatorType; gain?: number };

let muted = false;
export function setSoundMuted(m: boolean): void {
  muted = m;
}
export function isSoundMuted(): boolean {
  return muted;
}

function playTones(tones: Tone[]): void {
  if (muted) return;
  try {
    const Ctx =
      typeof window !== "undefined"
        ? window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    let end = 0;
    for (const t of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = t.type ?? "sine";
      osc.frequency.value = t.freq;
      const peak = t.gain ?? 0.18;
      gain.gain.setValueAtTime(0.0001, now + t.start);
      gain.gain.exponentialRampToValueAtTime(peak, now + t.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t.start + t.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + t.start);
      osc.stop(now + t.start + t.dur + 0.02);
      end = Math.max(end, t.start + t.dur);
    }
    setTimeout(() => void ctx.close().catch(() => {}), (end + 0.3) * 1000);
  } catch {
    /* audio unavailable */
  }
}

/// New unread notification — the original two-tone chime.
export function playNotification(): void {
  playTones([
    { freq: 880, start: 0, dur: 0.12 },
    { freq: 1320, start: 0.1, dur: 0.16 },
  ]);
}

/// Entered a contest / joined a challenge — a short confirming up-step.
export function playJoin(): void {
  playTones([
    { freq: 523, start: 0, dur: 0.1 },
    { freq: 784, start: 0.08, dur: 0.14 },
  ]);
}

/// Won a contest / challenge — a bright triumphant arpeggio.
export function playWin(): void {
  playTones([
    { freq: 523, start: 0, dur: 0.12 },
    { freq: 659, start: 0.1, dur: 0.12 },
    { freq: 784, start: 0.2, dur: 0.12 },
    { freq: 1047, start: 0.32, dur: 0.26, gain: 0.2 },
  ]);
}

/// Claimed a mystery trait — a sparkly rising shimmer.
export function playMystery(): void {
  playTones([
    { freq: 1047, start: 0, dur: 0.1 },
    { freq: 1568, start: 0.08, dur: 0.12 },
    { freq: 2093, start: 0.18, dur: 0.2, gain: 0.14 },
  ]);
}

/// Join window about to close — a soft urgent tick. Fire once near the end.
export function playCountdownTick(): void {
  playTones([{ freq: 660, start: 0, dur: 0.08, type: "triangle", gain: 0.14 }]);
}
