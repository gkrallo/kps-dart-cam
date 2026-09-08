// Audio engine providing sound effects & Text-to-Speech (TTS) for dart hits

class AudioEngine {
  private synth: SpeechSynthesis | null = null;
  private audioCtx: AudioContext | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
    }
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  /** Väcker ljudet vid första användartryck (krav i iOS/Safari). */
  public unlock() {
    const ctx = this.getAudioContext();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  /** Kort ton via Web Audio. */
  private tone(freq: number, duration: number, type: OscillatorType, gainValue = 0.2, delay = 0) {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const t0 = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(gainValue, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    } catch {
      /* ljud är aldrig viktigt nog att krascha på */
    }
  }

  private vibrate(pattern: number | number[]) {
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(pattern);
    } catch {
      /* ignorera */
    }
  }

  /**
   * Plays a physical dart board impact sound using Web Audio synthesizer.
   */
  public playDartHitSound() {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(150, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.8, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch (e) {
      console.warn('Audio playback error:', e);
    }
    this.vibrate(12);
  }

  /** Uppåtgående signal vid spelarbyte. */
  public playSwitchSound() {
    this.tone(660, 0.09, 'triangle', 0.16);
    this.tone(880, 0.12, 'triangle', 0.16, 0.08);
    this.vibrate(30);
  }

  /** Kort fanfar vid vinst. */
  public playWinSound() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, i === 3 ? 0.3 : 0.12, 'triangle', 0.2, i * 0.12));
    this.vibrate([30, 50, 30, 50, 90]);
  }

  /** Fri text via svensk TTS (t.ex. "Annas tur", "Kristian vinner!"). */
  public speak(text: string) {
    if (!this.synth) return;
    try {
      this.synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'sv-SE';
      u.rate = 1.05;
      const sv = this.synth.getVoices().find((v) => v.lang.startsWith('sv'));
      if (sv) u.voice = sv;
      this.synth.speak(u);
    } catch (e) {
      console.warn('TTS error:', e);
    }
  }

  /**
   * Speaks out the dart hit score using Swedish Text-to-Speech
   */
  public speakScore(label: string, totalPoints: number) {
    if (!this.synth) return;

    try {
      this.synth.cancel(); // Stop previous speech

      let text = `${totalPoints}`;
      if (label === 'DB') text = 'Dubbel Bull!';
      else if (label === '25') text = 'Enkel Bull';
      else if (label === 'MISS') text = 'Missa!';
      else if (label.startsWith('T')) text = `Trippel ${label.slice(1)}`;
      else if (label.startsWith('D')) text = `Dubbel ${label.slice(1)}`;

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'sv-SE';
      utterance.rate = 1.05;
      utterance.pitch = 1.0;

      // Try selecting Swedish voice if available
      const voices = this.synth.getVoices();
      const svVoice = voices.find((v) => v.lang.startsWith('sv'));
      if (svVoice) {
        utterance.voice = svVoice;
      }

      this.synth.speak(utterance);
    } catch (e) {
      console.warn('TTS error:', e);
    }
  }
}

export const audioEngine = new AudioEngine();
