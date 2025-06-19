let audioContext;
let analyser;
let source;
let mediaStream;
let byteDataArray;
let floatDataArray;
let bufferLength;
let audioBuffer;

const pitchClassCounts = new Array(12).fill(0);
const recentPitches = [];

const fileInput = document.getElementById('audioFile');
const playButton = document.getElementById('playButton');
const micButton = document.getElementById('micButton');
const canvas = document.getElementById('canvas');
const canvasCtx = canvas.getContext('2d');
const pitchOutput = document.getElementById('pitchOutput');
const noteOutput = document.getElementById('noteOutput');
const keyOutput = document.getElementById('keyOutput');
const chordOutput = document.getElementById('chordOutput');

fileInput.addEventListener('change', handleFiles);
playButton.addEventListener('click', playAudioFile);
micButton.addEventListener('click', useMicrophone);

function initAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function handleFiles() {
  const file = fileInput.files[0];
  const reader = new FileReader();

  reader.onload = function (e) {
    initAudioContext();
    audioContext.decodeAudioData(e.target.result, function (buffer) {
      audioBuffer = buffer;
      setupAnalyser();
    });
  };

  reader.readAsArrayBuffer(file);
}

function setupAnalyser() {
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  bufferLength = analyser.fftSize;
  byteDataArray = new Uint8Array(bufferLength);
  floatDataArray = new Float32Array(bufferLength);
  pitchClassCounts.fill(0);
  recentPitches.length = 0;
}

function playAudioFile() {
  if (!audioBuffer) {
    alert('Please load an audio file first.');
    return;
  }
  initAudioContext();
  setupAnalyser();

  source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(analyser);
  analyser.connect(audioContext.destination);
  source.start();

  draw();
}

function useMicrophone() {
  initAudioContext();
  setupAnalyser();

  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    mediaStream = audioContext.createMediaStreamSource(stream);
    mediaStream.connect(analyser);
    draw();
  }).catch((err) => {
    alert('Microphone access denied or not available.');
    console.error(err);
  });
}

function draw() {
  requestAnimationFrame(draw);
  analyser.getByteFrequencyData(byteDataArray);
  analyser.getFloatTimeDomainData(floatDataArray);

  // Visualize frequency
  canvasCtx.fillStyle = '#111';
  canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
  const barWidth = (canvas.width / bufferLength) * 2.5;
  let x = 0;
  for (let i = 0; i < bufferLength; i++) {
    const barHeight = byteDataArray[i];
    canvasCtx.fillStyle = `rgb(${barHeight + 100}, 50, 50)`;
    canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
    x += barWidth + 1;
  }

  // Pitch detection
  const pitch = autoCorrelate(floatDataArray, audioContext.sampleRate);
  if (pitch !== -1) {
    pitchOutput.textContent = `Pitch: ${pitch.toFixed(2)} Hz`;
    const note = frequencyToNote(pitch);
    noteOutput.textContent = `Note: ${note}`;
    const pitchClass = noteToPitchClass(note);
    pitchClassCounts[pitchClass]++;
    recentPitches.push(pitchClass);
    if (recentPitches.length > 5) recentPitches.shift();

    keyOutput.textContent = `Estimated Key: ${estimateKey(pitchClassCounts)}`;
    chordOutput.textContent = `Possible Chord: ${guessChord(recentPitches)}`;
  } else {
    pitchOutput.textContent = "Pitch: --";
    noteOutput.textContent = "Note: --";
    keyOutput.textContent = "Estimated Key: --";
    chordOutput.textContent = "Possible Chord: --";
  }
}

// ------------------- Analysis Functions -------------------

function autoCorrelate(buffer, sampleRate) {
  const SIZE = buffer.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;

  let r1 = 0, r2 = SIZE - 1, threshold = 0.2;
  while (r1 < SIZE / 2 && Math.abs(buffer[r1]) < threshold) r1++;
  while (r2 > SIZE / 2 && Math.abs(buffer[r2]) < threshold) r2--;
  if (r1 >= r2) return -1;

  let bestOffset = -1, bestCorrelation = 0;
  for (let offset = r1; offset <= r2; offset++) {
    let sum = 0;
    for (let i = 0; i < SIZE - offset; i++) {
      sum += buffer[i] * buffer[i + offset];
    }
    const correlation = sum / (SIZE - offset);
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }

  if (bestCorrelation > 0.9 && bestOffset !== -1) {
    return sampleRate / bestOffset;
  }

  return -1;
}

function frequencyToNote(freq) {
  const noteStrings = ['C', 'C#', 'D', 'D#', 'E', 'F',
    'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const A4 = 440;
  const semitone = 12 * Math.log2(freq / A4);
  const noteIndex = Math.round(semitone) + 57;
  const noteName = noteStrings[noteIndex % 12];
  const octave = Math.floor(noteIndex / 12);
  return `${noteName}${octave}`;
}

function noteToPitchClass(note) {
  const map = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5,
                'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  return map[note.replace(/[0-9]/g, '')];
}

function estimateKey(pitchCounts) {
  const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09,
                        2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53,
                        2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  let bestKey = '', bestScore = -Infinity;

  for (let i = 0; i < 12; i++) {
    let majorScore = 0, minorScore = 0;
    for (let j = 0; j < 12; j++) {
      const index = (j + i) % 12;
      majorScore += pitchCounts[j] * majorProfile[index];
      minorScore += pitchCounts[j] * minorProfile[index];
    }
    if (majorScore > bestScore) {
      bestScore = majorScore;
      bestKey = `${noteNameFromIndex(i)} Major`;
    }
    if (minorScore > bestScore) {
      bestScore = minorScore;
      bestKey = `${noteNameFromIndex(i)} Minor`;
    }
  }

  return bestKey;
}

function noteNameFromIndex(i) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F',
                 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return names[i];
}

function guessChord(recent) {
  if (recent.length < 3) return '--';

  const intervals = [
    [0, 4, 7], // major
    [0, 3, 7], // minor
  ];

  const names = ['Major', 'Minor'];

  for (let root = 0; root < 12; root++) {
    for (let i = 0; i < intervals.length; i++) {
      const chordSet = intervals[i].map(x => (root + x) % 12);
      if (chordSet.every(n => recent.includes(n))) {
        return `${noteNameFromIndex(root)} ${names[i]}`;
      }
    }
  }

  return '--';
}
