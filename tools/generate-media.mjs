#!/usr/bin/env node
/**
 * CADENZA — royalty-free sample library generator.
 *
 * Everything the app streams is synthesised by this script on the machine that
 * runs it: no downloads, no third-party audio, no copyrighted material.
 *
 *   node tools/generate-media.mjs
 *
 * Pipeline per track:
 *   1. render a mono 44.1 kHz float mix from the track's arrangement spec
 *      (detuned pad voices + sub bass + arpeggio + synthesised drum kit,
 *       through a small Schroeder reverb)
 *   2. write a 16-bit PCM WAV to a scratch dir
 *   3. encode to MP3 with ffmpeg (libmp3lame, 96 kbps mono)
 *   4. compute waveform peaks (120 buckets, 0..1) -> media/peaks/<slug>.json
 *   5. generate a gradient cover -> media/covers/<slug>.svg
 *   6. record title/artist/album/duration/peaks in media/MANIFEST.json
 *
 * The manifest is what the API seed script reads, so the database and the audio
 * files can never drift apart.
 */
import { execFile } from 'node:child_process';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA_DIR = path.join(ROOT, 'media');
const SAMPLE_RATE = 44_100;
const PEAK_BUCKETS = 120;

// ---------------------------------------------------------------------------
// tiny DSP toolkit
// ---------------------------------------------------------------------------
const TAU = Math.PI * 2;
const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/** Additive band-limited oscillator; `harmonics` caps the series to avoid alias hash. */
function oscillator(wave, phase) {
  const p = phase - Math.floor(phase);
  switch (wave) {
    case 'sine':
      return Math.sin(TAU * p);
    case 'triangle':
      return 2 * Math.abs(2 * (p - Math.floor(p + 0.5))) - 1;
    case 'saw': {
      let sum = 0;
      for (let n = 1; n <= 12; n += 1) sum += Math.sin(TAU * n * p) / n;
      return (2 / Math.PI) * sum;
    }
    case 'square': {
      let sum = 0;
      for (let n = 1; n <= 11; n += 2) sum += Math.sin(TAU * n * p) / n;
      return (4 / Math.PI) * sum;
    }
    default:
      return Math.sin(TAU * p);
  }
}

function adsr(t, dur, attack, decay, sustain, release) {
  if (t < 0 || t > dur) return 0;
  if (t < attack) return t / attack;
  if (t < attack + decay) return 1 - (1 - sustain) * ((t - attack) / decay);
  if (t < dur - release) return sustain;
  return sustain * Math.max(0, (dur - t) / release);
}

function onePoleLowpass(cutoffHz) {
  const alpha = Math.exp((-TAU * cutoffHz) / SAMPLE_RATE);
  let last = 0;
  return (x) => {
    last = (1 - alpha) * x + alpha * last;
    return last;
  };
}

function highpass(x, cutoffHz) {
  return x - onePoleLowpass(cutoffHz)(x);
}

/** Deterministic PRNG so regenerating the library is byte-stable per track. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Schroeder reverb: two combs + one allpass. Cheap, but it removes the "dry synth" feel. */
function reverb(input, { wet = 0.2, feedback = 0.72 } = {}) {
  const out = new Float32Array(input.length);
  const combs = [
    { delay: Math.round(0.0297 * SAMPLE_RATE), buf: new Float32Array(Math.round(0.0297 * SAMPLE_RATE)), idx: 0, damp: 0.35 },
    { delay: Math.round(0.0371 * SAMPLE_RATE), buf: new Float32Array(Math.round(0.0371 * SAMPLE_RATE)), idx: 0, damp: 0.4 },
  ];
  const apDelay = Math.round(0.005 * SAMPLE_RATE);
  const apBuf = new Float32Array(apDelay);
  let apIdx = 0;
  let damped = 0;

  for (let i = 0; i < input.length; i += 1) {
    let wetSum = 0;
    for (const comb of combs) {
      const delayed = comb.buf[comb.idx];
      damped = delayed * (1 - comb.damp) + damped * comb.damp;
      comb.buf[comb.idx] = input[i] + damped * feedback;
      comb.idx = (comb.idx + 1) % comb.delay;
      wetSum += delayed;
    }
    wetSum /= combs.length;
    const apOut = -wetSum + apBuf[apIdx];
    apBuf[apIdx] = wetSum + apBuf[apIdx] * 0.5;
    apIdx = (apIdx + 1) % apDelay;
    out[i] = input[i] * (1 - wet) + apOut * wet;
  }
  return out;
}

// ---------------------------------------------------------------------------
// voices
// ---------------------------------------------------------------------------
function renderPad(spec, totalSamples, rand) {
  const buf = new Float32Array(totalSamples);
  const beat = 60 / spec.bpm;
  const chordBeats = spec.chordBeats ?? 4;
  const chordDur = chordBeats * beat;
  const lowpass = onePoleLowpass(spec.padCutoff ?? 2400);
  const voices = [
    { detune: -0.007, gain: 1 },
    { detune: 0.004, gain: 1 },
    { detune: 0.011, gain: 0.6 },
  ];

  const chordCount = Math.ceil(totalSamples / SAMPLE_RATE / chordDur);
  for (let c = 0; c < chordCount; c += 1) {
    const chord = spec.progression[c % spec.progression.length];
    const startSample = Math.round(c * chordDur * SAMPLE_RATE);
    const chordSamples = Math.round(chordDur * SAMPLE_RATE);
    for (const offset of chord) {
      const midi = spec.rootMidi + offset + 12;
      const baseFreq = midiToFreq(midi);
      for (const voice of voices) {
        const freq = baseFreq * (1 + voice.detune);
        let phase = rand();
        for (let i = 0; i < chordSamples; i += 1) {
          const idx = startSample + i;
          if (idx >= totalSamples) break;
          const t = i / SAMPLE_RATE;
          const env = adsr(t, chordDur, 0.35, 0.5, 0.75, 0.7);
          const sample = oscillator(spec.padWave, phase) * env * voice.gain * (spec.padGain ?? 0.11);
          buf[idx] += lowpass(sample);
          phase += freq / SAMPLE_RATE;
        }
      }
    }
  }
  return buf;
}

function renderBass(spec, totalSamples) {
  const buf = new Float32Array(totalSamples);
  const beat = 60 / spec.bpm;
  const step = beat / 2; // eighth notes
  const steps = Math.ceil((totalSamples / SAMPLE_RATE) / step);
  const pattern = spec.bassPattern ?? [0, null, 0, null, 0, null, 5, null];

  for (let s = 0; s < steps; s += 1) {
    const degree = pattern[s % pattern.length];
    if (degree === null) continue;
    const chord = spec.progression[Math.floor((s * step) / (beat * (spec.chordBeats ?? 4))) % spec.progression.length];
    const chordRoot = chord[0] ?? 0;
    const midi = spec.rootMidi - 12 + chordRoot + degree;
    const freq = midiToFreq(midi);
    const dur = step * 0.92;
    const startSample = Math.round(s * step * SAMPLE_RATE);
    const len = Math.round(dur * SAMPLE_RATE);
    let phase = 0;
    for (let i = 0; i < len; i += 1) {
      const idx = startSample + i;
      if (idx >= totalSamples) break;
      const t = i / SAMPLE_RATE;
      const env = adsr(t, dur, 0.008, 0.12, 0.7, 0.12);
      const sample = oscillator('triangle', phase) * env * (spec.bassGain ?? 0.34);
      buf[idx] += Math.tanh(sample * 1.6) * 0.75; // gentle drive
      phase += freq / SAMPLE_RATE;
    }
  }
  return buf;
}

function renderArp(spec, totalSamples, rand) {
  const buf = new Float32Array(totalSamples);
  const beat = 60 / spec.bpm;
  const step = beat / 2;
  const steps = Math.ceil((totalSamples / SAMPLE_RATE) / step);
  const pattern = spec.arpPattern ?? [0, 1, 2, 3, 2, 1, 0, 2];

  for (let s = 0; s < steps; s += 1) {
    const slot = pattern[s % pattern.length];
    if (slot === null) continue;
    const chord = spec.progression[Math.floor((s * step) / (beat * (spec.chordBeats ?? 4))) % spec.progression.length];
    const tone = chord[slot % chord.length] ?? 0;
    const octave = slot >= chord.length ? 12 : 0;
    const freq = midiToFreq(spec.rootMidi + tone + octave + 24);
    const dur = step * 0.85;
    const startSample = Math.round(s * step * SAMPLE_RATE);
    const len = Math.round(dur * SAMPLE_RATE);
    let phase = rand();
    for (let i = 0; i < len; i += 1) {
      const idx = startSample + i;
      if (idx >= totalSamples) break;
      const t = i / SAMPLE_RATE;
      const env = adsr(t, dur, 0.004, 0.16, 0.35, 0.18);
      buf[idx] += oscillator(spec.arpWave ?? 'sine', phase) * env * (spec.arpGain ?? 0.19);
      phase += freq / SAMPLE_RATE;
    }
  }
  return buf;
}

function renderDrums(spec, totalSamples, rand) {
  const buf = new Float32Array(totalSamples);
  const beat = 60 / spec.bpm;
  const step = beat / 4; // sixteenth notes
  const steps = Math.ceil((totalSamples / SAMPLE_RATE) / step);
  const kick = spec.drums?.kick ?? 'x...x...x...x...';
  const snare = spec.drums?.snare ?? '....x.......x...';
  const hat = spec.drums?.hat ?? 'x.x.x.x.x.x.x.x.';

  const addKick = (start) => {
    const len = Math.round(0.26 * SAMPLE_RATE);
    for (let i = 0; i < len; i += 1) {
      const idx = start + i;
      if (idx >= totalSamples) break;
      const t = i / SAMPLE_RATE;
      const freq = 118 * Math.exp(-t * 26) + 44;
      const env = Math.exp(-t * 13);
      buf[idx] += Math.sin(TAU * freq * t) * env * 0.62;
    }
  };
  const addSnare = (start) => {
    const len = Math.round(0.2 * SAMPLE_RATE);
    for (let i = 0; i < len; i += 1) {
      const idx = start + i;
      if (idx >= totalSamples) break;
      const t = i / SAMPLE_RATE;
      const noise = (rand() * 2 - 1) * Math.exp(-t * 26);
      const body = Math.sin(TAU * 186 * t) * Math.exp(-t * 34) * 0.35;
      buf[idx] += highpass(noise, 1400) * 0.3 + body * 0.4;
    }
  };
  const addHat = (start) => {
    const len = Math.round(0.07 * SAMPLE_RATE);
    for (let i = 0; i < len; i += 1) {
      const idx = start + i;
      if (idx >= totalSamples) break;
      const t = i / SAMPLE_RATE;
      buf[idx] += highpass(rand() * 2 - 1, 6200) * Math.exp(-t * 90) * 0.16;
    }
  };

  for (let s = 0; s < steps; s += 1) {
    const start = Math.round(s * step * SAMPLE_RATE);
    if (kick[s % kick.length] === 'x') addKick(start);
    if (snare[s % snare.length] === 'x') addSnare(start);
    if (hat[s % hat.length] === 'x') addHat(start);
  }
  return buf;
}

function renderTrack(spec) {
  const totalSamples = Math.round(spec.durationSec * SAMPLE_RATE);
  const rand = mulberry32(spec.seed);
  const pad = renderPad(spec, totalSamples, rand);
  const bass = renderBass(spec, totalSamples);
  const arp = renderArp(spec, totalSamples, rand);
  const drums = renderDrums(spec, totalSamples, rand);

  const mix = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i += 1) {
    mix[i] = pad[i] + bass[i] + arp[i] + drums[i];
  }
  const wet = reverb(mix, { wet: spec.reverbWet ?? 0.18 });

  // fade in/out + normalise to -1.5 dBFS
  const fadeSamples = Math.round(0.35 * SAMPLE_RATE);
  let peak = 0;
  for (let i = 0; i < totalSamples; i += 1) {
    const fadeIn = Math.min(1, i / fadeSamples);
    const fadeOut = Math.min(1, (totalSamples - 1 - i) / fadeSamples);
    wet[i] *= Math.min(fadeIn, fadeOut);
    peak = Math.max(peak, Math.abs(wet[i]));
  }
  const target = 0.84;
  const gain = peak > 0 ? target / peak : 1;
  for (let i = 0; i < totalSamples; i += 1) wet[i] *= gain;
  return wet;
}

// ---------------------------------------------------------------------------
// outputs
// ---------------------------------------------------------------------------
function encodeWav(samples) {
  const header = Buffer.alloc(44);
  const dataBytes = samples.length * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  const body = Buffer.alloc(dataBytes);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    body.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }
  return Buffer.concat([header, body]);
}

function computePeaks(samples, buckets = PEAK_BUCKETS) {
  const perBucket = Math.floor(samples.length / buckets);
  const peaks = [];
  for (let b = 0; b < buckets; b += 1) {
    let max = 0;
    const start = b * perBucket;
    const end = b === buckets - 1 ? samples.length : start + perBucket;
    for (let i = start; i < end; i += 1) max = Math.max(max, Math.abs(samples[i]));
    peaks.push(Number(max.toFixed(3)));
  }
  return peaks;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function describeKey(spec) {
  const pitchClass = ((spec.rootMidi % 12) + 12) % 12;
  const third = spec.progression[0].includes(3) ? 'minor' : 'major';
  return `${NOTE_NAMES[pitchClass]} ${third}`;
}

function escapeXml(value) {
  return value.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
}

function coverSvg(spec, peaks) {
  const [from, to] = spec.colors;
  const bars = peaks
    .filter((_, i) => i % 3 === 0)
    .map((p, i) => {
      const h = Math.max(4, p * 46);
      const x = 40 + i * 9;
      return `<rect x="${x}" y="${196 - h / 2}" width="5" height="${h.toFixed(1)}" rx="2.5" fill="rgba(255,255,255,0.55)"/>`;
    })
    .join('');
  const motif =
    spec.motif === 'rings'
      ? `<g fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="2">${[70, 110, 150, 190]
          .map((r) => `<circle cx="440" cy="120" r="${r}"/>`)
          .join('')}</g>`
      : spec.motif === 'grid'
        ? `<g stroke="rgba(255,255,255,0.14)" stroke-width="1.5">${Array.from({ length: 7 }, (_, i) => `<line x1="${300 + i * 26}" y1="0" x2="${220 + i * 26}" y2="240"/>`).join('')}</g>`
        : `<g fill="rgba(255,255,255,0.12)">${Array.from({ length: 5 }, (_, i) => `<circle cx="${330 + i * 34}" cy="${60 + (i % 2) * 46}" r="${16 + i * 3}"/>`).join('')}</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 240" width="600" height="240" role="img" aria-label="${escapeXml(spec.title)} cover art">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="600" height="240" fill="url(#bg)"/>
  ${motif}
  <g opacity="0.85">${bars}</g>
  <text x="40" y="82" font-family="Inter, Segoe UI, sans-serif" font-size="34" font-weight="700" fill="#ffffff">${escapeXml(spec.title)}</text>
  <text x="40" y="112" font-family="Inter, Segoe UI, sans-serif" font-size="17" fill="rgba(255,255,255,0.82)">${escapeXml(spec.artist)} — ${escapeXml(spec.album)}</text>
  <text x="40" y="228" font-family="Inter, Segoe UI, sans-serif" font-size="13" letter-spacing="3" fill="rgba(255,255,255,0.6)">CADENZA SAMPLE LIBRARY</text>
</svg>
`;
}

// ---------------------------------------------------------------------------
// the library
// ---------------------------------------------------------------------------
const TRACKS = [
  {
    slug: 'midnight-circuit',
    title: 'Midnight Circuit',
    artist: 'Kite Ensemble',
    album: 'Night Voltage',
    bpm: 104,
    rootMidi: 45,
    progression: [[0, 3, 7, 10], [5, 8, 12, 15], [-4, 0, 3, 7], [7, 10, 14, 17]],
    padWave: 'saw',
    padCutoff: 2100,
    arpPattern: [0, 2, 1, 3, 2, 4, 1, 3],
    bassPattern: [0, null, 0, null, 7, null, 0, null],
    drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
    durationSec: 22,
    seed: 101,
    colors: ['#1b2a6b', '#5b2a86'],
    motif: 'rings',
  },
  {
    slug: 'paper-lanterns',
    title: 'Paper Lanterns',
    artist: 'Kite Ensemble',
    album: 'Night Voltage',
    bpm: 88,
    rootMidi: 48,
    progression: [[0, 4, 7, 11], [-3, 2, 5, 9], [-5, 0, 4, 7], [2, 5, 9, 12]],
    padWave: 'triangle',
    padCutoff: 2600,
    padGain: 0.13,
    arpPattern: [0, 1, 2, 3, 3, 2, 1, 0],
    bassPattern: [0, null, 0, null, 0, null, -5, null],
    drums: { kick: 'x.......x.......', snare: '....x.......x...', hat: '..x...x...x...x.' },
    durationSec: 22,
    seed: 202,
    colors: ['#8c3b1e', '#d97b2a'],
    motif: 'grid',
  },
  {
    slug: 'neon-rain',
    title: 'Neon Rain',
    artist: 'Harbour Static',
    album: 'Low Tide Signals',
    bpm: 118,
    rootMidi: 43,
    progression: [[0, 3, 7], [3, 7, 10], [5, 8, 12], [7, 10, 14]],
    padWave: 'square',
    padCutoff: 1800,
    arpPattern: [0, 2, 4, 2, 1, 3, 5, 3],
    bassPattern: [0, 0, null, 0, 5, null, 0, null],
    drums: { kick: 'x...x...x...x...', snare: '....x.......x..x', hat: 'x.xxx.xxx.xxx.xx' },
    durationSec: 21,
    seed: 303,
    colors: ['#0f3d3e', '#2ec4b6'],
    motif: 'grid',
  },
  {
    slug: 'slow-orbit',
    title: 'Slow Orbit',
    artist: 'Harbour Static',
    album: 'Low Tide Signals',
    bpm: 92,
    rootMidi: 50,
    progression: [[0, 3, 7, 10], [-5, -1, 2, 7], [-3, 0, 4, 7], [2, 5, 9, 12]],
    padWave: 'saw',
    padCutoff: 1500,
    padGain: 0.14,
    arpPattern: [0, 3, 1, 4, 2, 5, 3, 6],
    bassPattern: [0, null, null, 0, null, null, -3, null],
    drums: { kick: 'x.......x.......', snare: '....x.......x...', hat: '..x...x...x...x.' },
    durationSec: 24,
    seed: 404,
    colors: ['#2b2d42', '#8d99ae'],
    motif: 'dots',
  },
  {
    slug: 'glass-harbor',
    title: 'Glass Harbor',
    artist: 'Ninth Avenue',
    album: 'Commuters',
    bpm: 100,
    rootMidi: 47,
    progression: [[0, 4, 7, 9], [5, 9, 12, 16], [7, 11, 14, 18], [2, 6, 9, 12]],
    padWave: 'triangle',
    padCutoff: 3000,
    arpPattern: [1, 2, 3, 5, 4, 3, 2, 1],
    bassPattern: [0, null, 5, null, 0, null, 7, null],
    drums: { kick: 'x..x....x..x....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
    durationSec: 22,
    seed: 505,
    colors: ['#123c69', '#a3d5ff'],
    motif: 'rings',
  },
  {
    slug: 'velvet-static',
    title: 'Velvet Static',
    artist: 'Ninth Avenue',
    album: 'Commuters',
    bpm: 124,
    rootMidi: 41,
    progression: [[0, 3, 7, 10], [5, 8, 12, 15], [7, 10, 14, 17], [3, 6, 10, 13]],
    padWave: 'saw',
    padCutoff: 2300,
    arpPattern: [0, 4, 1, 5, 2, 6, 3, 7],
    bassPattern: [0, null, 0, 0, null, 5, null, 7],
    drums: { kick: 'x...x...x..xx...', snare: '....x.......x..x', hat: 'x.x.x.x.x.x.x.x.' },
    durationSec: 21,
    seed: 606,
    colors: ['#4a0e2e', '#c1121f'],
    motif: 'grid',
  },
  {
    slug: 'aurora-drift',
    title: 'Aurora Drift',
    artist: 'Meridian Choir',
    album: 'Polar Bloom',
    bpm: 84,
    rootMidi: 52,
    progression: [[0, 4, 7, 12], [-5, -1, 2, 7], [-7, -3, 0, 5], [-2, 2, 5, 9]],
    padWave: 'sine',
    padCutoff: 3400,
    padGain: 0.16,
    arpPattern: [0, 2, 4, 6, 5, 3, 1, 0],
    bassPattern: [0, null, null, null, -5, null, null, null],
    drums: { kick: 'x.......x.......', snare: '........x.......', hat: '..x.....x.....x.' },
    durationSec: 24,
    seed: 707,
    colors: ['#0b132b', '#3a86ff'],
    motif: 'dots',
  },
  {
    slug: 'meridian-lights',
    title: 'Meridian Lights',
    artist: 'Meridian Choir',
    album: 'Polar Bloom',
    bpm: 110,
    rootMidi: 46,
    progression: [[0, 3, 7], [7, 10, 14], [-2, 2, 5], [3, 7, 10]],
    padWave: 'saw',
    padCutoff: 2500,
    arpPattern: [0, 1, 2, 4, 3, 2, 1, 4],
    bassPattern: [0, null, 0, null, 7, null, 3, null],
    drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.xxx.x.x.xxx.x.' },
    durationSec: 21,
    seed: 808,
    colors: ['#2a9d8f', '#264653'],
    motif: 'rings',
  },
];

async function main() {
  const tracksDir = path.join(MEDIA_DIR, 'tracks');
  const coversDir = path.join(MEDIA_DIR, 'covers');
  const peaksDir = path.join(MEDIA_DIR, 'peaks');
  const scratch = path.join(os.tmpdir(), `cadenza-media-${Date.now()}`);
  await Promise.all([
    mkdir(tracksDir, { recursive: true }),
    mkdir(coversDir, { recursive: true }),
    mkdir(peaksDir, { recursive: true }),
    mkdir(scratch, { recursive: true }),
  ]);

  const manifest = { generatedAt: new Date().toISOString(), sampleRate: SAMPLE_RATE, tracks: [] };
  let totalBytes = 0;

  for (const spec of TRACKS) {
    const started = Date.now();
    const samples = renderTrack(spec);
    const wavPath = path.join(scratch, `${spec.slug}.wav`);
    await writeFile(wavPath, encodeWav(samples));
    const mp3Path = path.join(tracksDir, `${spec.slug}.mp3`);
    await execFileAsync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      wavPath,
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '96k',
      '-ar',
      String(SAMPLE_RATE),
      '-ac',
      '1',
      mp3Path,
    ]);

    const peaks = computePeaks(samples);
    await writeFile(path.join(peaksDir, `${spec.slug}.json`), `${JSON.stringify(peaks)}\n`);
    await writeFile(path.join(coversDir, `${spec.slug}.svg`), coverSvg(spec, peaks));

    const { size } = await stat(mp3Path);
    totalBytes += size;
    manifest.tracks.push({
      slug: spec.slug,
      title: spec.title,
      artist: spec.artist,
      album: spec.album,
      bpm: spec.bpm,
      key: describeKey(spec),
      durationMs: Math.round(spec.durationSec * 1000),
      audioFile: `tracks/${spec.slug}.mp3`,
      coverFile: `covers/${spec.slug}.svg`,
      peaksFile: `peaks/${spec.slug}.json`,
      peaks,
      bytes: size,
    });
    console.log(
      `[generate-media] ${spec.slug.padEnd(18)} ${spec.durationSec}s  ${(size / 1024).toFixed(0)} KB  ` +
        `${describeKey(spec)}  ${spec.bpm} BPM  (${Date.now() - started} ms)`,
    );
  }

  await writeFile(path.join(MEDIA_DIR, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await rm(scratch, { recursive: true, force: true });
  console.log(
    `[generate-media] ${manifest.tracks.length} tracks, ${(totalBytes / 1024 / 1024).toFixed(2)} MB of MP3, ` +
      `manifest written to media/MANIFEST.json`,
  );
}

await main();
