/**
 * High-Quality Polyphonic General MIDI Synthesizer Engine using Web Audio API.
 * Supports all GM instrument families (piano, organs, brass, woodwinds, strings, synths, mallets)
 * and dedicated synthesized acoustic/electronic percussion on Channel 10 (ch 9).
 * Features per-channel volume, pan, solo, mute, master limiter, algorithmic reverb, and FFT analyzer.
 */

class SynthEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.masterLimiter = null;
    this.reverbNode = null;
    this.reverbGain = null;
    this.dryGain = null;
    this.analyser = null;

    this.channels = [];
    this.activeVoices = new Map(); // key -> Set of voice nodes
    this.voiceIdCounter = 0;

    // Callbacks for UI updates
    this.onNoteTrigger = null; // (channel, note, velocity, duration) => {}
    this.onNoteRelease = null; // (channel, note) => {}

    this.isMuted = false;
    this.masterVolume = 0.85;

    this.initAudioContext();
  }

  initAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      console.error('Web Audio API is not supported in this browser.');
      return;
    }
    this.ctx = new AudioContextClass();

    // Master Limiter to prevent clipping
    this.masterLimiter = this.ctx.createDynamicsCompressor();
    this.masterLimiter.threshold.setValueAtTime(-2.0, this.ctx.currentTime);
    this.masterLimiter.knee.setValueAtTime(10.0, this.ctx.currentTime);
    this.masterLimiter.ratio.setValueAtTime(12.0, this.ctx.currentTime);
    this.masterLimiter.attack.setValueAtTime(0.003, this.ctx.currentTime);
    this.masterLimiter.release.setValueAtTime(0.20, this.ctx.currentTime);

    // Master Gain
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);

    // FFT Analyser
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82;

    // Algorithmic Concert Hall Reverb
    this.dryGain = this.ctx.createGain();
    this.dryGain.gain.setValueAtTime(0.85, this.ctx.currentTime);

    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.setValueAtTime(0.25, this.ctx.currentTime);

    this.reverbNode = this.createReverbBuffer(1.8, 2.0);

    // Connect:
    // channels -> dryGain -> masterLimiter
    // channels -> reverbNode -> reverbGain -> masterLimiter
    // masterLimiter -> masterGain -> analyser -> destination
    this.dryGain.connect(this.masterLimiter);
    if (this.reverbNode) {
      this.reverbNode.connect(this.reverbGain);
      this.reverbGain.connect(this.masterLimiter);
    }
    this.masterLimiter.connect(this.masterGain);
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    // Initialize 16 MIDI channels (0-15)
    for (let i = 0; i < 16; i++) {
      const channelGain = this.ctx.createGain();
      channelGain.gain.setValueAtTime(1.0, this.ctx.currentTime);

      const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      if (panner) {
        channelGain.connect(panner);
        panner.connect(this.dryGain);
        if (this.reverbNode) panner.connect(this.reverbNode);
      } else {
        channelGain.connect(this.dryGain);
        if (this.reverbNode) channelGain.connect(this.reverbNode);
      }

      this.channels.push({
        id: i,
        program: 0,
        volume: 1.0,
        pan: 0.0,
        isMuted: false,
        isSolo: false,
        gainNode: channelGain,
        pannerNode: panner,
        activeNotesCount: 0
      });
    }
  }

  /**
   * Generates a smooth algorithmic concert hall reverb impulse response.
   */
  createReverbBuffer(duration = 1.8, decay = 2.0) {
    if (!this.ctx) return null;
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = this.ctx.createBuffer(2, length, rate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
      const t = i / rate;
      const env = Math.exp(-t * decay);
      // Diffused stereo noise with exponential decay
      const nL = (Math.random() * 2 - 1) * env;
      const nR = (Math.random() * 2 - 1) * env;
      left[i] = nL;
      right[i] = nR;
    }

    const convolver = this.ctx.createConvolver();
    convolver.buffer = impulse;
    return convolver;
  }

  async resumeContext() {
    if (!this.ctx) this.initAudioContext();
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  setMasterVolume(value) {
    this.masterVolume = Math.max(0, Math.min(1.5, value));
    if (this.masterGain && this.ctx) {
      const targetGain = this.isMuted ? 0 : this.masterVolume;
      this.masterGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.03);
    }
  }

  setMute(muteState) {
    this.isMuted = muteState;
    if (this.masterGain && this.ctx) {
      const targetGain = this.isMuted ? 0 : this.masterVolume;
      this.masterGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.02);
    }
  }

  setChannelVolume(channelId, volume) {
    const ch = this.channels[channelId];
    if (!ch) return;
    ch.volume = Math.max(0, Math.min(2.0, volume));
    this.updateChannelGains();
  }

  setChannelPan(channelId, pan) {
    const ch = this.channels[channelId];
    if (!ch || !ch.pannerNode || !this.ctx) return;
    ch.pan = Math.max(-1.0, Math.min(1.0, pan));
    ch.pannerNode.pan.setTargetAtTime(ch.pan, this.ctx.currentTime, 0.03);
  }

  setChannelMute(channelId, isMuted) {
    const ch = this.channels[channelId];
    if (!ch) return;
    ch.isMuted = isMuted;
    this.updateChannelGains();
  }

  setChannelSolo(channelId, isSolo) {
    const ch = this.channels[channelId];
    if (!ch) return;
    ch.isSolo = isSolo;
    this.updateChannelGains();
  }

  updateChannelGains() {
    const hasAnySolo = this.channels.some(c => c.isSolo);
    const now = this.ctx ? this.ctx.currentTime : 0;

    for (const ch of this.channels) {
      let effectiveGain = ch.volume;
      if (ch.isMuted) {
        effectiveGain = 0;
      } else if (hasAnySolo) {
        effectiveGain = ch.isSolo ? ch.volume : 0;
      }
      if (ch.gainNode && this.ctx) {
        ch.gainNode.gain.setTargetAtTime(effectiveGain, now, 0.02);
      }
    }
  }

  setChannelProgram(channelId, program) {
    const ch = this.channels[channelId];
    if (ch) {
      ch.program = program;
    }
  }

  midiNoteToFrequency(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  /**
   * Schedule or trigger a note.
   * @param {Object} noteObj { time: audioCtxTime, duration, channel, note, velocity, program }
   */
  scheduleNote(time, duration, channel, note, velocity = 85, program = 0) {
    if (!this.ctx) return;
    const when = Math.max(this.ctx.currentTime, time);
    const ch = this.channels[channel];
    if (!ch) return;

    const prog = (channel === 9) ? 0 : (program ?? ch.program ?? 0);
    const velNorm = Math.max(0.05, Math.min(1.0, velocity / 127));

    // Notify UI of active note
    if (this.onNoteTrigger) {
      const delayMs = Math.max(0, (when - this.ctx.currentTime) * 1000);
      setTimeout(() => {
        if (this.onNoteTrigger) this.onNoteTrigger(channel, note, velocity, duration, prog);
      }, delayMs);
    }

    if (channel === 9) {
      // Drum Channel
      this.playDrumNote(when, note, velNorm, ch);
    } else {
      // Melodic / Instrument Channel
      this.playInstrumentNote(when, duration, channel, note, velNorm, prog, ch);
    }
  }

  // ========================================================
  // MELODIC INSTRUMENT SYNTHESIS
  // ========================================================
  playInstrumentNote(when, duration, channel, note, velocity, program, ch) {
    const ctx = this.ctx;
    const freq = this.midiNoteToFrequency(note);
    const voiceKey = `${channel}_${note}_${++this.voiceIdCounter}`;

    const voiceGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    let stopTime = when + duration + 0.3; // Allow release tail
    const nodesToClean = [voiceGain, filter];

    // Determine Instrument Family based on GM Program (0-127)
    if (program <= 3) {
      // Acoustic Piano (Grand, Bright, Electric Grand)
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(Math.min(9000, freq * 8 * (0.4 + 0.6 * velocity)), when);
      filter.Q.setValueAtTime(1.5, when);

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'triangle';
      osc2.type = 'sawtooth';
      osc1.frequency.setValueAtTime(freq, when);
      osc2.frequency.setValueAtTime(freq * 1.0015, when); // subtle chorus

      const osc2Gain = ctx.createGain();
      osc2Gain.gain.setValueAtTime(0.25, when);
      osc2.connect(osc2Gain);
      osc1.connect(filter);
      osc2Gain.connect(filter);

      // Envelope: instant attack, exponential piano decay
      voiceGain.gain.setValueAtTime(0.0001, when);
      voiceGain.gain.exponentialRampToValueAtTime(0.9 * velocity, when + 0.005);
      voiceGain.gain.exponentialRampToValueAtTime(0.4 * velocity, when + 0.3);
      voiceGain.gain.exponentialRampToValueAtTime(0.08 * velocity, when + Math.min(duration, 2.5));
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + duration + 0.15);

      stopTime = when + duration + 0.2;
      osc1.start(when);
      osc2.start(when);
      osc1.stop(stopTime);
      osc2.stop(stopTime);
      nodesToClean.push(osc1, osc2, osc2Gain);

    } else if (program >= 4 && program <= 5) {
      // Electric Piano / Rhodes (FM Synthesis chime)
      const carrier = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const modGain = ctx.createGain();

      carrier.type = 'sine';
      carrier.frequency.setValueAtTime(freq, when);

      mod.type = 'sine';
      mod.frequency.setValueAtTime(freq * 7, when); // 7th harmonic bell chime

      const modAmount = freq * 1.8 * velocity;
      modGain.gain.setValueAtTime(modAmount, when);
      modGain.gain.exponentialRampToValueAtTime(0.01, when + 0.6);

      mod.connect(modGain);
      modGain.connect(carrier.frequency);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(5500, when);
      carrier.connect(filter);

      voiceGain.gain.setValueAtTime(0.0001, when);
      voiceGain.gain.exponentialRampToValueAtTime(0.85 * velocity, when + 0.006);
      voiceGain.gain.exponentialRampToValueAtTime(0.25 * velocity, when + Math.min(duration, 1.8));
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + duration + 0.2);

      stopTime = when + duration + 0.25;
      carrier.start(when);
      mod.start(when);
      carrier.stop(stopTime);
      mod.stop(stopTime);
      nodesToClean.push(carrier, mod, modGain);

    } else if (program === 7) {
      // Clavinet (sharp pulse wave + bandpass filter)
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, when);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1600 + velocity * 1200, when);
      filter.Q.setValueAtTime(4.0, when);
      osc.connect(filter);

      voiceGain.gain.setValueAtTime(0.0001, when);
      voiceGain.gain.exponentialRampToValueAtTime(0.9 * velocity, when + 0.004);
      voiceGain.gain.exponentialRampToValueAtTime(0.15 * velocity, when + Math.min(duration, 0.4));
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + duration + 0.06);

      stopTime = when + duration + 0.1;
      osc.start(when);
      osc.stop(stopTime);
      nodesToClean.push(osc);

    } else if (program >= 8 && program <= 15) {
      // Mallets / Chromatic Percussion (Vibraphone, Marimba, Celesta, Glockenspiel)
      const osc = ctx.createOscillator();
      const oscHarmonic = ctx.createOscillator();
      const harmGain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, when);

      // Vibraphone inharmonic ringing (ratio ~2.76)
      oscHarmonic.type = 'sine';
      oscHarmonic.frequency.setValueAtTime(freq * 2.757, when);
      harmGain.gain.setValueAtTime(0.35 * velocity, when);
      harmGain.gain.exponentialRampToValueAtTime(0.001, when + 0.4);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(program === 12 ? 3200 : 8000, when); // Marimba is warmer

      osc.connect(filter);
      oscHarmonic.connect(harmGain);
      harmGain.connect(filter);

      const decayTime = (program === 12) ? 0.35 : (program === 11 ? 2.5 : 1.2); // Marimba vs Vibraphone
      voiceGain.gain.setValueAtTime(0.0001, when);
      voiceGain.gain.exponentialRampToValueAtTime(0.9 * velocity, when + 0.003);
      voiceGain.gain.exponentialRampToValueAtTime(0.01 * velocity, when + Math.min(duration, decayTime));
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + duration + 0.1);

      stopTime = when + duration + 0.15;
      osc.start(when);
      oscHarmonic.start(when);
      osc.stop(stopTime);
      oscHarmonic.stop(stopTime);
      nodesToClean.push(osc, oscHarmonic, harmGain);

    } else if (program >= 16 && program <= 23) {
      // Organ (Drawbar Organ / Hammond B3 / Church Organ)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const osc3 = ctx.createOscillator();
      osc1.type = 'triangle';
      osc2.type = 'sine';
      osc3.type = 'sine';
      osc1.frequency.setValueAtTime(freq, when);       // Fundamental (8')
      osc2.frequency.setValueAtTime(freq * 2, when);   // Octave (4')
      osc3.frequency.setValueAtTime(freq * 3, when);   // 5th (2 2/3')

      const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.5, when);
      const g3 = ctx.createGain(); g3.gain.setValueAtTime(0.25, when);
      osc2.connect(g2); g2.connect(filter);
      osc3.connect(g3); g3.connect(filter);
      osc1.connect(filter);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(4500, when);

      // Smooth organ envelope
      voiceGain.gain.setValueAtTime(0.0001, when);
      voiceGain.gain.linearRampToValueAtTime(0.7 * velocity, when + 0.02);
      voiceGain.gain.setValueAtTime(0.7 * velocity, when + duration);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + duration + 0.06);

      stopTime = when + duration + 0.1;
      osc1.start(when); osc2.start(when); osc3.start(when);
      osc1.stop(stopTime); osc2.stop(stopTime); osc3.stop(stopTime);
      nodesToClean.push(osc1, osc2, osc3, g2, g3);

    } else if (program >= 24 && program <= 31) {
      // Guitars (Jazz Electric, Acoustic, Clean)
      const osc = ctx.createOscillator();
      osc.type = (program === 26) ? 'triangle' : 'sawtooth';
      osc.frequency.setValueAtTime(freq, when);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2600 + velocity * 1800, when);
      filter.Q.setValueAtTime(2.0, when);
      osc.connect(filter);

      voiceGain.gain.setValueAtTime(0.0001, when);
      voiceGain.gain.exponentialRampToValueAtTime(0.85 * velocity, when + 0.006);
      voiceGain.gain.exponentialRampToValueAtTime(0.25 * velocity, when + 0.4);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + duration + 0.15);

      stopTime = when + duration + 0.2;
      osc.start(when);
      osc.stop(stopTime);
      nodesToClean.push(osc);

    } else if (program >= 32 && program <= 39) {
      // Bass (Acoustic Upright 32, Slap Bass 36, Synth Bass 38)
      const osc1 = ctx.createOscillator();
      const oscSub = ctx.createOscillator();
      osc1.type = (program >= 38) ? 'sawtooth' : 'triangle';
      oscSub.type = 'sine';
      osc1.frequency.setValueAtTime(freq, when);
      oscSub.frequency.setValueAtTime(freq / 2, when); // Deep sub-bass octave

      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0.65, when);
      oscSub.connect(subGain);
      subGain.connect(filter);
      osc1.connect(filter);

      filter.type = 'lowpass';
      const cutoffPeak = (program >= 36) ? 3500 : 1200;
      filter.frequency.setValueAtTime(cutoffPeak * velocity, when);
      filter.frequency.exponentialRampToValueAtTime(450, when + 0.15);
      filter.Q.setValueAtTime(3.5, when);

      voiceGain.gain.setValueAtTime(0.0001, when);
      voiceGain.gain.exponentialRampToValueAtTime(1.0 * velocity, when + 0.005);
      voiceGain.gain.exponentialRampToValueAtTime(0.4 * velocity, when + 0.2);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + duration + 0.1);

      stopTime = when + duration + 0.15;
      osc1.start(when); oscSub.start(when);
      osc1.stop(stopTime); oscSub.stop(stopTime);
      nodesToClean.push(osc1, oscSub, subGain);

    } else if ((program >= 40 && program <= 51) && program !== 46 && program !== 47) {
      // Strings (Violin 40, Cello 42, String Ensemble 48)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc2.type = 'sawtooth';
      osc1.frequency.setValueAtTime(freq, when);
      osc2.frequency.setValueAtTime(freq * 1.004, when); // Detuned ensemble

      // Vibrato LFO
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.setValueAtTime(5.5, when);
      lfoGain.gain.setValueAtTime(freq * 0.012, when);
      lfo.connect(lfoGain);
      lfoGain.connect(osc1.frequency);
      lfoGain.connect(osc2.frequency);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(Math.min(6500, freq * 5 + 1500), when);
      filter.Q.setValueAtTime(1.2, when);

      osc1.connect(filter);
      osc2.connect(filter);

      // Smooth bowing attack and sustained release
      const attackTime = (program === 48 || program === 49) ? 0.09 : 0.06;
      voiceGain.gain.setValueAtTime(0.0001, when);
      voiceGain.gain.linearRampToValueAtTime(0.8 * velocity, when + attackTime);
      voiceGain.gain.setValueAtTime(0.7 * velocity, when + duration);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + duration + 0.25);

      stopTime = when + duration + 0.3;
      osc1.start(when); osc2.start(when); lfo.start(when);
      osc1.stop(stopTime); osc2.stop(stopTime); lfo.stop(stopTime);
      nodesToClean.push(osc1, osc2, lfo, lfoGain);

    } else if (program === 46) {
      // Orchestral Harp (bright pluck + resonant ringing decay)
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, when);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(5000 * velocity, when);
      filter.frequency.exponentialRampToValueAtTime(1200, when + 0.3);
      filter.Q.setValueAtTime(3.0, when);
      osc.connect(filter);

      voiceGain.gain.setValueAtTime(0.0001, when);
      voiceGain.gain.exponentialRampToValueAtTime(0.9 * velocity, when + 0.004);
      voiceGain.gain.exponentialRampToValueAtTime(0.15 * velocity, when + 0.6);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + duration + 0.4);

      stopTime = when + duration + 0.45;
      osc.start(when);
      osc.stop(stopTime);
      nodesToClean.push(osc);

    } else if (program === 47) {
      // Timpani (low resonant boom)
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const baseFreq = Math.max(55, freq);
      osc.frequency.setValueAtTime(baseFreq * 1.25, when);
      osc.frequency.exponentialRampToValueAtTime(baseFreq, when + 0.08);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, when);
      osc.connect(filter);

      voiceGain.gain.setValueAtTime(0.0001, when);
      voiceGain.gain.exponentialRampToValueAtTime(1.1 * velocity, when + 0.005);
      voiceGain.gain.exponentialRampToValueAtTime(0.2 * velocity, when + 0.4);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + duration + 0.3);

      stopTime = when + duration + 0.35;
      osc.start(when);
      osc.stop(stopTime);
      nodesToClean.push(osc);

    } else if (program >= 56 && program <= 63) {
      // Brass (Trumpet 56, Muted Trumpet 59, French Horn 60, Synth Brass 62)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc2.type = 'sawtooth';
      osc1.frequency.setValueAtTime(freq, when);
      osc2.frequency.setValueAtTime(freq * 1.002, when);

      filter.type = 'lowpass';
      // Brass filter swell: opens up sharply on attack, giving brass bite
      const filterPeak = (program === 56 || program === 62) ? 4200 : 2600;
      filter.frequency.setValueAtTime(600, when);
      filter.frequency.exponentialRampToValueAtTime(filterPeak * velocity, when + 0.04);
      filter.frequency.exponentialRampToValueAtTime(1800, when + 0.2);
      filter.Q.setValueAtTime(2.8, when);

      osc1.connect(filter);
      osc2.connect(filter);

      voiceGain.gain.setValueAtTime(0.0001, when);
      voiceGain.gain.linearRampToValueAtTime(0.85 * velocity, when + 0.03);
      voiceGain.gain.setValueAtTime(0.7 * velocity, when + duration);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + duration + 0.12);

      stopTime = when + duration + 0.15;
      osc1.start(when); osc2.start(when);
      osc1.stop(stopTime); osc2.stop(stopTime);
      nodesToClean.push(osc1, osc2);

    } else if (program >= 64 && program <= 71) {
      // Saxophone & Reeds (Tenor Sax 66, Clarinet 71, Oboe 68)
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, when);

      // Saxophone Formant Filter
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1450, when);
      filter.Q.setValueAtTime(2.2, when);

      // Vibrato
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.setValueAtTime(5.2, when);
      lfoGain.gain.setValueAtTime(freq * 0.015, when);
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      osc.connect(filter);

      voiceGain.gain.setValueAtTime(0.0001, when);
      voiceGain.gain.linearRampToValueAtTime(0.85 * velocity, when + 0.035);
      voiceGain.gain.setValueAtTime(0.75 * velocity, when + duration);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + duration + 0.1);

      stopTime = when + duration + 0.15;
      osc.start(when); lfo.start(when);
      osc.stop(stopTime); lfo.stop(stopTime);
      nodesToClean.push(osc, lfo, lfoGain);

    } else if (program >= 72 && program <= 79) {
      // Flute / Pipe (Flute 73, Piccolo 72)
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, when);

      // Flute vibrato
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.setValueAtTime(5.8, when);
      lfoGain.gain.setValueAtTime(freq * 0.018, when);
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3800, when);
      osc.connect(filter);

      voiceGain.gain.setValueAtTime(0.0001, when);
      voiceGain.gain.linearRampToValueAtTime(0.8 * velocity, when + 0.04);
      voiceGain.gain.setValueAtTime(0.7 * velocity, when + duration);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + duration + 0.12);

      stopTime = when + duration + 0.15;
      osc.start(when); lfo.start(when);
      osc.stop(stopTime); lfo.stop(stopTime);
      nodesToClean.push(osc, lfo, lfoGain);

    } else if (program >= 80 && program <= 87) {
      // Synth Leads (Square 80, Sawtooth 81)
      const osc = ctx.createOscillator();
      osc.type = (program === 80) ? 'square' : 'sawtooth';
      osc.frequency.setValueAtTime(freq, when);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(Math.min(10000, freq * 6 * velocity + 1000), when);
      filter.Q.setValueAtTime(4.0, when);
      osc.connect(filter);

      voiceGain.gain.setValueAtTime(0.0001, when);
      voiceGain.gain.linearRampToValueAtTime(0.85 * velocity, when + 0.015);
      voiceGain.gain.setValueAtTime(0.75 * velocity, when + duration);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + duration + 0.08);

      stopTime = when + duration + 0.1;
      osc.start(when);
      osc.stop(stopTime);
      nodesToClean.push(osc);

    } else {
      // Default / Synth Pad (88-95)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'triangle';
      osc2.type = 'sawtooth';
      osc1.frequency.setValueAtTime(freq, when);
      osc2.frequency.setValueAtTime(freq * 1.003, when);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2500, when);

      osc1.connect(filter);
      osc2.connect(filter);

      voiceGain.gain.setValueAtTime(0.0001, when);
      voiceGain.gain.linearRampToValueAtTime(0.7 * velocity, when + 0.1);
      voiceGain.gain.setValueAtTime(0.65 * velocity, when + duration);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + duration + 0.3);

      stopTime = when + duration + 0.35;
      osc1.start(when); osc2.start(when);
      osc1.stop(stopTime); osc2.stop(stopTime);
      nodesToClean.push(osc1, osc2);
    }

    // Connect voice into channel strip
    filter.connect(voiceGain);
    voiceGain.connect(ch.gainNode);

    // Track active voice
    if (!this.activeVoices.has(voiceKey)) {
      this.activeVoices.set(voiceKey, new Set());
    }
    const voiceSet = this.activeVoices.get(voiceKey);
    nodesToClean.forEach(n => voiceSet.add(n));

    ch.activeNotesCount++;

    // Schedule cleanup
    const cleanupMs = Math.max(10, (stopTime - ctx.currentTime) * 1000);
    setTimeout(() => {
      nodesToClean.forEach(node => {
        try { node.disconnect(); } catch (e) {}
      });
      this.activeVoices.delete(voiceKey);
      ch.activeNotesCount = Math.max(0, ch.activeNotesCount - 1);
      if (this.onNoteRelease) this.onNoteRelease(channel, note);
    }, cleanupMs);
  }

  // ========================================================
  // DRUM AND PERCUSSION SYNTHESIS (Channel 10 / Ch 9)
  // ========================================================
  playDrumNote(when, note, velocity, ch) {
    const ctx = this.ctx;
    const voiceGain = ctx.createGain();
    voiceGain.connect(ch.gainNode);

    if (note === 35 || note === 36) {
      // Bass Drum / Kick
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, when);
      osc.frequency.exponentialRampToValueAtTime(42, when + 0.08);

      voiceGain.gain.setValueAtTime(0.0001, when);
      voiceGain.gain.exponentialRampToValueAtTime(1.1 * velocity, when + 0.003);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.35);

      osc.connect(voiceGain);
      osc.start(when);
      osc.stop(when + 0.38);

    } else if (note === 38 || note === 40) {
      // Snare Drum (Tone + Noise)
      // 1. Pitched Body tone
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(185, when);

      const oscGain = ctx.createGain();
      oscGain.gain.setValueAtTime(0.6 * velocity, when);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);
      osc.connect(oscGain);
      oscGain.connect(voiceGain);

      // 2. White noise burst
      const noise = this.createWhiteNoiseBuffer(0.2);
      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = noise;

      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'highpass';
      noiseFilter.frequency.setValueAtTime(1200, when);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.85 * velocity, when);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);

      noiseSource.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(voiceGain);

      osc.start(when); osc.stop(when + 0.15);
      noiseSource.start(when); noiseSource.stop(when + 0.22);

    } else if (note === 37) {
      // Side Stick / Rimshot
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(2100, when);

      voiceGain.gain.setValueAtTime(0.9 * velocity, when);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.035);

      osc.connect(voiceGain);
      osc.start(when);
      osc.stop(when + 0.04);

    } else if (note === 42 || note === 44) {
      // Closed Hi-Hat (Crisp highpass metallic noise)
      const noise = this.createWhiteNoiseBuffer(0.08);
      const source = ctx.createBufferSource();
      source.buffer = noise;

      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(7500, when);

      voiceGain.gain.setValueAtTime(0.7 * velocity, when);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);

      source.connect(filter);
      filter.connect(voiceGain);
      source.start(when);
      source.stop(when + 0.06);

    } else if (note === 46) {
      // Open Hi-Hat
      const noise = this.createWhiteNoiseBuffer(0.45);
      const source = ctx.createBufferSource();
      source.buffer = noise;

      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(6500, when);

      voiceGain.gain.setValueAtTime(0.75 * velocity, when);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.38);

      source.connect(filter);
      filter.connect(voiceGain);
      source.start(when);
      source.stop(when + 0.42);

    } else if (note === 49 || note === 57) {
      // Crash Cymbal (Long shimmering explosion)
      const noise = this.createWhiteNoiseBuffer(2.2);
      const source = ctx.createBufferSource();
      source.buffer = noise;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(5200, when);
      filter.Q.setValueAtTime(1.5, when);

      voiceGain.gain.setValueAtTime(0.95 * velocity, when);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + 2.0);

      source.connect(filter);
      filter.connect(voiceGain);
      source.start(when);
      source.stop(when + 2.1);

    } else if (note === 51 || note === 59) {
      // Ride Cymbal
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(3200, when);

      const noise = this.createWhiteNoiseBuffer(1.2);
      const source = ctx.createBufferSource();
      source.buffer = noise;

      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(8000, when);

      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.4 * velocity, when);
      nGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.9);

      voiceGain.gain.setValueAtTime(0.7 * velocity, when);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + 1.1);

      source.connect(filter);
      filter.connect(nGain);
      nGain.connect(voiceGain);
      osc.connect(voiceGain);

      osc.start(when); osc.stop(when + 1.1);
      source.start(when); source.stop(when + 1.1);

    } else if ([41, 43, 45, 47, 48, 50].includes(note)) {
      // Toms (Pitched sweeps)
      const tomFreqs = { 41: 90, 43: 110, 45: 130, 47: 155, 48: 180, 50: 210 };
      const f = tomFreqs[note] || 130;

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f * 1.3, when);
      osc.frequency.exponentialRampToValueAtTime(f, when + 0.1);

      voiceGain.gain.setValueAtTime(0.85 * velocity, when);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.35);

      osc.connect(voiceGain);
      osc.start(when);
      osc.stop(when + 0.38);

    } else {
      // Generic Percussion click / woodblock
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800, when);
      voiceGain.gain.setValueAtTime(0.6 * velocity, when);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
      osc.connect(voiceGain);
      osc.start(when);
      osc.stop(when + 0.06);
    }

    ch.activeNotesCount++;
    setTimeout(() => {
      ch.activeNotesCount = Math.max(0, ch.activeNotesCount - 1);
      try { voiceGain.disconnect(); } catch (e) {}
    }, 400);
  }

  createWhiteNoiseBuffer(duration) {
    if (!this.ctx) return null;
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const buffer = this.ctx.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /**
   * Silence all active voices immediately (e.g. upon stop or fast seek)
   */
  silenceAll() {
    if (!this.ctx) return;
    this.activeVoices.forEach((nodeSet) => {
      nodeSet.forEach((node) => {
        try {
          if (node.gain) {
            node.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.008);
          }
          if (node.stop) {
            node.stop(this.ctx.currentTime + 0.015);
          }
        } catch (e) {}
      });
    });
    this.activeVoices.clear();
    this.channels.forEach(ch => { ch.activeNotesCount = 0; });
  }
}

if (typeof window !== 'undefined') {
  window.SynthEngine = SynthEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SynthEngine;
}
