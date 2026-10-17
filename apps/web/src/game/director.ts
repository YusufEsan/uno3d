import * as THREE from 'three';
import gsap from 'gsap';
import { COLORS, type Card, type Color, type GameEvent, type PlayerView } from '@uno/engine';
import { COLOR_HEX, COLOR_NAME } from '../config';
import { useApp } from '../store/useApp';
import { backTexture, createCardGeometry, faceTexture } from './cardTextures';
import { Fx } from './fx';
import {
  CARD_H,
  CARD_W,
  DECK_POS,
  PILE_POS,
  TABLE_R,
  TABLE_Y,
  anchoredHandSlot,
  faceDown,
  faceUp,
  seatFrame,
  handSlot,
  headPos,
  pileSlot,
  relativeOrder,
  seatAngle,
  type Frame,
} from './layout';
import { sfx } from './sfx';

/**
 * Kart katmanları: root (konum — GSAP) > inner (hover — her karede) > ön/arka yüz.
 * Aynı özelliği iki sistem asla birlikte değiştirmez.
 */
interface Ent {
  root: THREE.Group;
  inner: THREE.Group;
  front: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  card: Card | null;
  tween: gsap.core.Tween | null;
  hover: number;
  spread: number;
  /** Oynanabilir kart: yelpazeden hafifçe yukarı kalkar */
  playable: boolean;
  lift: number;
  /** 0 = tam parlak, 1 = biraz sönük (renk aynı kalır) */
  fade: { value: number };
  /** Atış sırasında kartın takip ettiği el */
  follow: Thrower | null;
  /** fare algılama: kartın yelpazedeki dinlenme yeri (kart kalkıp büyüse de yerinde kalır) */
  pick: THREE.Mesh;
  /** seçili kartın kalkmış ve büyümüş hâlini de kapsayan alan */
  hit: THREE.Mesh;
}

/** Karakterin kart atma hareketi: Avatar sağlar, yönetici kartı eline göre uçurur */
export interface Thrower {
  /** Atışı başlatır; kartın elden çıkacağı anda çözülür */
  throw(): Promise<void>;
  handPosition(out: THREE.Vector3): THREE.Vector3;
}

interface Packet {
  events: GameEvent[];
  view: PlayerView;
}

const GEO = createCardGeometry();
// kartın kalkıp büyüdüğü hâli de kapsayan, görünmez algılama alanı (yukarı doğru uzatılmış)
const HIT_GEO = new THREE.PlaneGeometry(CARD_W * 1.18, CARD_H * 1.16 + 0.09).translate(0, 0.045, 0);
const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
/**
 * Kart yüzü ışığın bir kısmını kendisi verir: lamba altında düz duran kartlar beyaza kaçıp solmasın,
 * gölgede de renkleri canlı kalsın. LIT ışıkla aydınlanan pay, GLOW kendi parlaklığı.
 */
const CARD_LIT = 0.6;
const CARD_GLOW = 0.32;
const PICK_GEO = new THREE.PlaneGeometry(CARD_W, CARD_H);
let backMat: THREE.MeshStandardMaterial | null = null;

/** Kart malzemesine "sönüklük" ekler: renkler korunur, kart biraz daha az parlak görünür (oynanamayan kartlar için) */
function addFade(mat: THREE.MeshStandardMaterial, fade: { value: number }) {
  mat.onBeforeCompile = shader => {
    shader.uniforms.uFade = fade;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFade;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        diffuseColor.rgb *= 1.0 - uFade * 0.28;`,
      );
  };
  mat.customProgramCacheKey = () => 'card-fade';
}
const wait = (s: number) => new Promise<void>(r => gsap.delayedCall(s, r));
const cardColor = (c: Card) => (c.color === 'wild' ? '#ffffff' : COLOR_HEX[c.color]);
const isAction = (c: Card) => Number.isNaN(Number(c.value));

export class TableDirector {
  root = new THREE.Group();
  shake = 0;
  onCardClick: (card: Card) => void = () => {};
  /** izleme modunda kendi elini gizler */
  hideOwnHand = false;
  onDeckClick: () => void = () => {};

  private cards = new THREE.Group();
  private fx = new Fx();
  private hands = new Map<string, Ent[]>();
  private pile: Ent[] = [];
  private players: string[] = [];
  private you = '';
  private drawCount = 0;
  private direction: 1 | -1 = 1;
  private current = '';
  private queue: Packet[] = [];
  private running = false;
  private view: PlayerView | null = null;
  /** Rakiplerin kartları karakterin elindeki bu noktaya bağlanır */
  private anchors = new Map<string, THREE.Object3D>();
  private throwers = new Map<string, Thrower>();
  /** Atış sırasında ele bağlı kartlar */
  private following = new Set<Ent>();
  /** Oyun sonunda açılan rakip kartları elden bağımsız kalır */
  private revealed = false;

  private deck: THREE.Mesh;
  private deckMat: THREE.MeshStandardMaterial;
  private ring = new THREE.Group();
  private arrows = new THREE.Group();
  private ringMat: THREE.MeshStandardMaterial;
  private glow: THREE.Mesh;
  private marker: THREE.Mesh;
  /** Atacak kart yokken destenin etrafında atan halka */
  private deckRing: THREE.Mesh;
  private mustDraw = false;
  private deckLift = 0;
  private markerAngle = { a: 0 };
  colorLight = new THREE.PointLight('#ffffff', 0, 2.4, 1.6);

  private raycaster = new THREE.Raycaster();
  private hovered: Ent | null = null;
  /** bir önceki karede üzerinde durulan kart */
  private lastHovered: Ent | null = null;
  /** fare kendi kartlarından birinin üstünde mi (kamera odaklanması için) */
  get hoveringHand() {
    return !!this.hovered;
  }
  private deckHovered = false;

  constructor() {
    this.root.add(this.cards, this.fx.group, this.ring, this.colorLight);
    // renk ışığı yığının tam üstünde değil, yukarıda ve yanda: kart yüzünde parlama yapmaz
    this.colorLight.position.set(PILE_POS.x + 0.35, TABLE_Y + 0.8, PILE_POS.z + 0.3);

    // deste: kart sayısına göre yükselen blok
    this.deckMat = new THREE.MeshStandardMaterial({ map: backTexture(), roughness: 0.6, emissive: '#ffffff', emissiveIntensity: 0, emissiveMap: backTexture() });
    const side = new THREE.MeshStandardMaterial({ color: '#e9e4d8', roughness: 0.9 });
    this.deck = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, 1, CARD_H), [side, side, this.deckMat, side, side, side]);
    this.deck.castShadow = true;
    this.deck.receiveShadow = true;
    this.root.add(this.deck);

    // yön halkası ve okları
    this.ringMat = new THREE.MeshStandardMaterial({ color: '#222', emissive: '#ffffff', emissiveIntensity: 0.25, roughness: 0.6 });
    const torus = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.006, 8, 96), this.ringMat);
    torus.rotation.x = Math.PI / 2;
    this.ring.add(torus, this.arrows);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.06, 12), this.ringMat);
      cone.position.set(Math.sin(a) * 0.34, 0, Math.cos(a) * 0.34);
      // koni teğet yönünde, oyun yönüne (saat yönü = negatif açı) bakar
      cone.rotation.set(0, a, Math.PI / 2);
      this.arrows.add(cone);
    }
    this.ring.position.set(0, TABLE_Y + 0.006, 0.02);

    // atılan yığının altında renk parıltısı
    this.glow = new THREE.Mesh(
      new THREE.CircleGeometry(0.2, 48),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.set(PILE_POS.x, TABLE_Y + 0.0008, PILE_POS.z);
    this.root.add(this.glow);

    // sıra göstergesi
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.05, 0.075, 48),
      new THREE.MeshBasicMaterial({ color: '#fff6c8', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.root.add(this.marker);

    this.deckRing = new THREE.Mesh(
      new THREE.RingGeometry(0.11, 0.13, 48),
      new THREE.MeshBasicMaterial({ color: '#ffd54a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.deckRing.rotation.x = -Math.PI / 2;
    this.deckRing.position.set(DECK_POS.x, TABLE_Y + 0.002, DECK_POS.z);
    this.root.add(this.deckRing);

    this.updateDeck();
  }

  // ================== dış arayüz ==================

  enqueue(events: GameEvent[], view: PlayerView) {
    this.queue.push({ events, view });
    if (!this.running) void this.run();
  }

  /** Animasyonsuz, görünümden anında kurulum (yeniden bağlanma / senkron) */
  reset(view: PlayerView) {
    this.queue = [];
    this.clearAll();
    this.revealed = view.phase === 'ended';
    this.players = view.players.map(p => p.id);
    this.you = view.you;
    for (const p of view.players) {
      const ents = p.id === this.you ? view.hand.map(c => this.makeEnt(c)) : Array.from({ length: p.cardCount }, () => this.makeEnt(null));
      this.hands.set(p.id, ents);
      this.relayout(p.id, 0);
    }
    view.discardTop.forEach(c => {
      const e = this.makeEnt(c);
      this.pile.push(e);
      const s = pileSlot(c.id, this.pile.length - 1);
      e.root.position.copy(s.pos);
      e.root.quaternion.copy(s.quat);
      e.root.scale.setScalar(s.scale ?? 1);
    });
    this.tintPile();
    this.drawCount = view.drawCount;
    this.updateDeck();
    this.direction = view.direction;
    this.arrows.scale.x = view.direction;
    this.setColor(view.currentColor, false, true);
    this.moveMarker(view.currentPlayerId, true);
    this.applyView(view);
  }

  /** Oyun dışına çıkınca masayı temizle */
  clearTable() {
    this.queue = [];
    this.clearAll();
    this.drawCount = 0;
    this.updateDeck();
    (this.marker.material as THREE.MeshBasicMaterial).opacity = 0;
    this.colorLight.intensity = 0;
    (this.glow.material as THREE.MeshBasicMaterial).opacity = 0;
  }

  update(dt: number, camera: THREE.Camera, pointer: THREE.Vector2, pointerActive: boolean) {
    this.fx.update(dt);
    this.ring.rotation.y -= dt * 0.35 * this.direction;
    // atacak kart yoksa deste öne çıkar: hafifçe yükselir, etrafında halka atar
    const now = performance.now() / 1000;
    this.deckLift += ((this.mustDraw ? 1 : 0) - this.deckLift) * Math.min(1, dt * 6);
    const rm = this.deckRing.material as THREE.MeshBasicMaterial;
    rm.opacity = this.deckLift * (0.55 + Math.sin(now * 5) * 0.35);
    this.deckRing.scale.setScalar(1 + this.deckLift * (0.15 + Math.sin(now * 5) * 0.08));
    this.deckRing.visible = this.deckLift > 0.01 && this.drawCount > 0;
    if (this.deck.visible) {
      const h = this.deckHeight();
      this.deck.position.y = TABLE_Y + h / 2 + this.deckLift * (0.025 + Math.sin(now * 4) * 0.008);
    }

    const mm = this.marker.material as THREE.MeshBasicMaterial;
    if (mm.opacity > 0) this.marker.scale.setScalar(1 + Math.sin(performance.now() / 260) * 0.12);

    const mine = this.hands.get(this.you) ?? [];
    this.hovered = null;
    this.deckHovered = false;
    // izleme modunda kendi kartların görünmez ve tıklanamaz
    if (pointerActive && !useApp.getState().pendingWild && !this.hideOwnHand) {
      this.raycaster.setFromCamera(pointer, camera);
      // seçim kartların yelpazedeki sabit yerlerine göre yapılır: üzerine gelinen kart kalkıp büyüyünce
      // komşusunun önüne geçse bile seçim değişmez (kartlar arasında gidip gelmez)
      const hit = this.raycaster.intersectObjects(mine.map(e => e.pick), false)[0];
      this.hovered = hit ? (hit.object.userData.ent as Ent) : null;
      // fare hiçbir kartın yerinde değilse ama az önce seçili kartın kalkmış hâlinin üstündeyse o kart seçili
      // kalır: kartın kenarında durunca kart kalkıp fareden kaçtı diye bırakılmaz (yukarı aşağı titremez)
      const prev = this.lastHovered;
      if (!this.hovered && prev && mine.includes(prev) && this.raycaster.intersectObject(prev.hit, false).length > 0) this.hovered = prev;
      if (!this.hovered && this.drawCount > 0) this.deckHovered = this.raycaster.intersectObject(this.deck, false).length > 0;
    }
    this.lastHovered = this.hovered;
    const hi = this.hovered ? mine.indexOf(this.hovered) : -1;
    const k = Math.min(1, dt * 14);
    mine.forEach((e, i) => {
      e.root.visible = !this.hideOwnHand;
      const d = i - hi;
      const targetSpread = hi >= 0 && d !== 0 && Math.abs(d) <= 2 ? Math.sign(d) * (Math.abs(d) === 1 ? 0.03 : 0.012) : 0;
      e.hover += ((e === this.hovered ? 1 : 0) - e.hover) * k;
      e.spread += (targetSpread - e.spread) * k;
      e.lift += ((e.playable ? 1 : 0) - e.lift) * k;
      e.inner.position.set(e.spread, e.hover * 0.05 + e.lift * 0.035, e.hover * 0.025 + e.lift * 0.004);
      e.inner.scale.setScalar(1 + e.hover * 0.14);
    });
    document.body.style.cursor = this.hovered || this.deckHovered ? 'pointer' : '';

    // atılmak üzere olan kart sağ eli takip eder
    for (const e of this.following) if (!e.tween && e.follow) e.follow.handPosition(e.root.position);

    // rakip kartları karakterin elini takip eder (uçuştaki kartlar hariç)
    if (!this.revealed) {
      for (const [pid, list] of this.hands) {
        if (pid === this.you || !this.anchors.has(pid)) continue;
        list.forEach((e, i) => {
          if (e.tween) return;
          const s = this.slotOf(pid, i, list.length);
          e.root.position.copy(s.pos);
          e.root.quaternion.copy(s.quat);
          e.root.scale.setScalar(s.scale ?? 1);
        });
      }
    }
  }

  click() {
    if (this.hovered?.card) {
      const card = this.hovered.card;
      if (this.view?.playableIds.includes(card.id)) {
        // seçilen kart önce öne yükselip hafifçe döner, sonra yığına uçar
        gsap.fromTo(this.hovered.inner.rotation, { x: 0 }, { x: -0.35, duration: 0.12, yoyo: true, repeat: 1, ease: 'power2.out' });
        sfx.tick();
        this.onCardClick(card);
      }
      else this.shakeEnt(this.hovered);
    } else if (this.deckHovered) {
      this.onDeckClick();
    }
  }

  setHandAnchor(playerId: string, anchor: THREE.Object3D | null, thrower?: Thrower) {
    if (anchor) this.anchors.set(playerId, anchor);
    else this.anchors.delete(playerId);
    if (anchor && thrower) this.throwers.set(playerId, thrower);
    else this.throwers.delete(playerId);
  }

  seatIndexOf(playerId: string) {
    return relativeOrder(this.players, this.you).indexOf(playerId);
  }

  // ================== kuyruk ==================

  private async run() {
    this.running = true;
    while (this.queue.length) {
      const { events, view } = this.queue.shift()!;
      if (document.hidden || events.some(e => e.type === 'GAME_STARTED') === false && !this.players.length) {
        // arka plandaki sekme ya da masaya sonradan gelen: animasyonsuz kur
        this.reset(view);
        continue;
      }
      for (const ev of events) {
        try {
          await this.play(ev, view);
        } catch (err) {
          console.error('animasyon hatası', ev.type, err);
        }
      }
      this.applyView(view);
    }
    this.running = false;
  }

  private applyView(view: PlayerView) {
    this.view = view;
    // emniyet: animasyonlar sonunda durum görünümle uyuşmuyorsa anında düzelt
    const mine = this.hands.get(view.you) ?? [];
    const mismatch =
      mine.length !== view.hand.length ||
      view.players.some(p => (this.hands.get(p.id)?.length ?? -1) !== p.cardCount) ||
      this.pile[this.pile.length - 1]?.card?.id !== view.discardTop[view.discardTop.length - 1]?.id;
    if (mismatch) {
      console.warn('masa görünümle uyuşmadı, yeniden kuruluyor');
      this.reset(view);
      return;
    }
    // elini hizala: oyuncu sıraladıysa ya da karıştırdıysa o sıra korunur (yeni çekilen kartlar sona eklenir),
    // değilse sunucunun sırası
    this.orderHand(view.hand);
    this.relayout(view.you, 0.25);
    this.drawCount = view.drawCount;
    this.updateDeck();
    this.refreshHighlights();
    this.syncCounts();
    useApp.setState({ view });
  }

  /** Oyuncunun kendi seçtiği kart sırası (kart kimlikleri); null = sunucunun sırası */
  private handOrder: string[] | null = null;

  private orderHand(serverHand: Card[]) {
    const mine = this.hands.get(this.you);
    if (!mine) return;
    const server = new Map(serverHand.map((c, i) => [c.id, i]));
    const custom = new Map((this.handOrder ?? []).map((id, i) => [id, i]));
    const rank = (e: Ent) => {
      const id = e.card!.id;
      const c = custom.get(id);
      return c !== undefined ? c : custom.size + (server.get(id) ?? 0);
    };
    mine.sort((a, b) => rank(a) - rank(b));
    if (this.handOrder) this.handOrder = mine.map(e => e.card!.id);
  }

  /** Elindeki kartları renge, sonra sayıya göre dizer (aksiyon ve joker kartları sonda) */
  sortHand() {
    const mine = this.hands.get(this.you);
    if (!mine?.length || this.revealed) return;
    const colorRank = (c: Card) => (c.color === 'wild' ? 9 : COLORS.indexOf(c.color));
    const valueRank = (c: Card) => {
      const n = Number(c.value);
      return Number.isNaN(n) ? 10 + ['skip', 'reverse', 'draw2', 'wild', 'wild4'].indexOf(c.value) : n;
    };
    mine.sort((a, b) => colorRank(a.card!) - colorRank(b.card!) || valueRank(a.card!) - valueRank(b.card!));
    this.handOrder = mine.map(e => e.card!.id);
    sfx.deal();
    this.shuffleLayout(0.012);
  }

  /** Elindeki kartları rastgele karıştırır */
  shuffleHand() {
    const mine = this.hands.get(this.you);
    if (!mine || mine.length < 2 || this.revealed) return;
    const before = mine.map(e => e.card!.id).join();
    // aynı sıra çıkarsa yeniden karıştır: tıklayınca mutlaka değişsin
    for (let k = 0; k < 5 && mine.map(e => e.card!.id).join() === before; k++) {
      for (let i = mine.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [mine[i], mine[j]] = [mine[j], mine[i]];
      }
    }
    this.handOrder = mine.map(e => e.card!.id);
    sfx.shuffle();
    this.shuffleLayout(0.025);
  }

  /** kartlar hafifçe havalanıp yeni yerlerine kayar (sıralama/karıştırma) */
  private shuffleLayout(stagger: number) {
    const list = this.hand(this.you);
    list.forEach((e, i) => void this.moveTo(e, this.slotOf(this.you, i, list.length), { dur: 0.42, lift: 0.05, delay: i * stagger }));
    this.refreshHighlights();
  }

  private play(ev: GameEvent, view: PlayerView): Promise<void> | void {
    switch (ev.type) {
      case 'GAME_STARTED':
        return this.gameStarted(ev.playerIds, view);
      case 'CARDS_DEALT':
        return this.deal(ev.perPlayer, ev.hands);
      case 'FIRST_CARD':
        return this.firstCard(ev.card, ev.color);
      case 'CARD_PLAYED':
        return this.cardPlayed(ev.playerId, ev.card, ev.color);
      case 'CARD_DRAWN':
        return this.cardDrawn(ev.playerId, ev.count, ev.cards, ev.reason);
      case 'COLOR_CHOSEN':
        return this.colorChosen(ev.color);
      case 'DIRECTION_REVERSED':
        return this.reversed(ev.direction);
      case 'PLAYER_SKIPPED':
        return this.skipped(ev.playerId);
      case 'DRAW_STACKED':
        this.fx.text(`+${ev.pending}`, PILE_POS.clone().setY(TABLE_Y + 0.3), '#ff4d4d', 0.14);
        sfx.penalty();
        return wait(0.5);
      case 'UNO':
        return this.uno(ev.playerId);
      case 'DECK_RESHUFFLED':
        return this.reshuffle(ev.count);
      case 'TURN_CHANGED':
        this.current = ev.playerId;
        this.moveMarker(ev.playerId);
        if (ev.playerId === this.you) sfx.turn();
        return;
      case 'GAME_ENDED':
        return this.gameEnded(ev.winnerId, ev.hands);
    }
  }

  // ================== koreografiler ==================

  private async gameStarted(playerIds: string[], view: PlayerView) {
    this.clearAll();
    this.revealed = false;
    this.handOrder = null;
    this.players = playerIds;
    this.you = view.you;
    playerIds.forEach(id => this.hands.set(id, []));
    this.drawCount = 108;
    this.updateDeck();
    useApp.setState({ unoFlags: {}, view: null });
    this.syncCounts();
    // deste karıştırma: iki yarı ayrılıp iç içe geçer
    const top = this.deckTop();
    const temp = Array.from({ length: 16 }, (_, i) => {
      const e = this.makeEnt(null);
      e.root.position.copy(top.pos).setY(top.pos.y + i * 0.0015);
      e.root.quaternion.copy(top.quat);
      return e;
    });
    sfx.shuffle();
    const tl = gsap.timeline();
    for (let r = 0; r < 2; r++) {
      temp.forEach((e, i) => {
        const side = i % 2 ? 1 : -1;
        tl.to(e.root.position, { x: top.pos.x + side * 0.085, y: top.pos.y + 0.03 + i * 0.002, duration: 0.18, ease: 'power2.out' }, r * 0.55);
        tl.to(e.root.position, { x: top.pos.x, y: top.pos.y + i * 0.0015, duration: 0.2, ease: 'power2.in' }, r * 0.55 + 0.22 + i * 0.01);
      });
    }
    await tl;
    temp.forEach(e => this.disposeEnt(e));
  }

  private async deal(perPlayer: number, hands: { playerId: string; count: number; cards?: Card[] }[]) {
    const order: { ent: Ent; pid: string }[] = [];
    for (let r = 0; r < perPlayer; r++) {
      for (const h of hands) {
        const ent = this.spawnFromDeck(h.cards?.[r] ?? null);
        this.hand(h.playerId).push(ent);
        order.push({ ent, pid: h.playerId });
      }
    }
    const jobs = order.map(({ ent, pid }, k) => {
      const list = this.hand(pid);
      const slot = this.slotOf(pid, list.indexOf(ent), list.length);
      gsap.delayedCall(k * 0.06, () => {
        this.drawCount--;
        this.updateDeck();
        sfx.deal();
        this.syncCounts();
      });
      return this.moveTo(ent, slot, { dur: 0.45, lift: 0.22, delay: k * 0.06 });
    });
    await Promise.all(jobs);
  }

  private async firstCard(card: Card, color: Color) {
    const e = this.spawnFromDeck(card);
    this.drawCount--;
    this.updateDeck();
    await this.toPile(e, 0.7, 0.35);
    this.setColor(color, true);
    await wait(0.2);
  }

  private async cardPlayed(playerId: string, card: Card, color: Color) {
    const list = this.hand(playerId);
    let e = playerId === this.you ? list.find(x => x.card?.id === card.id) : list[Math.floor(list.length / 2)];
    if (e) list.splice(list.indexOf(e), 1);
    else e = this.spawnFromDeck(null);
    this.setFace(e, card);
    // elden gelen "oynanabilir" parıltısı ve kararma yığında kalmasın
    gsap.killTweensOf(e.mat);
    gsap.killTweensOf(e.mat.color);
    e.mat.emissiveIntensity = CARD_GLOW;
    e.mat.color.setScalar(CARD_LIT);
    e.hover = 0;
    e.spread = 0;
    e.playable = false;
    e.lift = 0;
    gsap.killTweensOf(e.fade);
    e.fade.value = 0;
    e.inner.position.set(0, 0, 0);
    e.inner.scale.setScalar(1);
    this.relayout(playerId, 0.4);
    this.syncCounts();
    this.refreshHighlights(true);

    const thrower = playerId !== this.you ? this.throwers.get(playerId) : undefined;
    if (thrower) {
      // karakter kolunu geri çeker: kart sağ eline geçer, bırakma anında yığına uçar
      const released = thrower.throw();
      this.following.add(e);
      e.follow = thrower;
      await this.moveTo(e, { pos: thrower.handPosition(new THREE.Vector3()), quat: e.root.quaternion.clone(), scale: 0.85 }, { dur: 0.18 });
      await Promise.race([released, wait(0.9)]);
      this.following.delete(e);
      e.follow = null;
    } else if (playerId === this.you) {
      // kendi atışın: kart önce hafifçe geri ve yukarı çekilir, sonra fırlatılır
      const back = e.root.position.clone().add(new THREE.Vector3(0, 0.05, 0.05));
      await this.moveTo(e, { pos: back, quat: e.root.quaternion.clone() }, { dur: 0.12, ease: 'power2.out' });
    }
    await this.toPile(e, playerId === this.you ? 0.45 : 0.5, 0.32, isAction(card) ? Math.PI * 2 : 0);
    if (card.color !== 'wild') this.setColor(color, false);
    if (card.value === 'draw2' || card.value === 'wild4') {
      this.fx.text(card.value === 'draw2' ? '+2' : '+4', PILE_POS.clone().setY(TABLE_Y + 0.28), '#ff4d4d', 0.16, 0.2);
    }
  }

  private async cardDrawn(playerId: string, count: number, cards: Card[] | undefined, reason: 'draw' | 'penalty') {
    const list = this.hand(playerId);
    const ents: Ent[] = [];
    for (let k = 0; k < count; k++) {
      const e = this.spawnFromDeck(cards?.[k] ?? null);
      list.push(e);
      ents.push(e);
    }
    const idx = this.seatIndexOf(playerId);
    if (reason === 'penalty') {
      this.fx.text(`+${count}`, headPos(idx, this.players.length), '#ff4d4d', 0.2, 0.4);
      useApp.getState().react(playerId, 'sad');
      sfx.penalty();
    }
    this.relayout(playerId, 0.35, ents);
    const jobs = ents.map((e, k) => {
      gsap.delayedCall(k * 0.13, () => {
        this.drawCount = Math.max(0, this.drawCount - 1);
        this.updateDeck();
        sfx.draw();
        this.syncCounts();
      });
      return this.moveTo(e, this.slotOf(playerId, list.indexOf(e), list.length), {
        dur: 0.5,
        lift: playerId === this.you ? 0.18 : 0.25,
        delay: k * 0.13,
        pulse: playerId === this.you ? 1.25 : 1.1,
      });
    });
    await Promise.all(jobs);
    if (reason === 'penalty' || list.length > 1) {
      useApp.setState(s => ({ unoFlags: { ...s.unoFlags, [playerId]: false } }));
    }
  }

  private async colorChosen(color: Color) {
    this.setColor(color, true);
    this.fx.text(COLOR_NAME[color], PILE_POS.clone().setY(TABLE_Y + 0.3), COLOR_HEX[color], 0.13, 0.3);
    sfx.magic();
    await wait(0.55);
  }

  private async reversed(direction: 1 | -1) {
    this.direction = direction;
    sfx.whoosh();
    this.fx.text('⇄', new THREE.Vector3(0, TABLE_Y + 0.25, 0.02), '#ffffff', 0.2, 0.15);
    gsap.to(this.ring.rotation, { y: `+=${Math.PI}`, duration: 0.75, ease: 'back.inOut(2)' });
    gsap.to(this.ring.scale, { keyframes: [{ x: 1.25, z: 1.25, duration: 0.3 }, { x: 1, z: 1, duration: 0.4 }] });
    await gsap.to(this.arrows.scale, { x: direction, duration: 0.6, ease: 'power2.inOut' });
  }

  private async skipped(playerId: string) {
    const idx = this.seatIndexOf(playerId);
    this.fx.text(playerId === this.you ? '⊘ Sıran atlandı' : '⊘', headPos(idx, this.players.length), '#ff4d4d', playerId === this.you ? 0.1 : 0.22, 0.25);
    useApp.getState().react(playerId, 'no');
    sfx.skip();
    if (playerId === this.you) this.shake = 0.02;
    await wait(0.65);
  }

  private async uno(playerId: string) {
    const idx = this.seatIndexOf(playerId);
    const pos = headPos(idx, this.players.length);
    useApp.setState(s => ({ unoFlags: { ...s.unoFlags, [playerId]: true } }));
    useApp.getState().react(playerId, 'uno');
    sfx.uno();
    this.fx.text('UNO!', pos, '#f5c400', idx === 0 ? 0.14 : 0.3, 0.45);
    this.fx.burst(pos.clone().setY(pos.y - 0.05), '#f5c400', 70, 1.4);
    this.fx.burst(pos.clone().setY(pos.y - 0.05), '#e5322d', 40, 1.1);
    // son kart parlayarak zıplar
    const last = this.hand(playerId)[0];
    if (last) gsap.fromTo(last.root.scale, { x: 1.4, y: 1.4, z: 1.4 }, { x: 1, y: 1, z: 1, duration: 0.6, ease: 'elastic.out(1,0.35)' });
    if (idx === 0) this.shake = 0.015;
    await wait(0.9);
  }

  private async reshuffle(count: number) {
    const top = this.pile.pop();
    const old = this.pile;
    this.pile = top ? [top] : [];
    sfx.shuffle();
    const deckTop = this.deckTop();
    await Promise.all(
      old.map((e, i) =>
        this.moveTo(e, { pos: deckTop.pos.clone().setY(deckTop.pos.y + 0.03), quat: deckTop.quat }, { dur: 0.45, lift: 0.08, delay: i * 0.008 }).then(
          () => this.disposeEnt(e),
        ),
      ),
    );
    this.drawCount += count;
    this.updateDeck();
    await wait(0.2);
  }

  private async gameEnded(winnerId: string, hands: Record<string, Card[]>) {
    this.revealed = true;
    const won = winnerId === this.you;
    useApp.getState().react(winnerId, 'dance');
    for (const id of this.players) if (id !== winnerId) useApp.getState().react(id, 'sad');
    // herkesin kalan kartları masaya açık serilir: her oyuncunun önüne, kendi koltuğuna dönük
    for (const id of this.players) {
      const list = this.hand(id);
      const cards = hands[id] ?? [];
      const count = Math.max(list.length, cards.length);
      list.forEach((e, i) => {
        const c = cards[i];
        if (c) this.setFace(e, c);
        const delay = i * 0.06;
        void this.moveTo(e, this.tableSpot(id, i, count), { dur: 0.6, lift: 0.14, delay });
      });
    }
    this.fx.confetti(new THREE.Vector3(0, TABLE_Y, 0));
    this.fx.burst(PILE_POS.clone(), '#f5c400', 90, 1.6);
    if (won) sfx.win();
    else sfx.lose();
    await wait(1.6);
  }

  // ================== yardımcılar ==================

  private hand(pid: string) {
    let list = this.hands.get(pid);
    if (!list) {
      list = [];
      this.hands.set(pid, list);
    }
    return list;
  }

  /** Oyun sonunda kartların masadaki yeri: oyuncunun önünde, koltuğuna dönük ve yüzü açık */
  private tableSpot(pid: string, i: number, count: number): Frame {
    const idx = this.seatIndexOf(pid);
    const seat = seatFrame(idx, this.players.length);
    const d = new THREE.Vector3(seat.pos.x, 0, seat.pos.z).normalize();
    const side = new THREE.Vector3(-d.z, 0, d.x);
    const step = Math.min(0.085, 0.55 / Math.max(1, count));
    const off = (i - (count - 1) / 2) * step;
    const pos = new THREE.Vector3(d.x * 0.4 + side.x * off, TABLE_Y + 0.003 + i * 0.0009, d.z * 0.4 + side.z * off);
    return { pos, quat: faceUp(Math.atan2(d.x, d.z)) };
  }

  private slotOf(pid: string, i: number, count: number): Frame {
    const anchor = pid !== this.you ? this.anchors.get(pid) : undefined;
    if (anchor) return anchoredHandSlot(anchor, i, count);
    return handSlot(this.seatIndexOf(pid), this.players.length, i, count);
  }

  private relayout(pid: string, dur: number, except: Ent[] = []) {
    const list = this.hand(pid);
    list.forEach((e, i) => {
      if (except.includes(e)) return;
      // oyun bittiyse kartlar masada açık kalır (elin havadaki yerine geri dönmez)
      const slot = this.revealed ? this.tableSpot(pid, i, list.length) : this.slotOf(pid, i, list.length);
      if (dur === 0) {
        e.tween?.kill();
        e.root.position.copy(slot.pos);
        e.root.quaternion.copy(slot.quat);
      } else void this.moveTo(e, slot, { dur, lift: 0 });
    });
  }

  private deckTop(): Frame {
    const h = this.deckHeight();
    return { pos: new THREE.Vector3(DECK_POS.x, TABLE_Y + h + 0.0015, DECK_POS.z), quat: faceDown() };
  }

  private deckHeight() {
    return Math.max(0.001, this.drawCount * 0.0009);
  }

  private updateDeck() {
    const h = this.deckHeight();
    this.deck.visible = this.drawCount > 0;
    this.deck.scale.y = h;
    this.deck.position.set(DECK_POS.x, TABLE_Y + h / 2, DECK_POS.z);
  }

  private makeEnt(card: Card | null): Ent {
    backMat ??= new THREE.MeshStandardMaterial({ map: backTexture(), roughness: 0.8 });
    const map = card ? faceTexture(card) : backTexture();
    // mat yüzey: lamba altında parlayıp yazıyı silmesin
    const mat = new THREE.MeshStandardMaterial({ map, color: new THREE.Color().setScalar(CARD_LIT), roughness: 1, metalness: 0, emissive: '#ffffff', emissiveMap: map, emissiveIntensity: CARD_GLOW });
    const root = new THREE.Group();
    const inner = new THREE.Group();
    const front = new THREE.Mesh(GEO, mat);
    const back = new THREE.Mesh(GEO, backMat);
    front.position.z = 0.0006;
    back.position.z = -0.0006;
    back.rotation.y = Math.PI;
    front.castShadow = back.castShadow = true;
    const fade = { value: 0 };
    addFade(mat, fade);
    inner.add(front, back);
    const hit = new THREE.Mesh(HIT_GEO, HIT_MAT);
    const pick = new THREE.Mesh(PICK_GEO, HIT_MAT);
    pick.position.z = 0.0006;
    root.add(inner, hit, pick);
    this.cards.add(root);
    const ent: Ent = { root, inner, front, mat, card, tween: null, hover: 0, spread: 0, playable: false, lift: 0, fade, follow: null, pick, hit };
    front.userData.ent = ent;
    pick.userData.ent = ent;
    return ent;
  }

  private setFace(e: Ent, card: Card) {
    e.card = card;
    const map = faceTexture(card);
    e.mat.map = map;
    e.mat.emissiveMap = map;
    e.mat.needsUpdate = true;
  }

  private spawnFromDeck(card: Card | null): Ent {
    const e = this.makeEnt(card);
    const top = this.deckTop();
    e.root.position.copy(top.pos);
    e.root.quaternion.copy(top.quat);
    return e;
  }

  private disposeEnt(e: Ent) {
    e.tween?.kill();
    this.cards.remove(e.root);
    e.mat.dispose();
  }

  private clearAll() {
    for (const list of this.hands.values()) list.forEach(e => this.disposeEnt(e));
    this.pile.forEach(e => this.disposeEnt(e));
    this.hands.clear();
    this.pile = [];
    this.fx.clear();
  }

  /** Yay çizerek hedefe uçuş. Ön/arka yüz geçişi quaternion slerp'i ile kendiliğinden olur. */
  private moveTo(e: Ent, to: Frame, o: { dur: number; lift?: number; delay?: number; spin?: number; pulse?: number; ease?: string }) {
    e.tween?.kill();
    const fromPos = e.root.position.clone();
    const fromQuat = e.root.quaternion.clone();
    const fromScale = e.root.scale.x;
    const toScale = to.scale ?? 1;
    const mid = fromPos.clone().lerp(to.pos, 0.5);
    mid.y += o.lift ?? 0;
    const spinAxis = new THREE.Vector3(0, 1, 0);
    const spinQ = new THREE.Quaternion();
    const p = { t: 0 };
    return new Promise<void>(resolve => {
      e.tween = gsap.to(p, {
        t: 1,
        duration: o.dur,
        delay: o.delay ?? 0,
        ease: o.ease ?? 'power2.inOut',
        onStart: () => {
          if (o.lift) e.root.renderOrder = 1;
        },
        onUpdate: () => {
          const t = p.t;
          const u = 1 - t;
          e.root.position.set(
            u * u * fromPos.x + 2 * u * t * mid.x + t * t * to.pos.x,
            u * u * fromPos.y + 2 * u * t * mid.y + t * t * to.pos.y,
            u * u * fromPos.z + 2 * u * t * mid.z + t * t * to.pos.z,
          );
          e.root.quaternion.slerpQuaternions(fromQuat, to.quat, t);
          if (o.spin) e.root.quaternion.premultiply(spinQ.setFromAxisAngle(spinAxis, o.spin * t));
          e.root.scale.setScalar(THREE.MathUtils.lerp(fromScale, toScale, t) * (o.pulse ? 1 + (o.pulse - 1) * Math.sin(Math.PI * t) : 1));
        },
        onComplete: () => {
          e.tween = null;
          e.root.position.copy(to.pos);
          e.root.quaternion.copy(to.quat);
          e.root.scale.setScalar(toScale);
          resolve();
        },
        onInterrupt: () => resolve(),
      });
    });
  }

  /**
   * Yığının en üstteki kartı tam renkte ve hafifçe kendi ışığıyla parlar (lamba altında soluk görünmesin,
   * oynanacak renk hemen seçilsin); alttakiler biraz kısılır, üstteki öne çıkar.
   */
  private tintPile() {
    this.pile.forEach((p, i) => {
      const top = i === this.pile.length - 1;
      p.mat.color.setScalar(CARD_LIT * (top ? 1 : 0.9));
      p.mat.emissiveIntensity = CARD_GLOW * (top ? 1.15 : 0.85);
    });
  }

  private async toPile(e: Ent, dur: number, lift: number, spin = 0) {
    this.pile.push(e);
    this.tintPile();
    const slot = pileSlot(e.card!.id, this.pile.length - 1);
    await this.moveTo(e, slot, { dur, lift, spin, pulse: 1.35 });
    // iniş: ezilip yaylanma, kıvılcım, şok dalgası, kamera sarsıntısı
    const ps = slot.scale ?? 1;
    gsap.fromTo(e.root.scale, { x: 1.12 * ps, y: 0.9 * ps, z: 1.12 * ps }, { x: ps, y: ps, z: ps, duration: 0.4, ease: 'elastic.out(1.1,0.4)' });
    const color = cardColor(e.card!);
    sfx.slap();
    this.fx.burst(slot.pos, color);
    this.fx.shockwave(slot.pos, color);
    this.shake = Math.max(this.shake, 0.008);
    if (this.pile.length > 28) {
      this.disposeEnt(this.pile.shift()!);
      // kalanlar bir kademe iner: bir sonraki kart üstteki kartla aynı yüksekliğe düşüp titreşmesin
      const step = pileSlot('', 1).pos.y - pileSlot('', 0).pos.y;
      for (const p of this.pile) p.root.position.y -= step;
    }
  }

  private setColor(color: Color, big: boolean, instant = false) {
    const c = new THREE.Color(COLOR_HEX[color]);
    const glowMat = this.glow.material as THREE.MeshBasicMaterial;
    const d = instant ? 0 : 0.7;
    gsap.to(this.colorLight.color, { r: c.r, g: c.g, b: c.b, duration: d });
    gsap.to(this.colorLight, { intensity: 0.22, duration: d });
    gsap.to(this.ringMat.emissive, { r: c.r, g: c.g, b: c.b, duration: d });
    gsap.to(glowMat.color, { r: c.r, g: c.g, b: c.b, duration: d });
    gsap.to(glowMat, { opacity: 0.03, duration: d });
    if (big) {
      this.fx.shockwave(PILE_POS, COLOR_HEX[color], 14, 1.1);
      gsap.fromTo(this.colorLight, { intensity: 1.0 }, { intensity: 0.22, duration: 1.2 });
    }
  }

  private moveMarker(playerId: string, instant = false) {
    const idx = this.seatIndexOf(playerId);
    if (idx < 0) return;
    const mat = this.marker.material as THREE.MeshBasicMaterial;
    const target = seatAngle(idx, this.players.length);
    let delta = target - this.markerAngle.a;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta)); // en kısa yol
    const apply = () => {
      const r = TABLE_R - 0.2;
      this.marker.position.set(Math.sin(this.markerAngle.a) * r, TABLE_Y + 0.002, Math.cos(this.markerAngle.a) * r);
    };
    if (instant) {
      this.markerAngle.a = target;
      apply();
      mat.opacity = 0.9;
      return;
    }
    gsap.to(mat, { opacity: 0.9, duration: 0.3 });
    gsap.to(this.markerAngle, { a: this.markerAngle.a + delta, duration: 0.55, ease: 'power3.inOut', onUpdate: apply });
  }

  /** Oynanabilir kartlar parlar, diğerleri kararır; çekmen gerekiyorsa deste parlar */
  private refreshHighlights(clear = false) {
    const v = this.view;
    const myTurn = !clear && v && v.phase === 'playing' && v.currentPlayerId === v.you;
    const playable = new Set(myTurn ? v!.playableIds : []);
    for (const e of this.hand(this.you)) {
      const ok = !!e.card && playable.has(e.card.id);
      e.playable = ok;
      gsap.to(e.fade, { value: myTurn && !ok ? 1 : 0, duration: 0.35 });
    }
    const mustDraw = !!myTurn && playable.size === 0 && !v!.drawnCardId;
    this.mustDraw = mustDraw;
    gsap.killTweensOf(this.deckMat);
    if (mustDraw) gsap.fromTo(this.deckMat, { emissiveIntensity: 0 }, { emissiveIntensity: 0.4, duration: 0.6, repeat: -1, yoyo: true });
    else this.deckMat.emissiveIntensity = 0;
  }

  private shakeEnt(e: Ent) {
    gsap.fromTo(e.root.rotation, { z: e.root.rotation.z }, { keyframes: { z: [0.12, -0.12, 0.08, -0.05, 0].map(d => e.root.rotation.z + d) }, duration: 0.35 });
    sfx.tick();
  }

  private syncCounts() {
    const counts: Record<string, number> = {};
    for (const [id, list] of this.hands) counts[id] = list.length;
    useApp.setState({ counts });
  }
}

export const director = new TableDirector();
