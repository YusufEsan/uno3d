import * as THREE from 'three';
import type { Card } from '@uno/engine';
import { COLOR_HEX } from '../config';
import { CARD_H, CARD_W } from './layout';

const W = 256;
const H = 384;
const cache = new Map<string, THREE.CanvasTexture>();

const SYMBOL: Record<string, string> = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: '', wild4: '+4' };

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeTexture(draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  roundRect(ctx, 0, 0, W, H, 26);
  ctx.fill();
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function oval(ctx: CanvasRenderingContext2D, fill: string | CanvasGradient) {
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-0.5);
  ctx.scale(1, 1.55);
  ctx.beginPath();
  ctx.arc(0, 0, 92, 0, Math.PI * 2);
  ctx.restore();
  ctx.fillStyle = fill;
  ctx.fill();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, rotate = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotate);
  ctx.font = `900 ${size}px Rubik, "Segoe UI Symbol", "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.12;
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  ctx.fillText(text, size * 0.05, size * 0.06);
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export function faceTexture(card: Card): THREE.CanvasTexture {
  const key = `${card.color}-${card.value}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const tex = makeTexture(ctx => {
    const wild = card.color === 'wild';
    const main = wild ? '#151515' : COLOR_HEX[card.color as keyof typeof COLOR_HEX];
    ctx.fillStyle = main;
    roundRect(ctx, 14, 14, W - 28, H - 28, 18);
    ctx.fill();
    ctx.save();
    roundRect(ctx, 14, 14, W - 28, H - 28, 18);
    ctx.clip();
    if (wild) {
      const g = ctx.createConicGradient(0, W / 2, H / 2);
      g.addColorStop(0, COLOR_HEX.red);
      g.addColorStop(0.2499, COLOR_HEX.red);
      g.addColorStop(0.25, COLOR_HEX.blue);
      g.addColorStop(0.4999, COLOR_HEX.blue);
      g.addColorStop(0.5, COLOR_HEX.yellow);
      g.addColorStop(0.7499, COLOR_HEX.yellow);
      g.addColorStop(0.75, COLOR_HEX.green);
      g.addColorStop(1, COLOR_HEX.green);
      oval(ctx, g);
    } else {
      oval(ctx, '#fff');
    }
    ctx.restore();
    const text = SYMBOL[card.value] ?? card.value;
    const corner = text || '★';
    if (text) label(ctx, text, W / 2, H / 2, text.length > 1 ? 120 : 150, wild ? '#fff' : main);
    label(ctx, corner, 46, 50, 44, '#fff');
    label(ctx, corner, W - 46, H - 50, 44, '#fff', Math.PI);
  });
  cache.set(key, tex);
  return tex;
}

let back: THREE.CanvasTexture | null = null;
export function backTexture(): THREE.CanvasTexture {
  back ??= makeTexture(ctx => {
    ctx.fillStyle = '#151515';
    roundRect(ctx, 14, 14, W - 28, H - 28, 18);
    ctx.fill();
    ctx.save();
    roundRect(ctx, 14, 14, W - 28, H - 28, 18);
    ctx.clip();
    oval(ctx, '#d42a26');
    ctx.restore();
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-0.5);
    label(ctx, 'UNO', 0, 0, 78, '#f5c400');
    ctx.restore();
  });
  return back;
}

/** Köşeleri yuvarlatılmış kart yüzeyi; UV'ler 0..1 aralığına oturtulur */
export function createCardGeometry(): THREE.ShapeGeometry {
  const w = CARD_W;
  const h = CARD_H;
  const r = 0.01;
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const geo = new THREE.ShapeGeometry(s, 6);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h);
  uv.needsUpdate = true;
  return geo;
}
