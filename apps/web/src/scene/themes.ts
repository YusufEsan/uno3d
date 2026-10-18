import type { ThemeId } from '@uno/protocol';
import type { Surface } from './textures';

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
  /** bar / neon: kapalı oda; diğerleri açık havada geçen, etrafı görülen atmosferler */
  props: 'bar' | 'neon' | 'clouds' | 'plane' | 'balloon' | 'bus' | 'boat';
  /** açık hava: gökyüzü renkleri (tepe, ufuk, alt) ve güneş */
  sky?: { top: string; horizon: string; bottom: string };
  /** açık hava: gerçek gökyüzü panoraması (Poly Haven, CC0); güneş yönü panoramadaki güneşe göre ayarlıdır */
  skyMap?: SkyName;
  sun?: { color: string; intensity: number; position: [number, number, number] };
  /** kapalı odada tavandan sarkan aydınlatma: fenerli avize, kristal avize ya da sade abajur */
  fixture?: 'lantern' | 'chandelier' | 'shade';
  /** kapalı odada zemin ve duvar dokuları (Poly Haven, CC0) */
  surfaces?: { floor: Surface; wall: Surface };
  /** ortam yansımalarının gücü (kapalı ve loş odalarda düşük) */
  envIntensity?: number;
}

export type SkyName = 'kloofendal_43d_clear_puresky' | 'kloofendal_48d_partly_cloudy_puresky' | 'qwantani_afternoon_puresky' | 'qwantani_sunset_puresky';

/** kapalı odalarda tavandan sarkan lamba; açık havada güneş kullanılır */
export const isOutdoor = (t: Theme) => !!t.sky;

export const THEMES: Record<ThemeId, Theme> = {
  meyhane: {
    background: '#0b0806',
    fog: ['#0b0806', 6, 14],
    ambient: ['#ffcf9a', 0.32],
    hemi: ['#ffcf9a', '#3a2414', 0.6],
    lamp: { color: '#ffb466', intensity: 22, swing: 0.06 },
    wall: '#4a2e1e',
    floor: '#2b1c12',
    wood: '#5b3420',
    felt: '#1f5a3a',
    rim: '#3d2214',
    dust: '#ffcf9a',
    bloom: 0.35,
    props: 'bar',
    fixture: 'lantern',
    surfaces: {
      floor: { tex: 'wood_floor_worn', repeat: [6, 6], tint: '#c9a684', roughness: 0.8 },
      wall: { tex: 'dark_brick_wall', repeat: [5, 3], tint: '#caa996', roughness: 0.95 },
    },
    envIntensity: 0.14,
  },
  neon: {
    background: '#07040f',
    fog: ['#0b0618', 6, 14],
    ambient: ['#8a6bff', 0.32],
    hemi: ['#5ad1ff', '#2a0f40', 0.6],
    lamp: { color: '#d6c8ff', intensity: 18, swing: 0.02 },
    wall: '#120b22',
    floor: '#0d0a16',
    wood: '#1b1530',
    felt: '#3a1a5c',
    rim: '#ff3dc8',
    dust: '#7fe8ff',
    bloom: 0.8,
    props: 'neon',
    surfaces: {
      floor: { tex: 'concrete_floor_02', repeat: [4, 4], tint: '#6d6694', roughness: 0.35, metalness: 0.2 },
      wall: { tex: 'concrete_wall_008', repeat: [4, 2.5], tint: '#7a68b0', roughness: 0.9 },
    },
    envIntensity: 0.3,
  },
  casino: {
    background: '#050a07',
    fog: ['#06100b', 6, 14],
    ambient: ['#fff1c9', 0.34],
    hemi: ['#fff1c9', '#183a26', 0.6],
    lamp: { color: '#ffe2a0', intensity: 20, swing: 0.03 },
    wall: '#0f1d15',
    floor: '#0b150f',
    wood: '#3a2a14',
    felt: '#0f4a2e',
    rim: '#c9a13b',
    dust: '#ffe9a8',
    bloom: 0.4,
    props: 'bar',
    fixture: 'chandelier',
    surfaces: {
      floor: { tex: 'herringbone_parquet', repeat: [5, 5], tint: '#d9c2a2', roughness: 0.55 },
      wall: { tex: 'quatrefoil_jacquard_fabric', repeat: [7, 4], tint: '#e6cfc8', roughness: 0.85 },
    },
    envIntensity: 0.3,
  },
  ocean: {
    background: '#02070d',
    fog: ['#041320', 6, 14],
    ambient: ['#7fd4ff', 0.3],
    hemi: ['#7fd4ff', '#0a2a44', 0.6],
    lamp: { color: '#9ee8ff', intensity: 18, swing: 0.04 },
    wall: '#0a1a2a',
    floor: '#081523',
    wood: '#1d3146',
    felt: '#12365a',
    rim: '#36e0ff',
    dust: '#9ee8ff',
    bloom: 0.7,
    props: 'neon',
    surfaces: {
      floor: { tex: 'concrete_floor_02', repeat: [4, 4], tint: '#5d7d9e', roughness: 0.4, metalness: 0.15 },
      wall: { tex: 'plastered_wall_02', repeat: [4, 2.5], tint: '#45698f', roughness: 0.9 },
    },
    envIntensity: 0.3,
  },
  desert: {
    background: '#100704',
    fog: ['#1a0b06', 6, 14],
    ambient: ['#ffb07a', 0.32],
    hemi: ['#ffb07a', '#3a1a0c', 0.6],
    lamp: { color: '#ff9a52', intensity: 22, swing: 0.05 },
    wall: '#2c140c',
    floor: '#24100a',
    wood: '#6b3a22',
    felt: '#6a1c26',
    rim: '#e0813a',
    dust: '#ffb07a',
    bloom: 0.4,
    props: 'bar',
    fixture: 'lantern',
    surfaces: {
      floor: { tex: 'wood_floor_worn', repeat: [6, 6], tint: '#d3a27e', roughness: 0.8 },
      wall: { tex: 'plastered_wall_02', repeat: [4, 2.5], tint: '#d99a78', roughness: 0.95 },
    },
    envIntensity: 0.18,
  },
  clouds: {
    background: '#8fc8f2',
    fog: ['#c8d3e3', 20, 56],
    ambient: ['#fff6e8', 0.55],
    hemi: ['#bfe2ff', '#ffffff', 0.9],
    lamp: { color: '#fff1c9', intensity: 0, swing: 0 },
    wall: '#79b9ec',
    floor: '#f4f8ff',
    wood: '#e9dcc6',
    felt: '#2a7a9a',
    rim: '#f2c46b',
    dust: '#ffffff',
    bloom: 0.45,
    props: 'clouds',
    sky: { top: '#3f8fe0', horizon: '#d8ecfb', bottom: '#ffffff' },
    sun: { color: '#fff0d2', intensity: 2.6, position: [6.4, 8.9, 4.8] },
    skyMap: 'kloofendal_48d_partly_cloudy_puresky',
    envIntensity: 0.8,
  },
  plane: {
    background: '#5aa0e6',
    fog: ['#b7c0cb', 22, 58],
    ambient: ['#ffffff', 0.5],
    hemi: ['#a9d4ff', '#dfe8f0', 0.8],
    lamp: { color: '#ffffff', intensity: 0, swing: 0 },
    wall: '#4e93dc',
    floor: '#c9d1da',
    wood: '#8b97a5',
    felt: '#1d4f86',
    rim: '#e8edf2',
    dust: '#ffffff',
    bloom: 0.4,
    props: 'plane',
    sky: { top: '#1f63c6', horizon: '#bfe0fa', bottom: '#eef6fd' },
    sun: { color: '#ffffff', intensity: 2.8, position: [7.7, 7.7, 5.2] },
    skyMap: 'kloofendal_43d_clear_puresky',
    envIntensity: 0.8,
  },
  balloon: {
    background: '#f7c9a0',
    fog: ['#f6d6b8', 22, 58],
    ambient: ['#ffe9d2', 0.5],
    hemi: ['#ffd8b0', '#7f9a62', 0.75],
    lamp: { color: '#ffb466', intensity: 0, swing: 0 },
    wall: '#f0a878',
    floor: '#a87a48',
    wood: '#8a5a32',
    felt: '#2f6b3f',
    rim: '#d9a35a',
    dust: '#fff0dc',
    bloom: 0.5,
    props: 'balloon',
    sky: { top: '#6f9fd8', horizon: '#ffd2a8', bottom: '#e9b38a' },
    sun: { color: '#ffd8a8', intensity: 2.4, position: [7, 5, -6] },
    envIntensity: 0.6,
  },
  bus: {
    background: '#9fd0f5',
    fog: ['#c9ccd2', 26, 58],
    ambient: ['#ffffff', 0.5],
    hemi: ['#cfe9ff', '#5d6a5a', 0.7],
    lamp: { color: '#fff4dc', intensity: 0, swing: 0 },
    wall: '#8cc6f0',
    floor: '#3b4450',
    wood: '#5a4636',
    felt: '#8a2a2a',
    rim: '#f2b632',
    dust: '#ffffff',
    bloom: 0.4,
    props: 'bus',
    sky: { top: '#4a95dc', horizon: '#dff0fb', bottom: '#cfe3c9' },
    sun: { color: '#fff3dc', intensity: 2.4, position: [7.3, 7.9, 5.3] },
    skyMap: 'qwantani_afternoon_puresky',
    envIntensity: 0.8,
  },
  boat: {
    background: '#f2a77a',
    fog: ['#c9b8a2', 24, 58],
    ambient: ['#ffe2c8', 0.5],
    hemi: ['#ffcfa6', '#2b5a78', 0.75],
    lamp: { color: '#ffb070', intensity: 0, swing: 0 },
    wall: '#e98d6a',
    floor: '#2d6f93',
    wood: '#7a4a2a',
    felt: '#1f5a6a',
    rim: '#c98a4a',
    dust: '#fff0dc',
    bloom: 0.55,
    props: 'boat',
    sky: { top: '#5b6fb8', horizon: '#ffb987', bottom: '#f5c4a0' },
    // panoramadaki güneş ufukta (3.6°); ışık masayı aydınlatsın diye aynı yönden biraz daha yüksekten gelir
    sun: { color: '#ffb877', intensity: 2.6, position: [9.6, 2.5, 6.8] },
    skyMap: 'qwantani_sunset_puresky',
    envIntensity: 0.8,
  },
};
