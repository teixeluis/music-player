/**
 * Music Player Controller.
 * Coordinates MIDI playback, lookahead audio scheduling, transport controls (play, pause, stop, fwd, rev, seek),
 * playback rate, repeat loop, and communication with the SynthEngine and UI.
 */

class MusicPlayer {
  constructor(synthEngine) {
    this.synth = synthEngine;

    // Playback state
    this.state = 'STOPPED'; // 'STOPPED' | 'PLAYING' | 'PAUSED'
    this.currentTime = 0;
    this.duration = 0;
    this.playbackRate = 1.0;
    this.isLooping = false;

    // Song data
    this.currentSong = null; // Parsed MIDI object
    this.currentMetadata = null; // Title, genre, instruments, etc.

    // Lookahead Scheduler
    this.schedulerTimer = null;
    this.nextNoteIndex = 0;
    this.lookaheadSec = 0.12; // 120ms lookahead
    this.scheduleIntervalMs = 25; // check every 25ms

    // Time tracking
    this.audioStartTime = 0;
    this.songStartTime = 0;

    // Event listeners
    this.listeners = {
      stateChange: [],
      timeUpdate: [],
      songLoaded: [],
      songEnded: []
    };

    // Animation frame for smooth UI timeline updates
    this.uiUpdateTimer = null;
  }

  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  emit(event, ...args) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => {
        try { cb(...args); } catch (e) { console.error(e); }
      });
    }
  }

  /**
   * Load song from ArrayBuffer
   */
  loadSong(arrayBuffer, metadata = {}) {
    this.stop();

    try {
      const parsed = MidiParser.parse(arrayBuffer);
      this.currentSong = parsed;
      this.duration = parsed.duration;
      this.currentTime = 0;
      this.nextNoteIndex = 0;

      // Extract metadata or fill defaults
      this.currentMetadata = {
        id: metadata.id || 'custom_' + Date.now(),
        title: metadata.title || parsed.channelTrackNames[0] || 'Custom MIDI File',
        genre: metadata.genre || 'MIDI Composition',
        bpm: metadata.bpm || parsed.initialBpm || 120,
        description: metadata.description || `Loaded MIDI file with ${parsed.numTracks} tracks and ${parsed.allNotes.length} notes.`,
        instruments: metadata.instruments || this.extractInstruments(parsed),
        rawBuffer: arrayBuffer
      };

      // Configure synth channels
      this.applySongChannels(parsed, this.currentMetadata);

      this.emit('songLoaded', {
        song: this.currentSong,
        metadata: this.currentMetadata
      });

      this.emit('timeUpdate', {
        currentTime: 0,
        duration: this.duration,
        progress: 0
      });

      return true;
    } catch (err) {
      console.error('Failed to parse MIDI song:', err);
      alert('Error parsing MIDI file: ' + err.message);
      return false;
    }
  }

  /**
   * Load song from base64 string
   */
  loadSongFromBase64(b64, metadata = {}) {
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return this.loadSong(bytes.buffer, metadata);
  }

  extractInstruments(parsed) {
    const list = [];
    const seenChannels = new Set();

    for (const track of parsed.tracks) {
      if (track.channel >= 0 && !seenChannels.has(track.channel) && track.noteCount > 0) {
        seenChannels.add(track.channel);
        const prog = parsed.channelPrograms[track.channel] ?? track.program ?? 0;
        list.push({
          channel: track.channel,
          program: prog,
          name: track.name || `Channel ${track.channel + 1}`,
          family: track.channel === 9 ? 'Drums' : this.getInstrumentFamily(prog),
          icon: track.channel === 9 ? '🥁' : this.getInstrumentIcon(prog),
          color: this.getChannelColor(track.channel)
        });
      }
    }
    return list;
  }

  getInstrumentFamily(program) {
    if (program <= 7) return 'Piano/Keyboard';
    if (program <= 15) return 'Chromatic Percussion';
    if (program <= 23) return 'Organ';
    if (program <= 31) return 'Guitar';
    if (program <= 39) return 'Bass';
    if (program <= 55) return 'Strings/Orchestra';
    if (program <= 63) return 'Brass';
    if (program <= 71) return 'Reed';
    if (program <= 79) return 'Pipe/Flute';
    if (program <= 87) return 'Synth Lead';
    if (program <= 95) return 'Synth Pad';
    return 'Synth/FX';
  }

  getInstrumentIcon(program) {
    if (program <= 7) return '🎹';
    if (program <= 15) return '✨';
    if (program <= 23) return '🎹';
    if (program <= 31) return '🎸';
    if (program <= 39) return '🎸';
    if (program <= 55) return '🎻';
    if (program <= 63) return '🎺';
    if (program <= 71) return '🎷';
    if (program <= 79) return '🪈';
    if (program <= 87) return '⚡';
    if (program <= 95) return '🌌';
    return '🎛️';
  }

  getChannelColor(channel) {
    const colors = [
      '#4f8cff', '#a855f7', '#8b5cf6', '#f59e0b',
      '#eab308', '#06b6d4', '#14b8a6', '#ef4444',
      '#ec4899', '#f43f5e', '#10b981', '#6366f1',
      '#38bdf8', '#fb923c', '#a3e635', '#c084fc'
    ];
    return colors[channel % colors.length];
  }

  applySongChannels(parsed, metadata) {
    if (!this.synth) return;
    // Set programs for all channels
    for (let ch = 0; ch < 16; ch++) {
      const prog = parsed.channelPrograms[ch] ?? 0;
      this.synth.setChannelProgram(ch, prog);
      this.synth.setChannelPan(ch, 0);
      this.synth.setChannelVolume(ch, 1.0);
      this.synth.setChannelMute(ch, false);
      this.synth.setChannelSolo(ch, false);
    }
  }

  // ========================================================
  // TRANSPORT CONTROLS
  // ========================================================

  async play() {
    if (!this.currentSong) return;

    await this.synth.resumeContext();

    if (this.state === 'PLAYING') return;

    // If at or past end, restart from 0
    if (this.currentTime >= this.duration - 0.1) {
      this.currentTime = 0;
    }

    this.state = 'PLAYING';
    this.songStartTime = this.currentTime;
    this.audioStartTime = this.synth.ctx.currentTime;

    // Find the next note index at or after currentTime
    this.findNextNoteIndex(this.currentTime);

    // Start scheduling loop
    this.startScheduler();
    this.startUiTimer();

    this.emit('stateChange', this.state);
  }

  pause() {
    if (this.state !== 'PLAYING') return;

    this.updateCurrentTime();
    this.state = 'PAUSED';

    this.stopScheduler();
    this.stopUiTimer();
    this.synth.silenceAll();

    this.emit('stateChange', this.state);
    this.emitTimeUpdate();
  }

  stop() {
    this.state = 'STOPPED';
    this.currentTime = 0;
    this.nextNoteIndex = 0;

    this.stopScheduler();
    this.stopUiTimer();
    this.synth.silenceAll();

    this.emit('stateChange', this.state);
    this.emitTimeUpdate();
  }

  /**
   * Rewind (REV) by X seconds (default 5s)
   */
  rewind(seconds = 5) {
    this.updateCurrentTime();
    const target = Math.max(0, this.currentTime - seconds);
    this.seek(target);
  }

  /**
   * Fast Forward (FWD) by X seconds (default 5s)
   */
  forward(seconds = 5) {
    this.updateCurrentTime();
    const target = Math.min(this.duration, this.currentTime + seconds);
    this.seek(target);
  }

  /**
   * Seek to specific timestamp in seconds
   */
  seek(timeSeconds) {
    if (!this.currentSong) return;

    const clampedTime = Math.max(0, Math.min(this.duration, timeSeconds));
    this.currentTime = clampedTime;

    this.synth.silenceAll();
    this.findNextNoteIndex(this.currentTime);

    if (this.state === 'PLAYING') {
      this.songStartTime = this.currentTime;
      this.audioStartTime = this.synth.ctx.currentTime;
    }

    this.emitTimeUpdate();
  }

  setPlaybackRate(rate) {
    const newRate = Math.max(0.25, Math.min(2.5, rate));
    if (this.state === 'PLAYING') {
      this.updateCurrentTime();
      this.playbackRate = newRate;
      this.songStartTime = this.currentTime;
      this.audioStartTime = this.synth.ctx.currentTime;
    } else {
      this.playbackRate = newRate;
    }
  }

  setLoop(loop) {
    this.isLooping = !!loop;
  }

  togglePlayPause() {
    if (this.state === 'PLAYING') {
      this.pause();
    } else {
      this.play();
    }
  }

  // ========================================================
  // SCHEDULER & TIMING
  // ========================================================

  findNextNoteIndex(targetTime) {
    if (!this.currentSong || !this.currentSong.allNotes) {
      this.nextNoteIndex = 0;
      return;
    }
    const notes = this.currentSong.allNotes;
    let low = 0;
    let high = notes.length - 1;
    let idx = notes.length;

    while (low <= high) {
      const mid = (low + high) >> 1;
      if (notes[mid].time >= targetTime) {
        idx = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    this.nextNoteIndex = idx;
  }

  updateCurrentTime() {
    if (this.state === 'PLAYING' && this.synth.ctx) {
      const elapsedAudio = this.synth.ctx.currentTime - this.audioStartTime;
      this.currentTime = this.songStartTime + elapsedAudio * this.playbackRate;
      if (this.currentTime >= this.duration) {
        this.currentTime = this.duration;
      }
    }
  }

  startScheduler() {
    this.stopScheduler();
    this.schedulerTimer = setInterval(() => {
      this.scheduleLoop();
    }, this.scheduleIntervalMs);
  }

  stopScheduler() {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  scheduleLoop() {
    if (this.state !== 'PLAYING' || !this.currentSong) return;

    this.updateCurrentTime();

    // Check if song has completed
    if (this.currentTime >= this.duration) {
      if (this.isLooping) {
        this.seek(0);
        return;
      } else {
        this.stop();
        this.emit('songEnded');
        return;
      }
    }

    const notes = this.currentSong.allNotes;
    const scheduleWindowEnd = this.currentTime + (this.lookaheadSec * this.playbackRate);

    while (this.nextNoteIndex < notes.length) {
      const note = notes[this.nextNoteIndex];
      if (note.time > scheduleWindowEnd) {
        break; // Note is beyond our lookahead window
      }

      // Calculate when this note should sound in Web Audio context time
      const timeUntilNote = (note.time - this.songStartTime) / this.playbackRate;
      const targetAudioTime = this.audioStartTime + timeUntilNote;
      const noteDurationInAudio = note.duration / this.playbackRate;

      this.synth.scheduleNote(
        targetAudioTime,
        noteDurationInAudio,
        note.channel,
        note.note,
        note.velocity,
        note.program
      );

      this.nextNoteIndex++;
    }
  }

  startUiTimer() {
    this.stopUiTimer();
    const update = () => {
      if (this.state === 'PLAYING') {
        this.updateCurrentTime();
        this.emitTimeUpdate();
        this.uiUpdateTimer = requestAnimationFrame(update);
      }
    };
    this.uiUpdateTimer = requestAnimationFrame(update);
  }

  stopUiTimer() {
    if (this.uiUpdateTimer) {
      cancelAnimationFrame(this.uiUpdateTimer);
      this.uiUpdateTimer = null;
    }
  }

  emitTimeUpdate() {
    const progress = this.duration > 0 ? (this.currentTime / this.duration) : 0;
    this.emit('timeUpdate', {
      currentTime: this.currentTime,
      duration: this.duration,
      progress: Math.min(1.0, Math.max(0.0, progress))
    });
  }
}

if (typeof window !== 'undefined') {
  window.MusicPlayer = MusicPlayer;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MusicPlayer;
}
