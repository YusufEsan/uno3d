import type { ThemeId } from '@uno/protocol';

export interface Theme {
  background: string;
  fog: [string, number, number];
  ambient: [string, number];
  hemi: [string, string, number];
  lamp: { color: string; intensity: number; swing: number };
  wall: string;
  floor: string;
  wood: string;
  felt: string;
  rim: string;
  dust: string;
  bloom: number;
  props: 'bar' | 'neon';
}

export const THEMES: Record<ThemeId, Theme> = {
  meyhane: {
    background: '#0b0806',
    fog: ['#0b0806', 3.2, 9],
    ambient: ['#ffcf9a', 0.18],
    hemi: ['#ffcf9a', '#1a0f08', 0.25],
    lamp: { color: '#ffb466', intensity: 22, swing: 0.06 },
    wall: '#2a1a12',
    floor: '#2b1c12',
    wood: '#5b3420',
    felt: '#1f5a3a',
    rim: '#3d2214',
    dust: '#ffcf9a',
    bloom: 0.35,
    props: 'bar',
  },
  neon: {
    background: '#07040f',
    fog: ['#0b0618', 3, 9],
    ambient: ['#8a6bff', 0.2],
    hemi: ['#5ad1ff', '#12041f', 0.3],
    lamp: { color: '#d6c8ff', intensity: 18, swing: 0.02 },
    wall: '#120b22',
    floor: '#0d0a16',
    wood: '#1b1530',
    felt: '#3a1a5c',
    rim: '#ff3dc8',
    dust: '#7fe8ff',
    bloom: 0.8,
    props: 'neon',
  },
  casino: {
    background: '#050a07',
    fog: ['#06100b', 3.2, 9],
    ambient: ['#fff1c9', 0.2],
    hemi: ['#fff1c9', '#07100b', 0.3],
    lamp: { color: '#ffe2a0', intensity: 20, swing: 0.03 },
    wall: '#0f1d15',
    floor: '#0b150f',
    wood: '#3a2a14',
    felt: '#0f4a2e',
    rim: '#c9a13b',
    dust: '#ffe9a8',
    bloom: 0.4,
    props: 'bar',
  },
  ocean: {
    background: '#02070d',
    fog: ['#041320', 3, 10],
    ambient: ['#7fd4ff', 0.18],
    hemi: ['#7fd4ff', '#03101c', 0.3],
    lamp: { color: '#9ee8ff', intensity: 18, swing: 0.04 },
    wall: '#0a1a2a',
    floor: '#081523',
    wood: '#1d3146',
    felt: '#12365a',
    rim: '#36e0ff',
    dust: '#9ee8ff',
    bloom: 0.7,
    props: 'neon',
  },
  desert: {
    background: '#100704',
    fog: ['#1a0b06', 3.2, 9],
    ambient: ['#ffb07a', 0.18],
    hemi: ['#ffb07a', '#1a0a05', 0.25],
    lamp: { color: '#ff9a52', intensity: 22, swing: 0.05 },
    wall: '#2c140c',
    floor: '#24100a',
    wood: '#6b3a22',
    felt: '#6a1c26',
    rim: '#e0813a',
    dust: '#ffb07a',
    bloom: 0.4,
    props: 'bar',
  },
};
