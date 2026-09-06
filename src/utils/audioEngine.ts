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
