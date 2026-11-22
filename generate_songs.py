#!/usr/bin/env python3
"""
Generates 3 multi-instrument MIDI songs for the Music Player Web Application.
Each song features at least 8 distinct instruments (plus drums/conductor).
All files conform strictly to the Standard MIDI File (SMF Type 1) specification.
"""
import os
import math
import struct

def encode_vlq(value):
    """Encode an integer into MIDI Variable-Length Quantity bytes."""
    if value == 0:
        return bytes([0])
    buffer = []
    val = value
    buffer.append(val & 0x7F)
    val >>= 7
    while val > 0:
        buffer.append((val & 0x7F) | 0x80)
        val >>= 7
    buffer.reverse()
    return bytes(buffer)

class MidiTrack:
    def __init__(self, name="Track"):
        self.name = name
        self.events = [] # list of (tick, bytes)
        self.set_track_name(0, name)

    def add_meta_event(self, tick, meta_type, data):
        length_bytes = encode_vlq(len(data))
        event_bytes = bytes([0xFF, meta_type]) + length_bytes + data
        self.events.append((tick, event_bytes))

    def set_track_name(self, tick, name):
        self.add_meta_event(tick, 0x03, name.encode('utf-8', errors='ignore'))

    def set_instrument_name(self, tick, name):
        self.add_meta_event(tick, 0x04, name.encode('utf-8', errors='ignore'))

    def set_tempo(self, tick, bpm):
        mpqn = int(60000000 / bpm)
        data = struct.pack(">I", mpqn)[1:]
        self.add_meta_event(tick, 0x51, data)

    def set_time_signature(self, tick, numerator=4, denominator=4):
        denom_pow = int(math.log2(denominator)) if denominator > 0 else 2
        data = bytes([numerator, denom_pow, 24, 8])
        self.add_meta_event(tick, 0x58, data)

    def set_program_change(self, tick, channel, program):
        self.events.append((tick, bytes([0xC0 | (channel & 0x0F), program & 0x7F])))

    def set_control_change(self, tick, channel, controller, value):
        self.events.append((tick, bytes([0xB0 | (channel & 0x0F), controller & 0x7F, value & 0x7F])))

    def add_note(self, start_tick, duration_ticks, channel, note, velocity=85):
        if note < 0 or note > 127:
            return
        # Note On
        self.events.append((start_tick, bytes([0x90 | (channel & 0x0F), note & 0x7F, velocity & 0x7F])))
        # Note Off
        self.events.append((start_tick + duration_ticks, bytes([0x80 | (channel & 0x0F), note & 0x7F, 0])))

    def build_track_data(self):
        def sort_key(item):
            tick, data = item
            status = data[0] if len(data) > 0 else 0
            order = 0
            if (status & 0xF0) == 0x80:
                order = 0
            elif (status & 0xF0) == 0x90 and (len(data) > 2 and data[2] == 0):
                order = 0
            elif status == 0xFF:
                order = -1
            else:
                order = 1
            return (tick, order)

        sorted_events = sorted(self.events, key=sort_key)
        track_bytes = bytearray()
        last_tick = 0
        for tick, ev_bytes in sorted_events:
            delta = tick - last_tick
            if delta < 0:
                delta = 0
            track_bytes.extend(encode_vlq(delta))
            track_bytes.extend(ev_bytes)
            last_tick = tick

        track_bytes.extend(encode_vlq(0))
        track_bytes.extend(bytes([0xFF, 0x2F, 0x00]))
        return b'MTrk' + struct.pack('>I', len(track_bytes)) + track_bytes


class MidiFile:
    def __init__(self, division=480):
        self.division = division
        self.tracks = []

    def add_track(self, track):
        self.tracks.append(track)

    def write(self, filepath):
        header = b'MThd' + struct.pack('>IHHH', 6, 1, len(self.tracks), self.division)
        with open(filepath, 'wb') as f:
            f.write(header)
            for t in self.tracks:
                f.write(t.build_track_data())
        size = os.path.getsize(filepath)
        print(f"Generated {filepath} ({len(self.tracks)} tracks, {size} bytes)")


# ==========================================
# SONG 1: Symphonic Odyssey
# Epic Orchestral / Cinematic (BPM: 108, 4/4)
# 9 Distinct Instruments:
# 1. Acoustic Grand Piano (GM 0, Ch 0)
# 2. String Ensemble 1 (GM 48, Ch 1)
# 3. Cello & Double Bass (GM 42, Ch 2)
# 4. French Horn Section (GM 60, Ch 3)
# 5. Concert Trumpet (GM 56, Ch 4)
# 6. Concert Flute (GM 73, Ch 5)
# 7. Orchestral Harp (GM 46, Ch 6)
# 8. Timpani (GM 47, Ch 7)
# 9. Orchestral Percussion (GM Kit, Ch 9)
# ==========================================
def generate_song_1(output_dir):
    bpm = 108
    ticks_per_beat = 480
    ticks_per_bar = ticks_per_beat * 4 # 1920
    total_bars = 32
    
    midi = MidiFile(division=ticks_per_beat)

    # Track 0: Conductor
    cond = MidiTrack("Conductor / Tempo")
    cond.set_tempo(0, bpm)
    cond.set_time_signature(0, 4, 4)
    midi.add_track(cond)

    # Chord progression for 32 bars (D minor cinematic):
    # Bars 1-4: Intro [Dm, Bb, F, C]
    # Bars 5-12: Theme A [Dm, Bb, C, Dm | Dm, Bb, F, C]
    # Bars 13-20: Theme B / Build [Gm, Dm, Bb, C | Gm, Dm, Bb, A]
    # Bars 21-28: Climax [Dm, Bb, F, C | Bb, C, Dm, Dm]
    # Bars 29-32: Outro [Bb, C, Dm, Dm(maj)]
    chords = [
        # Intro
        [50, 53, 57], [46, 50, 53], [41, 45, 48], [48, 52, 55], # Dm, Bb, F, C
        # Theme A
        [50, 53, 57], [46, 50, 53], [48, 52, 55], [50, 53, 57],
        [50, 53, 57], [46, 50, 53], [41, 45, 48], [48, 52, 55],
        # Theme B / Build
        [43, 46, 50], [50, 53, 57], [46, 50, 53], [48, 52, 55],
        [43, 46, 50], [50, 53, 57], [46, 50, 53], [45, 49, 52], # A major
        # Climax
        [50, 53, 57], [46, 50, 53], [41, 45, 48], [48, 52, 55],
        [46, 50, 53], [48, 52, 55], [50, 53, 57], [50, 53, 57],
        # Outro
        [46, 50, 53], [48, 52, 55], [50, 53, 57], [50, 54, 57] # Picardy third Dmaj
    ]
    roots = [c[0] for c in chords]

    # 1. Acoustic Grand Piano (GM 0, Ch 0)
    # Plays rolling cinematic arpeggios
    t_piano = MidiTrack("Acoustic Grand Piano")
    t_piano.set_program_change(0, 0, 0)
    t_piano.set_control_change(0, 0, 7, 95) # volume
    t_piano.set_control_change(0, 0, 10, 48) # pan slightly left
    for bar_idx in range(total_bars):
        chord = chords[bar_idx]
        bar_start = bar_idx * ticks_per_bar
        # Bass octave on beat 1
        r = chord[0]
        t_piano.add_note(bar_start, ticks_per_bar - 40, 0, r - 12, 85)
        t_piano.add_note(bar_start, ticks_per_bar - 40, 0, r, 75)
        # 8th note arpeggios
        notes_arp = [chord[0], chord[1], chord[2], chord[0]+12, chord[1]+12, chord[2]+12, chord[1]+12, chord[0]+12]
        for step in range(8):
            tick = bar_start + step * (ticks_per_beat // 2)
            p = notes_arp[step % len(notes_arp)]
            vel = 70 + (step % 2) * 10
            t_piano.add_note(tick, (ticks_per_beat // 2) - 15, 0, p, vel)
    midi.add_track(t_piano)

    # 2. String Ensemble 1 (GM 48, Ch 1)
    # Lush sustained chords and emotional counter-melodies
    t_strings = MidiTrack("String Ensemble 1")
    t_strings.set_program_change(0, 1, 48)
    t_strings.set_control_change(0, 1, 7, 90)
    t_strings.set_control_change(0, 1, 10, 75) # pan right
    for bar_idx in range(total_bars):
        chord = chords[bar_idx]
        bar_start = bar_idx * ticks_per_bar
        # Sustained chord tones (octave higher)
        for n in chord:
            vel = 75 if bar_idx < 12 else (88 if bar_idx < 20 else 105)
            t_strings.add_note(bar_start, ticks_per_bar - 20, 1, n + 12, vel)
        # Melody on top for bars 5-28
        if 4 <= bar_idx < 28:
            lead_notes = [chord[2] + 12, chord[1] + 12, chord[0] + 24, chord[2] + 12]
            for step in range(4):
                tick = bar_start + step * ticks_per_beat
                t_strings.add_note(tick, ticks_per_beat - 30, 1, lead_notes[step], 92)
    midi.add_track(t_strings)

    # 3. Cello & Double Bass (GM 42, Ch 2)
    # Powerful low bass foundation and rhythmic staccato pulses in climax
    t_cello = MidiTrack("Cello & Contrabass")
    t_cello.set_program_change(0, 2, 42)
    t_cello.set_control_change(0, 2, 7, 100)
    t_cello.set_control_change(0, 2, 10, 60)
    for bar_idx in range(total_bars):
        bar_start = bar_idx * ticks_per_bar
        r = roots[bar_idx]
        if bar_idx < 12 or bar_idx >= 28:
            # Sustained whole notes
            t_cello.add_note(bar_start, ticks_per_bar - 30, 2, r - 12, 88)
            t_cello.add_note(bar_start, ticks_per_bar - 30, 2, r, 75)
        else:
            # Driving quarter note staccato pulses
            for beat in range(4):
                tick = bar_start + beat * ticks_per_beat
                t_cello.add_note(tick, ticks_per_beat // 2, 2, r - 12, 98)
                t_cello.add_note(tick, ticks_per_beat // 2, 2, r, 85)
    midi.add_track(t_cello)

    # 4. French Horn Section (GM 60, Ch 3)
    # Noble warm harmonies and swelling chords
    t_horn = MidiTrack("French Horn Section")
    t_horn.set_program_change(0, 3, 60)
    t_horn.set_control_change(0, 3, 7, 88)
    t_horn.set_control_change(0, 3, 10, 40)
    for bar_idx in range(total_bars):
        if bar_idx >= 4: # Horns enter in Theme A
            bar_start = bar_idx * ticks_per_bar
            chord = chords[bar_idx]
            # Half-note chords
            t_horn.add_note(bar_start, ticks_per_bar // 2 - 40, 3, chord[0] + 7, 80)
            t_horn.add_note(bar_start, ticks_per_bar // 2 - 40, 3, chord[1] + 7, 75)
            t_horn.add_note(bar_start + ticks_per_bar // 2, ticks_per_bar // 2 - 40, 3, chord[1] + 7, 85)
            t_horn.add_note(bar_start + ticks_per_bar // 2, ticks_per_bar // 2 - 40, 3, chord[2] + 7, 80)
    midi.add_track(t_horn)

    # 5. Concert Trumpet (GM 56, Ch 4)
    # Heroic fanfare lead in the climax
    t_tpt = MidiTrack("Concert Trumpet")
    t_tpt.set_program_change(0, 4, 56)
    t_tpt.set_control_change(0, 4, 7, 95)
    t_tpt.set_control_change(0, 4, 10, 70)
    fanfare_bars = range(20, 28) # Grand Climax
    for bar_idx in fanfare_bars:
        bar_start = bar_idx * ticks_per_bar
        root = roots[bar_idx]
        # Triplet / dotted fanfare motif
        t_tpt.add_note(bar_start, int(ticks_per_beat * 1.5), 4, root + 12, 105)
        t_tpt.add_note(bar_start + int(ticks_per_beat * 1.5), ticks_per_beat // 2, 4, root + 15, 100)
        t_tpt.add_note(bar_start + ticks_per_beat * 2, ticks_per_beat, 4, root + 17, 108)
        t_tpt.add_note(bar_start + ticks_per_beat * 3, ticks_per_beat, 4, root + 19, 110)
    midi.add_track(t_tpt)

    # 6. Concert Flute (GM 73, Ch 5)
    # Lyrical high woodwind melody and flourishes
    t_flute = MidiTrack("Concert Flute")
    t_flute.set_program_change(0, 5, 73)
    t_flute.set_control_change(0, 5, 7, 85)
    t_flute.set_control_change(0, 5, 10, 35)
    # Flute plays melody in Theme A (bars 4-12) and Outro (28-32)
    flute_melody = [
        (4, [ (0, 1.0, 74), (1.0, 1.0, 77), (2.0, 1.5, 81), (3.5, 0.5, 79) ]),
        (5, [ (0, 2.0, 77), (2.0, 1.0, 76), (3.0, 1.0, 74) ]),
        (6, [ (0, 1.5, 76), (1.5, 0.5, 77), (2.0, 2.0, 79) ]),
        (7, [ (0, 4.0, 74) ]),
        (8, [ (0, 1.0, 74), (1.0, 1.0, 77), (2.0, 1.5, 81), (3.5, 0.5, 82) ]),
        (9, [ (0, 2.0, 81), (2.0, 1.0, 79), (3.0, 1.0, 77) ]),
        (10, [ (0, 1.5, 76), (1.5, 0.5, 77), (2.0, 2.0, 79) ]),
        (11, [ (0, 4.0, 74) ]),
        # Outro
        (28, [ (0, 2.0, 77), (2.0, 2.0, 79) ]),
        (29, [ (0, 2.0, 81), (2.0, 2.0, 79) ]),
        (30, [ (0, 3.0, 74), (3.0, 1.0, 72) ]),
        (31, [ (0, 4.0, 74) ])
    ]
    for bar_num, notes in flute_melody:
        bar_start = bar_num * ticks_per_bar
        for start_beat, dur_beats, pitch in notes:
            t_flute.add_note(
                bar_start + int(start_beat * ticks_per_beat),
                int(dur_beats * ticks_per_beat) - 20,
                5,
                pitch,
                88
            )
    midi.add_track(t_flute)

    # 7. Orchestral Harp (GM 46, Ch 6)
    # Sweeping glissandos and delicate broken chords
    t_harp = MidiTrack("Orchestral Harp")
    t_harp.set_program_change(0, 6, 46)
    t_harp.set_control_change(0, 6, 7, 85)
    t_harp.set_control_change(0, 6, 10, 85)
    for bar_idx in range(total_bars):
        if bar_idx in [0, 1, 2, 3, 12, 13, 14, 15, 20, 24, 28, 29, 30, 31]:
            bar_start = bar_idx * ticks_per_bar
            chord = chords[bar_idx]
            # Rapid harp roll (16th notes upward)
            harp_pitches = [chord[0], chord[1], chord[2], chord[0]+12, chord[1]+12, chord[2]+12, chord[0]+24, chord[2]+24]
            for step, p in enumerate(harp_pitches):
                tick = bar_start + step * (ticks_per_beat // 4)
                t_harp.add_note(tick, ticks_per_beat * 2, 6, p, 78 + (step * 3))
    midi.add_track(t_harp)

    # 8. Timpani (GM 47, Ch 7)
    # Dramatic rolls, cadence hits
    t_timpani = MidiTrack("Timpani")
    t_timpani.set_program_change(0, 7, 47)
    t_timpani.set_control_change(0, 7, 7, 95)
    t_timpani.set_control_change(0, 7, 10, 55)
    for bar_idx in range(total_bars):
        bar_start = bar_idx * ticks_per_bar
        r = roots[bar_idx]
        timp_note = 38 if (r % 12) == 2 else (34 if (r % 12) == 10 else 41) # D, Bb, F
        if bar_idx in [3, 7, 11, 15, 19, 23, 27, 31]: # Cadence bars
            # Timpani roll (16th notes crescendo)
            for step in range(8):
                tick = bar_start + (ticks_per_bar // 2) + step * (ticks_per_beat // 4)
                t_timpani.add_note(tick, ticks_per_beat // 4, 7, timp_note, 60 + step * 7)
            # Final accent on beat 4.5
            t_timpani.add_note(bar_start + int(ticks_per_beat * 3.5), ticks_per_beat // 2, 7, timp_note, 115)
        elif bar_idx >= 12:
            # Beat 1 impact
            t_timpani.add_note(bar_start, ticks_per_beat, 7, timp_note, 95)
    midi.add_track(t_timpani)

    # 9. Orchestral Percussion (GM Drum Kit, Ch 9)
    # Concert Bass Drum (35), Snare Roll/Hits (38/40), Crash Cymbal (49), Ride/Triangle
    t_perc = MidiTrack("Orchestral Percussion")
    t_perc.set_control_change(0, 9, 7, 90)
    for bar_idx in range(total_bars):
        bar_start = bar_idx * ticks_per_bar
        # Crash cymbal on section transitions
        if bar_idx in [0, 4, 12, 20, 28]:
            t_perc.add_note(bar_start, ticks_per_beat * 3, 9, 49, 105) # Crash 1
        
        if bar_idx >= 12: # Rhythm enters
            # Bass drum on beat 1 & 3
            t_perc.add_note(bar_start, ticks_per_beat, 9, 35, 95)
            t_perc.add_note(bar_start + ticks_per_beat * 2, ticks_per_beat, 9, 35, 90)
            # Snare drum cadence
            if bar_idx >= 20: # Climax marching snare
                for beat in range(4):
                    tick = bar_start + beat * ticks_per_beat
                    t_perc.add_note(tick + (ticks_per_beat // 2), ticks_per_beat // 4, 9, 38, 85)
                    t_perc.add_note(tick + (ticks_per_beat * 3 // 4), ticks_per_beat // 4, 9, 38, 88)
    midi.add_track(t_perc)

    filepath = os.path.join(output_dir, "song1_symphonic_odyssey.mid")
    midi.write(filepath)


# ==========================================
# SONG 2: Cyberpunk Funk
# Synthwave / Electro-Funk (BPM: 124, 4/4)
# 9 Distinct Instruments:
# 1. Synth Bass (GM 38, Ch 0)
# 2. Electric Piano / Rhodes (GM 4, Ch 1)
# 3. Clavinet (GM 7, Ch 2)
# 4. Synth Brass (GM 62, Ch 3)
# 5. Lead Synth / Sawtooth (GM 81, Ch 4)
# 6. Synth Pad / Warm Pad (GM 89, Ch 5)
# 7. Marimba / Mallet (GM 12, Ch 6)
# 8. Funk Poly Synth (GM 80, Ch 7)
# 9. Electronic Funk Drums (GM Kit, Ch 9)
# ==========================================
def generate_song_2(output_dir):
    bpm = 124
    ticks_per_beat = 480
    ticks_per_bar = ticks_per_beat * 4 # 1920
    total_bars = 32

    midi = MidiFile(division=ticks_per_beat)

    cond = MidiTrack("Conductor / Tempo")
    cond.set_tempo(0, bpm)
    cond.set_time_signature(0, 4, 4)
    midi.add_track(cond)

    # 8-bar funk groove cycle (E Dorian / Funk):
    # Em9 - Em9 - Am7 - Bm7 | Em9 - Em9 - Cmaj7 - D9 (repeated 4 times = 32 bars)
    chord_cycle = [
        [52, 55, 59, 62, 66], # Em9 (E, G, B, D, F#)
        [52, 55, 59, 62, 66], # Em9
        [45, 48, 52, 55, 59], # Am9 (A, C, E, G, B)
        [47, 50, 54, 57, 61], # Bm9 (B, D, F#, A, C#)
        [52, 55, 59, 62, 66], # Em9
        [52, 55, 59, 62, 66], # Em9
        [48, 52, 55, 59, 62], # Cmaj9 (C, E, G, B, D)
        [50, 54, 57, 60, 64]  # D9 (D, F#, A, C, E)
    ]
    chords = [chord_cycle[i % 8] for i in range(total_bars)]
    bass_roots = [c[0] - 12 for c in chords] # E1, A1, B1, C2, D2

    # 1. Synth Bass (GM 38, Ch 0) - Bouncy 16th-note slap/synth bass groove
    t_bass = MidiTrack("Synth Bass")
    t_bass.set_program_change(0, 0, 38)
    t_bass.set_control_change(0, 0, 7, 105)
    t_bass.set_control_change(0, 0, 10, 64) # Center
    for bar_idx in range(total_bars):
        bar_start = bar_idx * ticks_per_bar
        root = bass_roots[bar_idx]
        # Syncopated funk bass pattern: 1, 1-and-a, 2-and, 3, 3-and-a, 4-and
        # 16th note steps (0..15)
        pattern = [
            (0, 1.5, root, 105),
            (2, 1.0, root + 12, 95), # Octave slap
            (4, 1.5, root, 100),
            (6, 1.0, root + 10, 90), # Flat 7th
            (8, 1.5, root, 105),
            (10, 1.0, root + 12, 98),
            (12, 1.0, root + 7, 95), # 5th
            (14, 1.0, root + 10, 92)
        ]
        for step, dur_steps, pitch, vel in pattern:
            tick = bar_start + int(step * (ticks_per_beat / 4))
            dur = int(dur_steps * (ticks_per_beat / 4)) - 10
            t_bass.add_note(tick, dur, 0, pitch, vel)
    midi.add_track(t_bass)

    # 2. Electric Piano / Rhodes (GM 4, Ch 1) - Syncopated funk comping
    t_rhodes = MidiTrack("Electric Piano (Rhodes)")
    t_rhodes.set_program_change(0, 1, 4)
    t_rhodes.set_control_change(0, 1, 7, 92)
    t_rhodes.set_control_change(0, 1, 10, 45)
    for bar_idx in range(total_bars):
        bar_start = bar_idx * ticks_per_bar
        chord = chords[bar_idx]
        # Funky comping hits: Beat 1-and (step 2), Beat 2-a (step 7), Beat 3-and (step 10), Beat 4-and (step 14)
        comp_steps = [2, 7, 10, 14]
        for s in comp_steps:
            tick = bar_start + int(s * (ticks_per_beat / 4))
            dur = int(1.5 * (ticks_per_beat / 4))
            for note in chord[1:4]: # Inner voices
                t_rhodes.add_note(tick, dur, 1, note + 12, 85)
    midi.add_track(t_rhodes)

    # 3. Clavinet (GM 7, Ch 2) - Stevie Wonder-style rhythmic chank
    t_clavi = MidiTrack("Clavinet")
    t_clavi.set_program_change(0, 2, 7)
    t_clavi.set_control_change(0, 2, 7, 88)
    t_clavi.set_control_change(0, 2, 10, 80)
    for bar_idx in range(total_bars):
        bar_start = bar_idx * ticks_per_bar
        chord = chords[bar_idx]
        root = chord[0]
        # Crisp 16th note chatter
        chank_steps = [0, 3, 5, 8, 11, 13, 15]
        for s in chank_steps:
            tick = bar_start + int(s * (ticks_per_beat / 4))
            t_clavi.add_note(tick, ticks_per_beat // 5, 2, root + 12, 78)
            t_clavi.add_note(tick, ticks_per_beat // 5, 2, root + 15, 75)
    midi.add_track(t_clavi)

    # 4. Synth Brass (GM 62, Ch 3) - Punchy brass accents
    t_brass = MidiTrack("Synth Brass")
    t_brass.set_program_change(0, 3, 62)
    t_brass.set_control_change(0, 3, 7, 95)
    t_brass.set_control_change(0, 3, 10, 35)
    for bar_idx in range(total_bars):
        if (bar_idx % 4) in [1, 3]: # Brass stabs on alternate bars
            bar_start = bar_idx * ticks_per_bar
            chord = chords[bar_idx]
            # Stabs on beat 2.5 and beat 4
            stab_ticks = [bar_start + int(1.5 * ticks_per_beat), bar_start + 3 * ticks_per_beat]
            for st in stab_ticks:
                for n in chord[0:3]:
                    t_brass.add_note(st, ticks_per_beat // 3, 3, n + 12, 95)
    midi.add_track(t_brass)

    # 5. Lead Synth / Sawtooth (GM 81, Ch 4) - Catchy hook melody
    t_lead = MidiTrack("Lead Synth (Sawtooth)")
    t_lead.set_program_change(0, 4, 81)
    t_lead.set_control_change(0, 4, 7, 98)
    t_lead.set_control_change(0, 4, 10, 64)
    # Hook melody plays in bars 8-24
    lead_hook = [
        # Bar 1 (E Dorian hook)
        [(0, 0.75, 76), (0.75, 0.75, 79), (1.5, 1.0, 81), (2.5, 0.5, 83), (3.0, 1.0, 81)],
        # Bar 2
        [(0, 1.5, 79), (1.5, 0.5, 76), (2.0, 1.0, 74), (3.0, 1.0, 76)],
        # Bar 3
        [(0, 0.75, 76), (0.75, 0.75, 79), (1.5, 1.0, 81), (2.5, 0.5, 84), (3.0, 1.0, 83)],
        # Bar 4
        [(0, 2.0, 81), (2.0, 1.0, 79), (3.0, 1.0, 83)]
    ]
    for bar_idx in range(8, 24):
        bar_start = bar_idx * ticks_per_bar
        notes = lead_hook[bar_idx % 4]
        for start_beat, dur_beats, pitch in notes:
            tick = bar_start + int(start_beat * ticks_per_beat)
            dur = int(dur_beats * ticks_per_beat) - 20
            t_lead.add_note(tick, dur, 4, pitch, 100)
    midi.add_track(t_lead)

    # 6. Synth Pad / Warm Pad (GM 89, Ch 5) - Lush background cyberpunk atmosphere
    t_pad = MidiTrack("Synth Pad (Warm)")
    t_pad.set_program_change(0, 5, 89)
    t_pad.set_control_change(0, 5, 7, 78)
    t_pad.set_control_change(0, 5, 10, 64)
    for bar_idx in range(total_bars):
        bar_start = bar_idx * ticks_per_bar
        chord = chords[bar_idx]
        for note in chord[1:4]:
            t_pad.add_note(bar_start, ticks_per_bar - 40, 5, note + 12, 70)
    midi.add_track(t_pad)

    # 7. Marimba / Mallet (GM 12, Ch 6) - Interlocking polyrhythmic arpeggios
    t_marimba = MidiTrack("Marimba")
    t_marimba.set_program_change(0, 6, 12)
    t_marimba.set_control_change(0, 6, 7, 85)
    t_marimba.set_control_change(0, 6, 10, 90) # Pan right
    for bar_idx in range(total_bars):
        bar_start = bar_idx * ticks_per_bar
        chord = chords[bar_idx]
        # Rapid 16th note pentatonic pattern
        arp_scale = [chord[0]+12, chord[1]+12, chord[2]+12, chord[3]+12]
        for step in range(16):
            tick = bar_start + step * (ticks_per_beat // 4)
            p = arp_scale[(step * 2) % len(arp_scale)]
            t_marimba.add_note(tick, (ticks_per_beat // 4) - 10, 6, p, 80 + (step % 4) * 4)
    midi.add_track(t_marimba)

    # 8. Funk Poly Synth (GM 80, Ch 7) - Rhythmic synth counter-melody
    t_poly = MidiTrack("Poly Synth (Square)")
    t_poly.set_program_change(0, 7, 80)
    t_poly.set_control_change(0, 7, 7, 82)
    t_poly.set_control_change(0, 7, 10, 25) # Pan left
    for bar_idx in range(total_bars):
        if bar_idx >= 4:
            bar_start = bar_idx * ticks_per_bar
            chord = chords[bar_idx]
            # Offbeat syncopations on 8th notes
            for beat in range(4):
                tick = bar_start + beat * ticks_per_beat + (ticks_per_beat // 2)
                t_poly.add_note(tick, ticks_per_beat // 3, 7, chord[1] + 24, 78)
    midi.add_track(t_poly)

    # 9. Electronic Funk Drums (GM Kit, Ch 9)
    # Bass Drum (36), Snare (38/40), Closed Hi-hat (42), Open Hi-hat (46), Crash (49)
    t_drums = MidiTrack("Electronic Drums")
    t_drums.set_control_change(0, 9, 7, 105)
    for bar_idx in range(total_bars):
        bar_start = bar_idx * ticks_per_bar
        # Crash on sections (0, 8, 16, 24)
        if (bar_idx % 8) == 0:
            t_drums.add_note(bar_start, ticks_per_beat * 2, 9, 49, 105)

        # Kick on 1 and 3, plus syncopated kick on 3-and (step 10) and 4-and (step 14)
        t_drums.add_note(bar_start, ticks_per_beat // 2, 9, 36, 110)
        t_drums.add_note(bar_start + ticks_per_beat * 2, ticks_per_beat // 2, 9, 36, 105)
        t_drums.add_note(bar_start + int(2.5 * ticks_per_beat), ticks_per_beat // 2, 9, 36, 95)
        t_drums.add_note(bar_start + int(3.5 * ticks_per_beat), ticks_per_beat // 2, 9, 36, 98)

        # Snare on 2 and 4 (standard backbeat)
        t_drums.add_note(bar_start + ticks_per_beat, ticks_per_beat // 2, 9, 38, 108)
        t_drums.add_note(bar_start + ticks_per_beat * 3, ticks_per_beat // 2, 9, 38, 110)

        # 16th note hi-hats with open hi-hat accents on upbeats
        for s in range(16):
            tick = bar_start + s * (ticks_per_beat // 4)
            if s in [2, 6, 10, 14]: # Upbeats open hi-hat
                t_drums.add_note(tick, ticks_per_beat // 4, 9, 46, 88)
            else: # Closed hi-hat
                vel = 70 + (15 if (s % 4) == 0 else 0)
                t_drums.add_note(tick, ticks_per_beat // 6, 9, 42, vel)
    midi.add_track(t_drums)

    filepath = os.path.join(output_dir, "song2_cyberpunk_funk.mid")
    midi.write(filepath)


# ==========================================
# SONG 3: Midnight Jazz Lounge
# Smooth Jazz / Bossa Nova Lounge (BPM: 96, 4/4)
# 9 Distinct Instruments:
# 1. Upright Acoustic Bass (GM 32, Ch 0)
# 2. Jazz Grand Piano (GM 0, Ch 1)
# 3. Tenor Saxophone (GM 66, Ch 2)
# 4. Jazz Electric Guitar (GM 26, Ch 3)
# 5. Vibraphone (GM 11, Ch 4)
# 6. Jazz Flute (GM 73, Ch 5)
# 7. Drawbar Organ / Hammond B3 (GM 16, Ch 6)
# 8. Muted Trumpet (GM 59, Ch 7)
# 9. Jazz Drum Kit / Brushes & Ride (GM Kit, Ch 9)
# ==========================================
def generate_song_3(output_dir):
    bpm = 96
    ticks_per_beat = 480
    ticks_per_bar = ticks_per_beat * 4 # 1920
    total_bars = 32

    midi = MidiFile(division=ticks_per_beat)

    cond = MidiTrack("Conductor / Tempo")
    cond.set_tempo(0, bpm)
    cond.set_time_signature(0, 4, 4)
    midi.add_track(cond)

    # 16-bar Jazz Standard Progression (played twice = 32 bars):
    # Bars 1-4:   | Cmaj9   | Am9     | Dm9     | G13     |
    # Bars 5-8:   | Em9     | A7(b13) | Dm9     | G7(alt) |
    # Bars 9-12:  | Fmaj7   | Fm7/Bb  | Em7     | A7      |
    # Bars 13-16: | Dm7     | G7sus4  | Cmaj9   | Cmaj9   |
    jazz_chords_16 = [
        [48, 52, 55, 59, 62], # Cmaj9 (C, E, G, B, D)
        [45, 48, 52, 55, 59], # Am9 (A, C, E, G, B)
        [50, 53, 57, 60, 64], # Dm9 (D, F, A, C, E)
        [43, 47, 50, 53, 57, 64], # G13 (G, B, D, F, A, E)
        [52, 55, 59, 62, 66], # Em9 (E, G, B, D, F#)
        [45, 49, 52, 55, 58], # A7b13 (A, C#, E, G, F)
        [50, 53, 57, 60, 64], # Dm9
        [43, 47, 52, 54, 58], # G7alt (G, B, Eb, F, Bb)
        [41, 45, 48, 52, 55], # Fmaj9 (F, A, C, E, G)
        [46, 50, 53, 56, 60], # Bbm9 (Bb, Db, F, Ab, C)
        [52, 55, 59, 62],     # Em7 (E, G, B, D)
        [45, 49, 52, 55],     # A7 (A, C#, E, G)
        [50, 53, 57, 60],     # Dm7 (D, F, A, C)
        [43, 48, 50, 53, 57], # G7sus (G, C, D, F, A)
        [48, 52, 55, 59, 62], # Cmaj9
        [48, 52, 55, 59, 62]  # Cmaj9
    ]
    chords = jazz_chords_16 + jazz_chords_16 # 32 bars
    roots = [c[0] for c in chords]

    # 1. Upright Acoustic Bass (GM 32, Ch 0) - Walking jazz bassline
    t_bass = MidiTrack("Upright Acoustic Bass")
    t_bass.set_program_change(0, 0, 32)
    t_bass.set_control_change(0, 0, 7, 98)
    t_bass.set_control_change(0, 0, 10, 64)
    for bar_idx in range(total_bars):
        bar_start = bar_idx * ticks_per_bar
        r = roots[bar_idx] - 12
        next_r = roots[(bar_idx + 1) % total_bars] - 12
        # Walking 4 quarter notes: Root, 3rd/5th, Scale step, Chromatic approach to next root
        step2 = r + 4 if (bar_idx % 2 == 0) else r + 7
        step3 = r + 7 if (bar_idx % 2 == 0) else r + 5
        approach = next_r - 1 if next_r > r else next_r + 1
        walk = [r, step2, step3, approach]
        for beat in range(4):
            tick = bar_start + beat * ticks_per_beat
            t_bass.add_note(tick, ticks_per_beat - 40, 0, walk[beat], 85 + (beat % 2) * 5)
    midi.add_track(t_bass)

    # 2. Jazz Grand Piano (GM 0, Ch 1) - Sophisticated syncopated jazz chords (Charleston rhythm)
    t_piano = MidiTrack("Jazz Grand Piano")
    t_piano.set_program_change(0, 1, 0)
    t_piano.set_control_change(0, 1, 7, 88)
    t_piano.set_control_change(0, 1, 10, 50)
    for bar_idx in range(total_bars):
        bar_start = bar_idx * ticks_per_bar
        chord = chords[bar_idx]
        # Charleston rhythm: Beat 1 and Beat 2-and
        hits = [0, int(1.5 * ticks_per_beat)]
        for h in hits:
            tick = bar_start + h
            for n in chord[1:5]:
                t_piano.add_note(tick, int(1.2 * ticks_per_beat), 1, n + 12, 78)
    midi.add_track(t_piano)

    # 3. Tenor Saxophone (GM 66, Ch 2) - Sultry expressive saxophone lead melody
    t_sax = MidiTrack("Tenor Saxophone")
    t_sax.set_program_change(0, 2, 66)
    t_sax.set_control_change(0, 2, 7, 95)
    t_sax.set_control_change(0, 2, 10, 60)
    # Lyrical 16-bar jazz melody (repeated/embellished in bars 16-32)
    sax_theme = [
        # Bar 0 (Cmaj9)
        [(0.5, 1.5, 67), (2.0, 1.0, 71), (3.0, 1.0, 74)], # G, B, D
        # Bar 1 (Am9)
        [(0.0, 2.0, 72), (2.0, 1.0, 69), (3.0, 1.0, 67)], # C, A, G
        # Bar 2 (Dm9)
        [(0.5, 1.5, 65), (2.0, 1.5, 69), (3.5, 0.5, 71)], # F, A, B
        # Bar 3 (G13)
        [(0.0, 2.5, 72), (2.5, 1.5, 71)],                 # C, B
        # Bar 4 (Em9)
        [(0.5, 1.5, 71), (2.0, 1.0, 74), (3.0, 1.0, 76)], # B, D, E
        # Bar 5 (A7b13)
        [(0.0, 2.0, 77), (2.0, 1.0, 76), (3.0, 1.0, 73)], # F, E, C#
        # Bar 6 (Dm9)
        [(0.5, 1.5, 74), (2.0, 1.5, 72), (3.5, 0.5, 69)], # D, C, A
        # Bar 7 (G7alt)
        [(0.0, 3.0, 71)],                                 # B
        # Bar 8 (Fmaj7)
        [(0.5, 1.5, 69), (2.0, 1.0, 72), (3.0, 1.0, 76)], # A, C, E
        # Bar 9 (Bbm9)
        [(0.0, 2.0, 77), (2.0, 1.0, 75), (3.0, 1.0, 73)], # F, Eb, Db
        # Bar 10 (Em7)
        [(0.5, 1.5, 71), (2.0, 1.5, 74), (3.5, 0.5, 76)], # B, D, E
        # Bar 11 (A7)
        [(0.0, 2.5, 73), (2.5, 1.5, 71)],                 # C#, B
        # Bar 12 (Dm7)
        [(0.5, 1.5, 69), (2.0, 1.0, 72), (3.0, 1.0, 74)], # A, C, D
        # Bar 13 (G7sus)
        [(0.0, 2.0, 71), (2.0, 2.0, 74)],                 # B, D
        # Bar 14 (Cmaj9)
        [(0.0, 3.5, 72)],                                 # C
        # Bar 15
        []
    ]
    for cycle in range(2):
        for bar_idx_in_theme, notes in enumerate(sax_theme):
            bar_idx = cycle * 16 + bar_idx_in_theme
            bar_start = bar_idx * ticks_per_bar
            for start_beat, dur_beats, pitch in notes:
                # Add slight pitch embellishment in 2nd cycle
                p = pitch if cycle == 0 else (pitch + (12 if pitch < 68 else 0))
                tick = bar_start + int(start_beat * ticks_per_beat)
                dur = int(dur_beats * ticks_per_beat) - 25
                t_sax.add_note(tick, dur, 2, p, 90)
    midi.add_track(t_sax)

    # 4. Jazz Electric Guitar (GM 26, Ch 3) - Wes Montgomery-style warm octave comping
    t_guitar = MidiTrack("Jazz Electric Guitar")
    t_guitar.set_program_change(0, 3, 26)
    t_guitar.set_control_change(0, 3, 7, 85)
    t_guitar.set_control_change(0, 3, 10, 75)
    for bar_idx in range(total_bars):
        bar_start = bar_idx * ticks_per_bar
        chord = chords[bar_idx]
        # Four-to-the-bar Freddie Green style soft pulses
        for beat in range(4):
            tick = bar_start + beat * ticks_per_beat
            for n in chord[1:3]:
                t_guitar.add_note(tick, ticks_per_beat // 2, 3, n, 68)
    midi.add_track(t_guitar)

    # 5. Vibraphone (GM 11, Ch 4) - Shimmering vibes fills and counterpoints
    t_vibes = MidiTrack("Vibraphone")
    t_vibes.set_program_change(0, 4, 11)
    t_vibes.set_control_change(0, 4, 7, 86)
    t_vibes.set_control_change(0, 4, 10, 35) # Pan left
    for bar_idx in range(total_bars):
        # Vibraphone fills on every 2nd and 4th bar
        if (bar_idx % 2) == 1:
            bar_start = bar_idx * ticks_per_bar
            chord = chords[bar_idx]
            # Sweet arpeggiated fill on beats 3 and 4
            vib_notes = [chord[2]+12, chord[3]+12, chord[4]+12 if len(chord)>4 else chord[1]+24]
            for i, p in enumerate(vib_notes):
                tick = bar_start + int((2.0 + i * 0.6) * ticks_per_beat)
                t_vibes.add_note(tick, ticks_per_beat, 4, p, 80)
    midi.add_track(t_vibes)

    # 6. Jazz Flute (GM 73, Ch 5) - Airy bossa-jazz counter-melodies
    t_flute = MidiTrack("Jazz Flute")
    t_flute.set_program_change(0, 5, 73)
    t_flute.set_control_change(0, 5, 7, 82)
    t_flute.set_control_change(0, 5, 10, 85)
    for bar_idx in range(16, 32): # Enters on 2nd half
        if (bar_idx % 4) in [0, 2]:
            bar_start = bar_idx * ticks_per_bar
            chord = chords[bar_idx]
            t_flute.add_note(bar_start + int(1.0 * ticks_per_beat), ticks_per_beat, 5, chord[3] + 12, 78)
            t_flute.add_note(bar_start + int(2.5 * ticks_per_beat), int(1.5 * ticks_per_beat), 5, chord[2] + 12, 82)
    midi.add_track(t_flute)

    # 7. Drawbar Organ / Hammond B3 (GM 16, Ch 6) - Warm Leslie sustained background
    t_organ = MidiTrack("Drawbar Organ (Hammond)")
    t_organ.set_program_change(0, 6, 16)
    t_organ.set_control_change(0, 6, 7, 72)
    t_organ.set_control_change(0, 6, 10, 60)
    for bar_idx in range(total_bars):
        bar_start = bar_idx * ticks_per_bar
        chord = chords[bar_idx]
        for n in chord[0:3]:
            t_organ.add_note(bar_start, ticks_per_bar - 40, 6, n + 12, 65)
    midi.add_track(t_organ)

    # 8. Muted Trumpet (GM 59, Ch 7) - Harmon muted trumpet responses
    t_mutetpt = MidiTrack("Muted Trumpet")
    t_mutetpt.set_program_change(0, 7, 59)
    t_mutetpt.set_control_change(0, 7, 7, 84)
    t_mutetpt.set_control_change(0, 7, 10, 40)
    for bar_idx in range(8, 24):
        if (bar_idx % 4) == 3: # End of phrases
            bar_start = bar_idx * ticks_per_bar
            chord = chords[bar_idx]
            # Harmon trumpet lick
            t_mutetpt.add_note(bar_start + int(2.0 * ticks_per_beat), ticks_per_beat // 2, 7, chord[1] + 12, 85)
            t_mutetpt.add_note(bar_start + int(2.5 * ticks_per_beat), ticks_per_beat // 2, 7, chord[2] + 12, 88)
            t_mutetpt.add_note(bar_start + int(3.0 * ticks_per_beat), ticks_per_beat, 7, chord[0] + 24, 92)
    midi.add_track(t_mutetpt)

    # 9. Jazz Drum Kit / Brushes & Ride (GM Kit, Ch 9)
    # Ride Cymbal (51) swung pattern, Feathered Kick (35), Side stick (37), Pedal hi-hat (44)
    t_drums = MidiTrack("Jazz Drums (Brushes/Ride)")
    t_drums.set_control_change(0, 9, 7, 90)
    for bar_idx in range(total_bars):
        bar_start = bar_idx * ticks_per_bar
        # Soft feathering kick on all 4 beats
        for b in range(4):
            tick = bar_start + b * ticks_per_beat
            t_drums.add_note(tick, ticks_per_beat // 3, 9, 35, 62) # Very soft jazz kick
            # Pedal hi-hat chick on beats 2 and 4
            if b in [1, 3]:
                t_drums.add_note(tick, ticks_per_beat // 4, 9, 44, 75)
                # Soft side stick
                t_drums.add_note(tick, ticks_per_beat // 4, 9, 37, 70)

        # Swung Ride Cymbal pattern: 1, 2, 2-and (triplet swing: tick + 2/3 beat), 3, 4, 4-and
        # In 480 ticks/beat: triplet swing offset is ~320 ticks
        ride_offsets = [
            0,
            ticks_per_beat,
            ticks_per_beat + 320,
            ticks_per_beat * 2,
            ticks_per_beat * 3,
            ticks_per_beat * 3 + 320
        ]
        for ro in ride_offsets:
            t_drums.add_note(bar_start + ro, ticks_per_beat // 2, 9, 51, 78)
    midi.add_track(t_drums)

    filepath = os.path.join(output_dir, "song3_midnight_jazz.mid")
    midi.write(filepath)


if __name__ == "__main__":
    out_dir = os.path.join(os.path.dirname(__file__), "songs")
    os.makedirs(out_dir, exist_ok=True)
    print("Generating 3 multi-instrument MIDI songs...")
    generate_song_1(out_dir)
    generate_song_2(out_dir)
    generate_song_3(out_dir)
    print("All 3 MIDI songs generated successfully!")
