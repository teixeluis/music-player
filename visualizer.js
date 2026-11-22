/**
 * Real-time Multi-Mode Canvas Visualizer.
 * Modes:
 * 1. 'pianoroll' - Falling notes with virtual piano keyboard, color-coded per instrument channel.
 * 2. 'spectrum'  - Real-time FFT frequency spectrum bars with peak meters & oscilloscope overlay.
 * 3. 'radial'    - Cyberpunk radial frequency visualizer with pulsing core.
 */

class Visualizer {
  constructor(canvas, synthEngine, player) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.synth = synthEngine;
    this.player = player;

    this.mode = 'pianoroll'; // 'pianoroll' | 'spectrum' | 'radial'
    this.animationId = null;

    // Active keys map (noteNumber -> { color, intensity, channel })
    this.activeKeys = new Map();

    // Frequency & waveform data arrays
    this.freqData = null;
    this.timeData = null;
    this.peaks = [];

    // Channel color map cache
    this.channelColors = [
      '#4f8cff', '#a855f7', '#8b5cf6', '#f59e0b',
      '#eab308', '#06b6d4', '#14b8a6', '#ef4444',
      '#ec4899', '#f43f5e', '#10b981', '#6366f1',
      '#38bdf8', '#fb923c', '#a3e635', '#c084fc'
    ];

    this.setupListeners();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.start();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = (rect.width || 800) * dpr;
    this.canvas.height = (rect.height || 360) * dpr;
    this.ctx.scale(dpr, dpr);
    this.displayWidth = rect.width || 800;
    this.displayHeight = rect.height || 360;
  }

  setMode(mode) {
    this.mode = mode;
  }

  setupListeners() {
    if (this.synth) {
      this.synth.onNoteTrigger = (channel, note, velocity, duration, program) => {
        const color = this.channelColors[channel % this.channelColors.length];
        this.activeKeys.set(note, {
          color: color,
          intensity: Math.min(1.0, 0.4 + (velocity / 127) * 0.6),
          channel: channel,
          releaseTime: performance.now() + Math.max(120, duration * 1000)
        });
      };

      this.synth.onNoteRelease = (channel, note) => {
        // Let it fade out naturally via releaseTime
      };
    }
  }

  start() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    const loop = (timestamp) => {
      this.render(timestamp);
      this.animationId = requestAnimationFrame(loop);
    };
    this.animationId = requestAnimationFrame(loop);
  }

  stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  render(timestamp) {
    const w = this.displayWidth;
    const h = this.displayHeight;
    const ctx = this.ctx;

    // Clear background with deep dark slate
    ctx.fillStyle = '#0f141c';
    ctx.fillRect(0, 0, w, h);

    // Update active keys fade out
    const now = performance.now();
    for (const [note, keyData] of this.activeKeys.entries()) {
      if (now > keyData.releaseTime) {
        keyData.intensity *= 0.88;
        if (keyData.intensity < 0.05) {
          this.activeKeys.delete(note);
        }
      }
    }

    if (this.mode === 'pianoroll') {
      this.renderPianoRoll(ctx, w, h);
    } else if (this.mode === 'spectrum') {
      this.renderSpectrum(ctx, w, h);
    } else if (this.mode === 'radial') {
      this.renderRadial(ctx, w, h);
    }
  }

  // ========================================================
  // 1. PIANO ROLL & FALLING NOTES
  // ========================================================
  renderPianoRoll(ctx, w, h) {
    const keyboardHeight = 44;
    const rollHeight = h - keyboardHeight;
    const minNote = 28; // E1
    const maxNote = 96; // C7
    const noteRange = maxNote - minNote;
    const noteWidth = w / noteRange;

    // Draw vertical subtle grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let n = minNote; n <= maxNote; n++) {
      const isBlack = this.isBlackKey(n);
      const x = (n - minNote) * noteWidth;
      if (isBlack) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fillRect(x, 0, noteWidth, rollHeight);
      }
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rollHeight);
      ctx.stroke();
    }

    // Hitline glowing bar
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(0, rollHeight - 2, w, 2);

    const currentTime = this.player ? this.player.currentTime : 0;
    const lookaheadTime = 3.5; // Look ahead 3.5 seconds

    // Render falling notes from song
    if (this.player && this.player.currentSong && this.player.currentSong.allNotes) {
      const notes = this.player.currentSong.allNotes;
      const windowStart = currentTime - 0.2;
      const windowEnd = currentTime + lookaheadTime;

      for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        if (note.time + note.duration < windowStart) continue;
        if (note.time > windowEnd) break;

        // Position calculations
        const notePitch = Math.max(minNote, Math.min(maxNote, note.note));
        const x = (notePitch - minNote) * noteWidth + 1;
        const width = Math.max(2, noteWidth - 2);

        // y position: notes fall towards rollHeight
        // note.time == currentTime => y = rollHeight
        const timeOffset = note.time - currentTime;
        const y = rollHeight - (timeOffset / lookaheadTime) * rollHeight;
        const noteHeight = Math.max(5, (note.duration / lookaheadTime) * rollHeight);
        const yTop = y - noteHeight;

        const baseColor = this.channelColors[note.channel % this.channelColors.length];

        // Draw note rounded rectangle
        ctx.save();
        ctx.fillStyle = baseColor;
        ctx.shadowColor = baseColor;
        ctx.shadowBlur = (timeOffset <= 0.05 && timeOffset >= -note.duration) ? 14 : 4;

        ctx.beginPath();
        const r = Math.min(3, width / 2);
        ctx.roundRect(x, yTop, width, noteHeight, r);
        ctx.fill();

        // White sheen on top of note
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.fillRect(x + 1, yTop + 1, width - 2, Math.min(4, noteHeight - 2));

        ctx.restore();
      }
    }

    // Draw Virtual Keyboard at bottom
    this.renderVirtualKeyboard(ctx, w, h, keyboardHeight, minNote, maxNote, noteWidth);
  }

  renderVirtualKeyboard(ctx, w, h, kh, minNote, maxNote, nw) {
    const yKey = h - kh;

    // Keyboard background
    ctx.fillStyle = '#161b24';
    ctx.fillRect(0, yKey, w, kh);

    // Draw White Keys first
    for (let n = minNote; n <= maxNote; n++) {
      if (!this.isBlackKey(n)) {
        const x = (n - minNote) * nw;
        const active = this.activeKeys.get(n);

        if (active) {
          ctx.fillStyle = active.color;
          ctx.shadowColor = active.color;
          ctx.shadowBlur = 16;
        } else {
          ctx.fillStyle = '#e2e8f0';
          ctx.shadowBlur = 0;
        }

        ctx.fillRect(x + 1, yKey + 1, nw - 1, kh - 2);

        // Key border
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 1, yKey + 1, nw - 1, kh - 2);
      }
    }

    // Draw Black Keys on top
    for (let n = minNote; n <= maxNote; n++) {
      if (this.isBlackKey(n)) {
        const x = (n - minNote) * nw;
        const active = this.activeKeys.get(n);

        if (active) {
          ctx.fillStyle = active.color;
          ctx.shadowColor = active.color;
          ctx.shadowBlur = 18;
        } else {
          ctx.fillStyle = '#1e293b';
          ctx.shadowBlur = 0;
        }

        ctx.fillRect(x + 1, yKey + 1, nw - 1, kh * 0.65);
      }
    }
    ctx.shadowBlur = 0;
  }

  isBlackKey(noteNumber) {
    const semitone = noteNumber % 12;
    return [1, 3, 6, 8, 10].includes(semitone); // C#, D#, F#, G#, A#
  }

  // ========================================================
  // 2. FFT FREQUENCY SPECTRUM & OSCILLOSCOPE
  // ========================================================
  renderSpectrum(ctx, w, h) {
    if (!this.synth || !this.synth.analyser) return;
    const analyser = this.synth.analyser;

    const bufferLength = analyser.frequencyBinCount;
    if (!this.freqData || this.freqData.length !== bufferLength) {
      this.freqData = new Uint8Array(bufferLength);
      this.timeData = new Uint8Array(bufferLength);
      this.peaks = new Float32Array(bufferLength);
    }

    analyser.getByteFrequencyData(this.freqData);
    analyser.getByteTimeDomainData(this.timeData);

    const numBars = 64;
    const barWidth = (w - (numBars - 1) * 3) / numBars;
    const step = Math.floor(bufferLength / (numBars * 1.5));

    // Dynamic gradient
    const gradient = ctx.createLinearGradient(0, h, 0, 20);
    gradient.addColorStop(0, '#3b82f6');
    gradient.addColorStop(0.4, '#8b5cf6');
    gradient.addColorStop(0.8, '#ec4899');
    gradient.addColorStop(1.0, '#f59e0b');

    // Draw Spectrum Bars
    for (let i = 0; i < numBars; i++) {
      const dataIndex = Math.min(bufferLength - 1, i * step);
      const val = this.freqData[dataIndex] / 255.0; // 0..1
      const barHeight = Math.max(3, val * (h - 60));

      const x = i * (barWidth + 3);
      const y = h - barHeight;

      // Peak hold animation
      if (val > this.peaks[i]) {
        this.peaks[i] = val;
      } else {
        this.peaks[i] = Math.max(0, this.peaks[i] - 0.012);
      }

      // Bar fill
      ctx.fillStyle = gradient;
      ctx.shadowColor = '#8b5cf6';
      ctx.shadowBlur = val > 0.4 ? 12 : 2;

      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, [3, 3, 0, 0]);
      ctx.fill();

      // Peak line
      const peakY = h - Math.max(3, this.peaks[i] * (h - 60));
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(x, peakY - 3, barWidth, 2);
    }
    ctx.shadowBlur = 0;

    // Draw Oscilloscope Waveform overlay
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.85)';
    ctx.shadowColor = '#06b6d4';
    ctx.shadowBlur = 10;

    const sliceWidth = w / bufferLength;
    let waveX = 0;

    for (let i = 0; i < bufferLength; i += 4) {
      const v = this.timeData[i] / 128.0; // 0..2, centered around 1.0
      const y = (v * h) / 3 + (h / 4);

      if (i === 0) {
        ctx.moveTo(waveX, y);
      } else {
        ctx.lineTo(waveX, y);
      }
      waveX += sliceWidth * 4;
    }
    ctx.stroke();
    ctx.restore();
  }

  // ========================================================
  // 3. RADIAL CYBERPUNK VISUALIZER
  // ========================================================
  renderRadial(ctx, w, h) {
    if (!this.synth || !this.synth.analyser) return;
    const analyser = this.synth.analyser;

    const bufferLength = analyser.frequencyBinCount;
    if (!this.freqData || this.freqData.length !== bufferLength) {
      this.freqData = new Uint8Array(bufferLength);
      this.timeData = new Uint8Array(bufferLength);
    }

    analyser.getByteFrequencyData(this.freqData);

    const cx = w / 2;
    const cy = h / 2;
    const baseRadius = Math.min(w, h) * 0.22;
    const barsCount = 80;

    // Pulsing core based on bass frequencies
    let bassSum = 0;
    for (let i = 0; i < 8; i++) bassSum += this.freqData[i];
    const bassLevel = (bassSum / 8) / 255.0;
    const pulsedRadius = baseRadius + bassLevel * 20;

    // Glowing center sphere
    const radialGrad = ctx.createRadialGradient(cx, cy, 5, cx, cy, pulsedRadius);
    radialGrad.addColorStop(0, `rgba(236, 72, 153, ${0.4 + bassLevel * 0.5})`);
    radialGrad.addColorStop(0.7, `rgba(139, 92, 246, ${0.25 + bassLevel * 0.3})`);
    radialGrad.addColorStop(1, 'rgba(15, 20, 28, 0)');

    ctx.fillStyle = radialGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, pulsedRadius * 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Draw Radial Bars
    for (let i = 0; i < barsCount; i++) {
      const angle = (i / barsCount) * Math.PI * 2;
      const dataIdx = Math.floor((i / barsCount) * (bufferLength * 0.5));
      const val = (this.freqData[dataIdx] || 0) / 255.0;
      const barLen = Math.max(4, val * (baseRadius * 1.2));

      const x1 = cx + Math.cos(angle) * pulsedRadius;
      const y1 = cy + Math.sin(angle) * pulsedRadius;
      const x2 = cx + Math.cos(angle) * (pulsedRadius + barLen);
      const y2 = cy + Math.sin(angle) * (pulsedRadius + barLen);

      ctx.save();
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = `hsl(${(i / barsCount) * 360}, 90%, 65%)`;
      ctx.shadowColor = `hsl(${(i / barsCount) * 360}, 100%, 70%)`;
      ctx.shadowBlur = val > 0.4 ? 12 : 2;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

if (typeof window !== 'undefined') {
  window.Visualizer = Visualizer;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Visualizer;
}
