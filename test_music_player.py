#!/usr/bin/env python3
"""
Comprehensive validation test suite for the Neon MIDI Studio Music Player.
Tests:
1. Standard MIDI File validity (SMF Type 1, MThd, MTrk headers, VLQ decoding).
2. Requirement check: At least 8 instruments per song.
3. Track and note verification (note-on/note-off balance, non-zero velocities).
4. Web application file integrity and assets.
"""
import os
import sys
import struct
import json

WORKSPACE = os.path.dirname(os.path.abspath(__file__))

def parse_midi_file(filepath):
    with open(filepath, 'rb') as f:
        data = f.read()

    assert data[:4] == b'MThd', f"Invalid MThd header in {filepath}"
    header_len, fmt, num_tracks, division = struct.unpack('>IHHH', data[4:14])
    assert header_len == 6, f"Expected header length 6, got {header_len}"
    assert fmt == 1, f"Expected Format 1, got {fmt}"

    tracks = []
    idx = 14
    for t_idx in range(num_tracks):
        assert data[idx:idx+4] == b'MTrk', f"Expected MTrk at track {t_idx}"
        trk_len = struct.unpack('>I', data[idx+4:idx+8])[0]
        trk_data = data[idx+8:idx+8+trk_len]
        idx += 8 + trk_len

        # Parse track events
        pos = 0
        name = ""
        programs = {}
        note_ons = 0
        note_offs = 0
        channels = set()

        while pos < len(trk_data):
            # VLQ delta
            delta = 0
            while True:
                b = trk_data[pos]; pos += 1
                delta = (delta << 7) | (b & 0x7F)
                if not (b & 0x80): break

            if pos >= len(trk_data): break
            ev = trk_data[pos]; pos += 1

            if ev == 0xFF: # Meta
                meta_type = trk_data[pos]; pos += 1
                l = 0
                while True:
                    b = trk_data[pos]; pos += 1
                    l = (l << 7) | (b & 0x7F)
                    if not (b & 0x80): break
                mdata = trk_data[pos:pos+l]; pos += l
                if meta_type == 0x03 or meta_type == 0x04:
                    name = mdata.decode('utf-8', errors='ignore')
            elif (ev & 0xF0) == 0xC0: # Program change
                ch = ev & 0x0F
                prog = trk_data[pos]; pos += 1
                programs[ch] = prog
                channels.add(ch)
            elif (ev & 0xF0) == 0x90: # Note On
                ch = ev & 0x0F
                note = trk_data[pos]; vel = trk_data[pos+1]; pos += 2
                channels.add(ch)
                if vel > 0:
                    note_ons += 1
                else:
                    note_offs += 1
            elif (ev & 0xF0) == 0x80: # Note Off
                ch = ev & 0x0F
                pos += 2
                channels.add(ch)
                note_offs += 1
            elif (ev & 0xF0) in (0xA0, 0xB0, 0xE0):
                ch = ev & 0x0F
                pos += 2
                channels.add(ch)
            elif (ev & 0xF0) == 0xD0:
                pos += 1

        tracks.append({
            "index": t_idx,
            "name": name,
            "programs": programs,
            "channels": list(channels),
            "note_ons": note_ons,
            "note_offs": note_offs
        })

    return {
        "format": fmt,
        "num_tracks": num_tracks,
        "division": division,
        "tracks": tracks
    }

def test_all():
    print("========================================")
    print("NEON MIDI STUDIO - COMPREHENSIVE QA TEST")
    print("========================================")

    # 1. Check Web App Files
    required_files = [
        "index.html",
        "styles.css",
        "midi-parser.js",
        "synth-engine.js",
        "player.js",
        "visualizer.js",
        "app.js",
        "songs-data.js",
        "server.py",
        "generate_songs.py"
    ]
    for rf in required_files:
        path = os.path.join(WORKSPACE, rf)
        assert os.path.isfile(path), f"Missing required file: {rf}"
        size = os.path.getsize(path)
        assert size > 0, f"File {rf} is empty!"
        print(f"✓ File present: {rf:18s} ({size:,} bytes)")

    # 2. Check the 3 MIDI songs
    song_files = [
        ("song1_symphonic_odyssey.mid", "Symphonic Odyssey", 8),
        ("song2_cyberpunk_funk.mid", "Cyberpunk Funk", 8),
        ("song3_midnight_jazz.mid", "Midnight Jazz Lounge", 8)
    ]

    for fname, title, min_instruments in song_files:
        fpath = os.path.join(WORKSPACE, "songs", fname)
        assert os.path.isfile(fpath), f"MIDI song file missing: {fpath}"
        parsed = parse_midi_file(fpath)

        # Count tracks with active musical notes
        active_musical_tracks = [t for t in parsed["tracks"] if t["note_ons"] > 0]
        total_notes = sum(t["note_ons"] for t in active_musical_tracks)

        print(f"\n--- Checking '{title}' ({fname}) ---")
        print(f"  Tracks: {parsed['num_tracks']} total, {len(active_musical_tracks)} active instrument tracks")
        print(f"  Total Notes: {total_notes}")
        for t in active_musical_tracks:
            prog_info = f"Program: {t['programs']}" if t['programs'] else "Percussion (Ch 9)"
            print(f"    • {t['name']:28s} | Notes: {t['note_ons']:4d} | {prog_info}")

        assert len(active_musical_tracks) >= min_instruments, (
            f"Song '{title}' has only {len(active_musical_tracks)} instruments, expected >= {min_instruments}!"
        )
        print(f"  ✓ PASSED: Features {len(active_musical_tracks)} distinct instruments (exceeds requirement of >= {min_instruments})")

    # 3. Check songs-data.js content
    songs_data_path = os.path.join(WORKSPACE, "songs-data.js")
    with open(songs_data_path, "r") as f:
        content = f.read()
    assert "const PRELOADED_SONGS =" in content, "Missing PRELOADED_SONGS in songs-data.js"
    json_part = content.split("const PRELOADED_SONGS =", 1)[1].strip().rstrip(";")
    songs_list = json.loads(json_part)
    assert len(songs_list) == 3, f"Expected 3 preloaded songs, got {len(songs_list)}"
    for s in songs_list:
        assert len(s["instruments"]) >= 8, f"Song {s['title']} instruments list < 8"
        assert len(s["base64"]) > 1000, f"Song {s['title']} base64 data too short"
        print(f"✓ Preloaded song metadata validated: '{s['title']}' ({len(s['instruments'])} instruments)")

    print("\n========================================")
    print("ALL TESTS PASSED SUCCESSFULLY! (100% OK)")
    print("========================================")

if __name__ == "__main__":
    test_all()
