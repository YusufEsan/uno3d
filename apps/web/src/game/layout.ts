import * as THREE from 'three';

// Dünya ölçüleri (metre). Masa merkezi orijinde, senin koltuğun +Z yönünde.
export const TABLE_Y = 0.78;
export const TABLE_R = 0.95;
export const SEAT_R = 1.52;
export const EYE_HEIGHT = 1.26;
export const CARD_W = 0.1;
export const CARD_H = 0.15;

// deste ve atılan yığın masanın tam ortasında, birbirine simetrik
export const DECK_POS = new THREE.Vector3(-0.21, TABLE_Y, 0);
// atılan yığın tam masanın ortasında
export const PILE_POS = new THREE.Vector3(0, TABLE_Y, 0);

/** Oyuncu sayısına göre koltuk açıları; 0 = sen (güney). Oyun sırası saat yönünde: batı → kuzey → doğu */
export function seatAngles(n: number): number[] {
  if (n <= 1) return [0];
  if (n === 2) return [0, Math.PI];
  if (n === 3) return [0, (-2 * Math.PI) / 3, (2 * Math.PI) / 3];
  return [0, -Math.PI / 2, Math.PI, Math.PI / 2];
}

/** Listeyi seni başa alacak şekilde döndürür (sıra korunur) */
export function relativeOrder(ids: string[], you: string | null): string[] {
  const i = you ? ids.indexOf(you) : -1;
  return i < 0 ? ids : [...ids.slice(i), ...ids.slice(0, i)];
}

export interface Frame {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale?: number;
}

const dummy = new THREE.Object3D();

/** Koltuk çerçevesi: zemin seviyesinde, +Z ekseni masanın merkezine bakar */
export function seatFrame(index: number, n: number): Frame {
  const a = seatAngles(n)[index] ?? 0;
  dummy.position.set(Math.sin(a) * SEAT_R, 0, Math.cos(a) * SEAT_R);
  dummy.lookAt(0, 0, 0);
  return { pos: dummy.position.clone(), quat: dummy.quaternion.clone() };
}

export function seatAngle(index: number, n: number) {
  return seatAngles(n)[index] ?? 0;
}

export function cameraBase(): THREE.Vector3 {
  return new THREE.Vector3(0, EYE_HEIGHT, SEAT_R + 0.02);
}

const tmpM = new THREE.Matrix4();
const tmpM2 = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);

function compose(frame: THREE.Matrix4, lx: number, ly: number, lz: number, local: THREE.Quaternion): Frame {
  tmpM2.compose(new THREE.Vector3(lx, ly, lz), local, ONE);
  const world = tmpM.multiplyMatrices(frame, tmpM2);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  world.decompose(pos, quat, new THREE.Vector3());
  return { pos, quat };
}

/** Senin elinin çerçevesi: kameranın önünde, masanın kenarı üstünde, kameraya dönük (etrafa bakarken yerinde kalır) */
function myHandFrame(): THREE.Matrix4 {
  const pos = new THREE.Vector3(0, 0.98, SEAT_R - 0.5);
  dummy.position.copy(pos);
  dummy.lookAt(cameraBase());
  return new THREE.Matrix4().compose(pos, dummy.quaternion, ONE);
}

/**
 * Elindeki i. kartın konumu. Yelpaze, kart sayısına göre açılır.
 * index 0 = sen, diğerleri rakip koltukları.
 */
export function handSlot(seatIndex: number, n: number, i: number, count: number): Frame {
  const me = seatIndex === 0;
  const R = me ? 0.42 : 0.32;
  let step = me ? 8 : 7;
  if (count > 1) step = Math.min(step, (me ? 70 : 54) / (count - 1));
  const a = THREE.MathUtils.degToRad((i - (count - 1) / 2) * step);
  const lx = Math.sin(a) * R;
  const ly = Math.cos(a) * R - R;
  const local = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, me ? 0 : Math.PI, -a * (me ? 1 : -1)));

  if (me) return compose(myHandFrame(), lx, ly, i * 0.0012, local);

  const seat = seatFrame(seatIndex, n);
  const frame = new THREE.Matrix4().compose(seat.pos, seat.quat, ONE);
  // rakibin göğsünün önünde, kartların ön yüzü rakibe dönük (sen arkalarını görürsün)
  return compose(frame, -lx, 1.02 + ly, 0.36 - i * 0.0012, local);
}

/** Karakterin elindeki tutma noktasına göre yelpaze: kartların ön yüzü karaktere dönük */
export function anchoredHandSlot(anchor: THREE.Object3D, i: number, count: number): Frame {
  // oyuncunun yelpazesiyle aynı yay: kartlar kendi ekseninde açılır, ortası karaktere yakın kalır
  const R = 0.34;
  let step = 7;
  if (count > 1) step = Math.min(step, 60 / (count - 1));
  const a = THREE.MathUtils.degToRad((i - (count - 1) / 2) * step);
  const lx = Math.sin(a) * R;
  const ly = Math.cos(a) * R - R;
  // ön yüz karaktere dönük (yaw π), yelpaze roll ile açılır
  const local = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, -a));
  anchor.updateWorldMatrix(true, false);
  return { ...compose(anchor.matrixWorld, -lx, ly, -i * 0.0012, local), scale: 1 };
}

/** Atılan yığındaki kartın konumu: id'den türetilen sabit, rastgele görünen açı/kayma */
export function pileSlot(cardId: string, index: number): Frame {
  let h = 0;
  for (let i = 0; i < cardId.length; i++) h = (h * 31 + cardId.charCodeAt(i)) | 0;
  const r1 = ((h & 0xff) / 255) * 2 - 1;
  const r2 = (((h >> 8) & 0xff) / 255) * 2 - 1;
  const r3 = (((h >> 16) & 0xff) / 255) * 2 - 1;
  const pos = new THREE.Vector3(PILE_POS.x + r2 * 0.012, TABLE_Y + 0.0012 + Math.min(index, 40) * 0.0011, PILE_POS.z + r3 * 0.012);
  return { pos, quat: faceUp(r1 * 0.45) };
}

export function faceUp(spin = 0) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, spin));
}

export function faceDown(spin = 0) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, spin));
}

/** Rakibin başının üstü (yazı efektleri için); sen için masanın önü */
export function headPos(seatIndex: number, n: number): THREE.Vector3 {
  if (seatIndex === 0) return new THREE.Vector3(0, 1.08, SEAT_R - 0.75);
  const seat = seatFrame(seatIndex, n);
  return seat.pos.clone().add(new THREE.Vector3(0, 1.85, 0));
}

/** Masa üzerinde, oyuncunun önüne düşen nokta (sıra göstergesi için) */
export function tableEdgeAngle(seatIndex: number, n: number) {
  return seatAngle(seatIndex, n);
}
