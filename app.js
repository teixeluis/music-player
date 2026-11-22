/**
 * Application Coordinator.
 * Initializes SynthEngine, MusicPlayer, and Visualizer.
 * Binds UI transport controls, song cards, mixer channel strips, drag-and-drop, and keyboard shortcuts.
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize Audio and Visual Components
  const synth = new SynthEngine();
  const player = new MusicPlayer(synth);
  const canvas = document.getElementById('visualizerCanvas');
  const visualizer = new Visualizer(canvas, synth, player);

  // 2. DOM Elements
  const songsCarousel = document.getElementById('songsCarousel');
  const songTitleEl = document.getElementById('songTitle');
  const songDescriptionEl = document.getElementById('songDescription');
  const genreBadge = document.getElementById('genreBadge');
  const bpmBadge = document.getElementById('bpmBadge');
  const instrumentsCountBadge = document.getElementById('instrumentsCountBadge');
  const downloadMidiBtn = document.getElementById('downloadMidiBtn');

  // Transport elements
  const playPauseBtn = document.getElementById('playPauseBtn');
  const playIcon = playPauseBtn.querySelector('.play-icon');
  const stopBtn = document.getElementById('stopBtn');
  const rewindBtn = document.getElementById('rewindBtn');
  const forwardBtn = document.getElementById('forwardBtn');
  const prevTrackBtn = document.getElementById('prevTrackBtn');
  const nextTrackBtn = document.getElementById('nextTrackBtn');
  const loopBtn = document.getElementById('loopBtn');
  const speedSelect = document.getElementById('speedSelect');
  const muteBtn = document.getElementById('muteBtn');
  const volumeSlider = document.getElementById('volumeSlider');
  const volumePercent = document.getElementById('volumePercent');
  const volumeIcon = document.getElementById('volumeIcon');
  const seekBar = document.getElementById('seekBar');
  const seekProgress = document.getElementById('seekProgress');
  const currentTimeLabel = document.getElementById('currentTimeLabel');
  const durationLabel = document.getElementById('durationLabel');

  // Mixer elements
  const channelRack = document.getElementById('channelRack');
  const unmuteAllBtn = document.getElementById('unmuteAllBtn');
  const resetMixerBtn = document.getElementById('resetMixerBtn');

  // File loading elements
  const midiFileInput = document.getElementById('midiFileInput');
  const dropOverlay = document.getElementById('dropOverlay');

  // Shortcuts modal
  const shortcutsBtn = document.getElementById('shortcutsBtn');
  const shortcutsModal = document.getElementById('shortcutsModal');
  const closeShortcutsBtn = document.getElementById('closeShortcutsBtn');

  // State
  let currentSongIndex = 0;
  let isSeeking = false;
  const channelStripElements = new Map(); // channelId -> DOM element

  // ========================================================
  // 3. Render Song Selector Carousel
  // ========================================================
  function renderSongCards() {
    songsCarousel.innerHTML = '';

    PRELOADED_SONGS.forEach((song, idx) => {
      const card = document.createElement('div');
      card.className = `song-card ${idx === currentSongIndex ? 'active' : ''}`;
      card.dataset.index = idx;

      const instList = song.instruments.map(i => `${i.icon} ${i.name}`).slice(0, 5).join(', ') + '...';

      card.innerHTML = `
        <div class="card-top">
          <span class="card-title">${song.title}</span>
          <span class="badge badge-instruments">${song.instruments.length} Instruments</span>
        </div>
        <div class="card-genre">${song.genre}</div>
        <div class="card-badges">
          <span class="badge badge-bpm">${song.bpm} BPM</span>
        </div>
        <div class="card-instruments-summary">${instList}</div>
      `;

      card.addEventListener('click', () => {
        selectSong(idx);
      });

      songsCarousel.appendChild(card);
    });

    // Add "Open Custom..." card
    const customCard = document.createElement('div');
    customCard.className = 'song-card custom-card';
    customCard.style.borderStyle = 'dashed';
    customCard.innerHTML = `
      <div class="card-top">
        <span class="card-title">Open Custom File</span>
        <span class="badge badge-info">MIDI</span>
      </div>
      <div class="card-genre">Load your own .mid file</div>
      <div class="card-instruments-summary">Supports all General MIDI files with multi-track instrument playback.</div>
    `;
    customCard.addEventListener('click', () => {
      midiFileInput.click();
    });
    songsCarousel.appendChild(customCard);
  }

  // ========================================================
  // 4. Load & Select Song
  // ========================================================
  function selectSong(index) {
    if (index < 0 || index >= PRELOADED_SONGS.length) return;
    currentSongIndex = index;
    const song = PRELOADED_SONGS[index];

    // Update active card
    document.querySelectorAll('.song-card').forEach((card, idx) => {
      if (idx === index) {
        card.classList.add('active');
      } else {
        card.classList.remove('active');
      }
    });

    // Load song into player
    player.loadSongFromBase64(song.base64, song);
  }

  // ========================================================
  // 5. Player Event Handlers
  // ========================================================
  player.on('songLoaded', ({ song, metadata }) => {
    songTitleEl.textContent = metadata.title;
    songDescriptionEl.textContent = metadata.description;
    genreBadge.textContent = metadata.genre;
    bpmBadge.textContent = `${metadata.bpm} BPM`;
    instrumentsCountBadge.textContent = `${metadata.instruments.length} Instruments`;

    // Configure download button
    downloadMidiBtn.onclick = () => {
      downloadCurrentMidi(metadata);
    };

    renderMixerRack(metadata.instruments);
  });

  player.on('stateChange', (state) => {
    if (state === 'PLAYING') {
      playIcon.textContent = '⏸';
      playPauseBtn.title = 'Pause (Space)';
    } else {
      playIcon.textContent = '▶';
      playPauseBtn.title = 'Play (Space)';
    }
  });

  player.on('timeUpdate', ({ currentTime, duration, progress }) => {
    currentTimeLabel.textContent = formatTime(currentTime);
    durationLabel.textContent = formatTime(duration);

    if (!isSeeking) {
      seekBar.value = progress * 100;
      seekProgress.style.width = `${progress * 100}%`;
    }
  });

  player.on('songEnded', () => {
    // If not looping, we can cycle to next song if desired, or stay stopped
  });

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // ========================================================
  // 6. Multi-Track Mixer Rack (All 8+ Instruments)
  // ========================================================
  function renderMixerRack(instruments) {
    channelRack.innerHTML = '';
    channelStripElements.clear();

    instruments.forEach((inst) => {
      const ch = inst.channel;
      const strip = document.createElement('div');
      strip.className = 'channel-strip';
      strip.dataset.channel = ch;

      strip.innerHTML = `
        <div class="channel-color-accent" style="background-color: ${inst.color}"></div>
        <div class="strip-top">
          <div class="strip-info">
            <span class="strip-icon">${inst.icon}</span>
            <div class="strip-text">
              <span class="strip-name" title="${inst.name}">${inst.name}</span>
              <span class="strip-channel-tag">Ch ${ch + 1} • GM ${inst.program}</span>
            </div>
          </div>
          <div class="led-meter">
            <div class="led-indicator" id="led_ch_${ch}"></div>
          </div>
        </div>

        <div class="strip-controls">
          <button class="btn-mute" id="mute_ch_${ch}" title="Mute Channel (M)">M</button>
          <button class="btn-solo" id="solo_ch_${ch}" title="Solo Channel (S)">S</button>

          <div class="faders-row">
            <div class="fader-group">
              <div class="fader-label">
                <span>VOL</span>
                <span id="vol_val_${ch}">100%</span>
              </div>
              <input type="range" class="fader-slider" id="vol_ch_${ch}" min="0" max="1.5" step="0.05" value="1.0">
            </div>

            <div class="fader-group">
              <div class="fader-label">
                <span>PAN</span>
                <span id="pan_val_${ch}">C</span>
              </div>
              <input type="range" class="fader-slider" id="pan_ch_${ch}" min="-1" max="1" step="0.1" value="0">
            </div>
          </div>
        </div>
      `;

      // Event Listeners for this Channel Strip
      const muteBtn = strip.querySelector(`#mute_ch_${ch}`);
      const soloBtn = strip.querySelector(`#solo_ch_${ch}`);
      const volSlider = strip.querySelector(`#vol_ch_${ch}`);
      const panSlider = strip.querySelector(`#pan_ch_${ch}`);
      const volVal = strip.querySelector(`#vol_val_${ch}`);
      const panVal = strip.querySelector(`#pan_val_${ch}`);
      const led = strip.querySelector(`#led_ch_${ch}`);

      muteBtn.addEventListener('click', () => {
        const isMuted = !muteBtn.classList.contains('active');
        muteBtn.classList.toggle('active', isMuted);
        strip.classList.toggle('is-muted', isMuted);
        synth.setChannelMute(ch, isMuted);
      });

      soloBtn.addEventListener('click', () => {
        const isSolo = !soloBtn.classList.contains('active');
        soloBtn.classList.toggle('active', isSolo);
        synth.setChannelSolo(ch, isSolo);
      });

      volSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        volVal.textContent = `${Math.round(val * 100)}%`;
        synth.setChannelVolume(ch, val);
      });

      panSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (Math.abs(val) < 0.05) {
          panVal.textContent = 'C';
        } else if (val < 0) {
          panVal.textContent = `L${Math.round(-val * 100)}`;
        } else {
          panVal.textContent = `R${Math.round(val * 100)}`;
        }
        synth.setChannelPan(ch, val);
      });

      channelStripElements.set(ch, { strip, led });
      channelRack.appendChild(strip);
    });
  }

  // Listen to Synth note triggers for live LED indicator feedback
  synth.onNoteTrigger = (channel, note, velocity, duration) => {
    const elData = channelStripElements.get(channel);
    if (elData && elData.led) {
      elData.led.classList.add('active');
      setTimeout(() => {
        elData.led.classList.remove('active');
      }, Math.min(250, duration * 1000));
    }
  };

  // Reset mixer actions
  unmuteAllBtn.addEventListener('click', () => {
    document.querySelectorAll('.btn-mute.active').forEach(b => b.click());
    document.querySelectorAll('.btn-solo.active').forEach(b => b.click());
  });

  resetMixerBtn.addEventListener('click', () => {
    channelStripElements.forEach(({ strip }, ch) => {
      const volSlider = strip.querySelector(`#vol_ch_${ch}`);
      const panSlider = strip.querySelector(`#pan_ch_${ch}`);
      if (volSlider) {
        volSlider.value = 1.0;
        volSlider.dispatchEvent(new Event('input'));
      }
      if (panSlider) {
        panSlider.value = 0.0;
        panSlider.dispatchEvent(new Event('input'));
      }
    });
  });

  // ========================================================
  // 7. Transport Button Bindings (REV, PLAY/PAUSE, STOP, FWD)
  // ========================================================

  // Play / Pause
  playPauseBtn.addEventListener('click', () => {
    player.togglePlayPause();
  });

  // Stop
  stopBtn.addEventListener('click', () => {
    player.stop();
  });

  // Rewind (REV) 5s
  rewindBtn.addEventListener('click', () => {
    player.rewind(5);
    animateBtnPress(rewindBtn);
  });

  // Fast Forward (FWD) 5s
  forwardBtn.addEventListener('click', () => {
    player.forward(5);
    animateBtnPress(forwardBtn);
  });

  // Prev / Next Track
  prevTrackBtn.addEventListener('click', () => {
    let nextIdx = currentSongIndex - 1;
    if (nextIdx < 0) nextIdx = PRELOADED_SONGS.length - 1;
    selectSong(nextIdx);
  });

  nextTrackBtn.addEventListener('click', () => {
    let nextIdx = (currentSongIndex + 1) % PRELOADED_SONGS.length;
    selectSong(nextIdx);
  });

  function animateBtnPress(btn) {
    btn.style.transform = 'scale(0.9)';
    setTimeout(() => { btn.style.transform = ''; }, 120);
  }

  // Seek Bar Scrubbing
  seekBar.addEventListener('input', (e) => {
    isSeeking = true;
    const progress = parseFloat(e.target.value) / 100;
    seekProgress.style.width = `${progress * 100}%`;
    currentTimeLabel.textContent = formatTime(progress * player.duration);
  });

  seekBar.addEventListener('change', (e) => {
    const progress = parseFloat(e.target.value) / 100;
    player.seek(progress * player.duration);
    isSeeking = false;
  });

  // Loop toggle
  loopBtn.addEventListener('click', () => {
    const isLooping = !loopBtn.classList.contains('active');
    loopBtn.classList.toggle('active', isLooping);
    player.setLoop(isLooping);
  });

  // Speed selection
  speedSelect.addEventListener('change', (e) => {
    player.setPlaybackRate(parseFloat(e.target.value));
  });

  // Master Volume & Mute
  volumeSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    synth.setMasterVolume(val);
    volumePercent.textContent = `${Math.round((val / 1.5) * 100)}%`;
    if (val === 0) {
      volumeIcon.textContent = '🔇';
    } else if (val < 0.7) {
      volumeIcon.textContent = '🔉';
    } else {
      volumeIcon.textContent = '🔊';
    }
  });

  muteBtn.addEventListener('click', () => {
    const isMuted = !muteBtn.classList.contains('active');
    muteBtn.classList.toggle('active', isMuted);
    synth.setMute(isMuted);
    volumeIcon.textContent = isMuted ? '🔇' : (synth.masterVolume > 0.7 ? '🔊' : '🔉');
  });

  // Visualizer Mode Tabs
  document.querySelectorAll('#visualizerTabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#visualizerTabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      visualizer.setMode(btn.dataset.mode);
    });
  });

  // ========================================================
  // 8. File Loading & Drag-and-Drop
  // ========================================================
  midiFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    loadMidiFile(file);
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropOverlay.classList.add('active');
  });

  dropOverlay.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropOverlay.classList.remove('active');
  });

  dropOverlay.addEventListener('drop', (e) => {
    e.preventDefault();
    dropOverlay.classList.remove('active');
    const file = e.dataTransfer.files[0];
    if (file) {
      loadMidiFile(file);
    }
  });

  function loadMidiFile(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const buffer = ev.target.result;
      const metadata = {
        id: 'file_' + Date.now(),
        title: file.name.replace(/\.[^/.]+$/, ""),
        genre: 'Custom Upload',
        bpm: 120,
        description: `Imported MIDI file "${file.name}" (${(file.size / 1024).toFixed(1)} KB).`
      };
      const success = player.loadSong(buffer, metadata);
      if (success) {
        // Deselect preloaded cards
        document.querySelectorAll('.song-card').forEach(c => c.classList.remove('active'));
        player.play();
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function downloadCurrentMidi(metadata) {
    if (!metadata) return;
    let blob = null;

    if (metadata.rawBuffer) {
      blob = new Blob([metadata.rawBuffer], { type: 'audio/midi' });
    } else if (metadata.base64) {
      const binary = atob(metadata.base64);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
      blob = new Blob([bytes], { type: 'audio/midi' });
    }

    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (metadata.filename || metadata.title.toLowerCase().replace(/\s+/g, '_') + '.mid');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  // ========================================================
  // 9. Keyboard Shortcuts
  // ========================================================
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    if (e.code === 'Space') {
      e.preventDefault();
      player.togglePlayPause();
    } else if (e.code === 'KeyS') {
      e.preventDefault();
      player.stop();
    } else if (e.code === 'ArrowLeft' || e.code === 'KeyJ') {
      e.preventDefault();
      player.rewind(5);
      animateBtnPress(rewindBtn);
    } else if (e.code === 'ArrowRight' || e.code === 'KeyL') {
      e.preventDefault();
      player.forward(5);
      animateBtnPress(forwardBtn);
    } else if (e.code === 'ArrowUp') {
      e.preventDefault();
      const current = parseFloat(volumeSlider.value);
      volumeSlider.value = Math.min(1.5, current + 0.1);
      volumeSlider.dispatchEvent(new Event('input'));
    } else if (e.code === 'ArrowDown') {
      e.preventDefault();
      const current = parseFloat(volumeSlider.value);
      volumeSlider.value = Math.max(0, current - 0.1);
      volumeSlider.dispatchEvent(new Event('input'));
    } else if (e.code === 'KeyM') {
      e.preventDefault();
      muteBtn.click();
    } else if (e.code === 'KeyR') {
      e.preventDefault();
      loopBtn.click();
    } else if (e.code === 'Digit1') {
      selectSong(0);
    } else if (e.code === 'Digit2') {
      selectSong(1);
    } else if (e.code === 'Digit3') {
      selectSong(2);
    } else if (e.code === 'KeyO') {
      e.preventDefault();
      midiFileInput.click();
    }
  });

  // Shortcuts modal toggle
  shortcutsBtn.addEventListener('click', () => {
    shortcutsModal.classList.add('active');
  });

  closeShortcutsBtn.addEventListener('click', () => {
    shortcutsModal.classList.remove('active');
  });

  shortcutsModal.addEventListener('click', (e) => {
    if (e.target === shortcutsModal) {
      shortcutsModal.classList.remove('active');
    }
  });

  // 10. Startup: Render cards and load Song 1
  renderSongCards();
  selectSong(0);
});
