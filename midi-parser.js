/**
 * Pure JavaScript Standard MIDI File (SMF Type 0 and Type 1) Parser.
 * Parses binary .mid ArrayBuffer into structured events, tracks, notes, and timestamps in seconds.
 * Supports running status, all standard GM events, tempo maps, and variable-length quantities.
 */

class MidiParser {
  /**
   * Parse an ArrayBuffer containing standard MIDI file data.
   * @param {ArrayBuffer} arrayBuffer 
   * @returns {Object} Parsed MIDI song object
   */
  static parse(arrayBuffer) {
    const data = new DataView(arrayBuffer);
    let offset = 0;

    // Helper functions
    function readString(len) {
      let str = '';
      for (let i = 0; i < len; i++) {
        str += String.fromCharCode(data.getUint8(offset + i));
      }
      offset += len;
      return str;
    }

    function readUint8() {
      const val = data.getUint8(offset);
      offset += 1;
      return val;
    }

    function readUint16() {
      const val = data.getUint16(offset);
      offset += 2;
      return val;
    }

    function readUint32() {
      const val = data.getUint32(offset);
      offset += 4;
      return val;
    }

    function readVLQ() {
      let val = 0;
      while (true) {
        if (offset >= data.byteLength) break;
        const b = readUint8();
        val = (val << 7) | (b & 0x7F);
        if (!(b & 0x80)) break;
      }
      return val;
    }

    // 1. Read MThd Chunk
    const headerChunkType = readString(4);
    if (headerChunkType !== 'MThd') {
      throw new Error(`Invalid MIDI file header: expected 'MThd', got '${headerChunkType}'`);
    }

    const headerLength = readUint32();
    const format = readUint16();
    const numTracks = readUint16();
    const timeDivision = readUint16();

    // Skip any extra header bytes if headerLength > 6
    if (headerLength > 6) {
      offset += (headerLength - 6);
    }

    let ticksPerBeat = 480;
    if ((timeDivision & 0x8000) === 0) {
      ticksPerBeat = timeDivision;
    } else {
      // SMTPE frames
      const fps = -(timeDivision >> 8);
      const subframes = timeDivision & 0xFF;
      ticksPerBeat = fps * subframes;
    }

    const rawTracks = [];
    const tempoMap = []; // [{ tick, mpqn, bpm }]

    // Initial default tempo: 120 BPM = 500,000 microseconds per quarter note
    tempoMap.push({ tick: 0, mpqn: 500000, bpm: 120 });

    // 2. Read MTrk Chunks
    for (let t = 0; t < numTracks && offset < data.byteLength; t++) {
      const chunkType = readString(4);
      const chunkLength = readUint32();
      const chunkEnd = offset + chunkLength;

      if (chunkType !== 'MTrk') {
        // Skip unknown chunk
        offset = chunkEnd;
        continue;
      }

      let currentTick = 0;
      let runningStatus = 0;
      const trackEvents = [];
      let trackName = `Track ${t + 1}`;

      while (offset < chunkEnd) {
        const deltaTick = readVLQ();
        currentTick += deltaTick;

        if (offset >= chunkEnd) break;

        let statusByte = data.getUint8(offset);

        if (statusByte & 0x80) {
          // Status byte present
          offset++;
          runningStatus = statusByte;
        } else {
          // Running status
          if (!runningStatus) {
            console.warn(`Missing running status at track ${t}, offset ${offset}`);
            offset++;
            continue;
          }
          statusByte = runningStatus;
        }

        // Meta Event
        if (statusByte === 0xFF) {
          const metaType = readUint8();
          const metaLen = readVLQ();
          const metaDataStart = offset;

          if (metaType === 0x03 || metaType === 0x04) {
            // Track name / instrument name
            let name = '';
            for (let i = 0; i < metaLen; i++) {
              name += String.fromCharCode(readUint8());
            }
            if (name.trim()) trackName = name.trim();
          } else if (metaType === 0x51 && metaLen === 3) {
            // Set Tempo
            const b1 = readUint8();
            const b2 = readUint8();
            const b3 = readUint8();
            const mpqn = (b1 << 16) | (b2 << 8) | b3;
            const bpm = Math.round(60000000 / mpqn);
            tempoMap.push({ tick: currentTick, mpqn, bpm });
          } else if (metaType === 0x58 && metaLen >= 2) {
            // Time signature
            const num = readUint8();
            const denomPow = readUint8();
            offset = metaDataStart + metaLen;
            trackEvents.push({
              tick: currentTick,
              type: 'timeSignature',
              numerator: num,
              denominator: Math.pow(2, denomPow)
            });
          } else {
            // Skip other meta data
            offset = metaDataStart + metaLen;
          }
          continue;
        }

        // SysEx Event
        if (statusByte === 0xF0 || statusByte === 0xF7) {
          const sysexLen = readVLQ();
          offset += sysexLen;
          continue;
        }

        // Channel Event
        const eventType = statusByte & 0xF0;
        const channel = statusByte & 0x0F;

        if (eventType === 0x90) {
          // Note On
          const note = readUint8();
          const velocity = readUint8();
          trackEvents.push({
            tick: currentTick,
            channel,
            type: velocity > 0 ? 'noteOn' : 'noteOff',
            note,
            velocity
          });
        } else if (eventType === 0x80) {
          // Note Off
          const note = readUint8();
          const velocity = readUint8();
          trackEvents.push({
            tick: currentTick,
            channel,
            type: 'noteOff',
            note,
            velocity
          });
        } else if (eventType === 0xC0) {
          // Program Change (Instrument)
          const program = readUint8();
          trackEvents.push({
            tick: currentTick,
            channel,
            type: 'programChange',
            program
          });
        } else if (eventType === 0xB0) {
          // Control Change
          const controller = readUint8();
          const value = readUint8();
          trackEvents.push({
            tick: currentTick,
            channel,
            type: 'controlChange',
            controller,
            value
          });
        } else if (eventType === 0xE0) {
          // Pitch Bend
          const lsb = readUint8();
          const msb = readUint8();
          const bend = ((msb << 7) | lsb) - 8192;
          trackEvents.push({
            tick: currentTick,
            channel,
            type: 'pitchBend',
            bend
          });
        } else if (eventType === 0xA0) {
          // Polyphonic Aftertouch
          readUint8(); readUint8();
        } else if (eventType === 0xD0) {
          // Channel Aftertouch
          readUint8();
        }

        // Ensure we don't overshoot chunk
        if (offset > chunkEnd) {
          offset = chunkEnd;
          break;
        }
      }

      rawTracks.push({
        trackIndex: t,
        name: trackName,
        events: trackEvents
      });
      offset = chunkEnd;
    }

    // 3. Process Tempo Map
    // Sort tempoMap by tick
    tempoMap.sort((a, b) => a.tick - b.tick);
    
    // Deduplicate at same tick, keep last
    const cleanTempoMap = [];
    for (const t of tempoMap) {
      if (cleanTempoMap.length > 0 && cleanTempoMap[cleanTempoMap.length - 1].tick === t.tick) {
        cleanTempoMap[cleanTempoMap.length - 1] = t;
      } else {
        cleanTempoMap.push(t);
      }
    }

    // Precalculate cumulative time for each tempo change segment
    let accumulatedSeconds = 0;
    for (let i = 0; i < cleanTempoMap.length; i++) {
      const current = cleanTempoMap[i];
      if (i > 0) {
        const prev = cleanTempoMap[i - 1];
        const deltaTicks = current.tick - prev.tick;
        const secondsPerTick = (prev.mpqn / 1000000) / ticksPerBeat;
        accumulatedSeconds += deltaTicks * secondsPerTick;
      }
      current.time = accumulatedSeconds;
    }

    // Helper: Convert tick to seconds
    function tickToSeconds(tick) {
      let segmentIndex = 0;
      for (let i = 0; i < cleanTempoMap.length; i++) {
        if (cleanTempoMap[i].tick <= tick) {
          segmentIndex = i;
        } else {
          break;
        }
      }
      const segment = cleanTempoMap[segmentIndex];
      const deltaTicks = tick - segment.tick;
      const secondsPerTick = (segment.mpqn / 1000000) / ticksPerBeat;
      return segment.time + deltaTicks * secondsPerTick;
    }

    // 4. Construct Note List and Channel Information
    const parsedTracks = [];
    const allNotes = [];
    const channelPrograms = {}; // channel -> program (default 0)
    const channelTrackNames = {};

    let maxEndTime = 0;

    for (let t = 0; t < rawTracks.length; t++) {
      const rawTrack = rawTracks[t];
      const activeNotes = {}; // key: `${channel}_${note}` -> stack of noteOn events
      const trackNotes = [];
      let detectedChannel = -1;
      let detectedProgram = 0;

      for (const ev of rawTrack.events) {
        const timeSec = tickToSeconds(ev.tick);

        if (ev.type === 'programChange') {
          channelPrograms[ev.channel] = ev.program;
          detectedProgram = ev.program;
          if (detectedChannel === -1) detectedChannel = ev.channel;
        } else if (ev.type === 'noteOn') {
          if (detectedChannel === -1) detectedChannel = ev.channel;
          const key = `${ev.channel}_${ev.note}`;
          if (!activeNotes[key]) activeNotes[key] = [];
          activeNotes[key].push({
            tick: ev.tick,
            time: timeSec,
            note: ev.note,
            velocity: ev.velocity,
            channel: ev.channel
          });
        } else if (ev.type === 'noteOff') {
          const key = `${ev.channel}_${ev.note}`;
          if (activeNotes[key] && activeNotes[key].length > 0) {
            const onEv = activeNotes[key].shift();
            const duration = Math.max(0.05, timeSec - onEv.time);
            const program = (onEv.channel === 9) ? 0 : (channelPrograms[onEv.channel] ?? detectedProgram);
            
            const noteObj = {
              time: onEv.time,
              duration: duration,
              endTime: onEv.time + duration,
              channel: onEv.channel,
              note: onEv.note,
              velocity: onEv.velocity,
              program: program,
              trackIndex: t
            };

            trackNotes.push(noteObj);
            allNotes.push(noteObj);

            if (noteObj.endTime > maxEndTime) {
              maxEndTime = noteObj.endTime;
            }
          }
        }
      }

      // Close any dangling noteOn events (e.g. at end of file)
      for (const key in activeNotes) {
        while (activeNotes[key].length > 0) {
          const onEv = activeNotes[key].shift();
          const duration = 0.5; // default half second
          const program = (onEv.channel === 9) ? 0 : (channelPrograms[onEv.channel] ?? detectedProgram);
          const noteObj = {
            time: onEv.time,
            duration: duration,
            endTime: onEv.time + duration,
            channel: onEv.channel,
            note: onEv.note,
            velocity: onEv.velocity,
            program: program,
            trackIndex: t
          };
          trackNotes.push(noteObj);
          allNotes.push(noteObj);
          if (noteObj.endTime > maxEndTime) {
            maxEndTime = noteObj.endTime;
          }
        }
      }

      // Sort track notes chronologically
      trackNotes.sort((a, b) => a.time - b.time);

      if (detectedChannel >= 0) {
        channelTrackNames[detectedChannel] = rawTrack.name;
      }

      parsedTracks.push({
        index: t,
        name: rawTrack.name,
        channel: detectedChannel,
        program: detectedProgram,
        noteCount: trackNotes.length,
        notes: trackNotes
      });
    }

    // Sort all notes globally by start time
    allNotes.sort((a, b) => a.time - b.time);

    // Initial tempo (BPM)
    const initialBpm = cleanTempoMap.length > 0 ? cleanTempoMap[0].bpm : 120;

    return {
      format,
      numTracks: parsedTracks.length,
      ticksPerBeat,
      duration: Math.max(1, maxEndTime),
      initialBpm,
      tempoMap: cleanTempoMap,
      tracks: parsedTracks,
      allNotes,
      channelPrograms,
      channelTrackNames
    };
  }
}

// Export for browser global or module environment
if (typeof window !== 'undefined') {
  window.MidiParser = MidiParser;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MidiParser;
}
