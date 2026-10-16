import * as THREE from 'three';
import gsap from 'gsap';

interface Effect {
  update(dt: number): boolean; // false → bitti, kaldır
  dispose(): void;
}

/** 3D sahnedeki parçacık, şok dalgası, yazı ve konfeti efektleri */
export class Fx {
  group = new THREE.Group();
  private effects: Effect[] = [];

  update(dt: number) {
    this.effects = this.effects.filter(e => {
      const alive = e.update(dt);
      if (!alive) e.dispose();
      return alive;
    });
  }

  clear() {
    this.effects.forEach(e => e.dispose());
    this.effects = [];
  }

  /** Kıvılcım patlaması */
  burst(pos: THREE.Vector3, color: string, count = 46, speed = 1.1) {
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3);
    const v: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      p.set([pos.x, pos.y + 0.01, pos.z], i * 3);
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.2, Math.random() - 0.5).normalize();
      v.push(dir.multiplyScalar(speed * (0.4 + Math.random())));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size: 0.022,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    this.group.add(pts);
    let life = 0;
    this.effects.push({
      update: dt => {
        life += dt;
        const attr = geo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < count; i++) {
          v[i].y -= 3.2 * dt;
          attr.setXYZ(i, attr.getX(i) + v[i].x * dt, attr.getY(i) + v[i].y * dt, attr.getZ(i) + v[i].z * dt);
        }
        attr.needsUpdate = true;
        mat.opacity = Math.max(0, 1 - life / 0.9);
        return life < 0.9;
      },
      dispose: () => {
        this.group.remove(pts);
        geo.dispose();
        mat.dispose();
      },
    });
  }

  /** Masa üstünde yayılan halka */
  shockwave(pos: THREE.Vector3, color: string, maxScale = 4, duration = 0.7) {
    const geo = new THREE.RingGeometry(0.07, 0.085, 64);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pos).setY(pos.y + 0.004);
    this.group.add(ring);
    let done = false;
    gsap.fromTo(ring.scale, { x: 0.3, y: 0.3, z: 0.3 }, { x: maxScale, y: maxScale, z: maxScale, duration, ease: 'power2.out' });
    gsap.fromTo(mat, { opacity: 1 }, { opacity: 0, duration, ease: 'power1.in', onComplete: () => void (done = true) });
    this.effects.push({
      update: () => !done,
      dispose: () => {
        gsap.killTweensOf(ring.scale);
        gsap.killTweensOf(mat);
        this.group.remove(ring);
        geo.dispose();
        mat.dispose();
      },
    });
  }

  /** Havada beliren ve yükselerek kaybolan yazı */
  text(text: string, pos: THREE.Vector3, color = '#ffffff', size = 0.16, hold = 0.5) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const fontPx = 140;
    ctx.font = `900 italic ${fontPx}px Rubik, "Segoe UI Symbol", sans-serif`;
    const w = Math.ceil(ctx.measureText(text).width + fontPx * 0.6);
    canvas.width = w;
    canvas.height = fontPx * 1.5;
    ctx.font = `900 italic ${fontPx}px Rubik, "Segoe UI Symbol", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = fontPx * 0.14;
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, w / 2, canvas.height / 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 30;
    ctx.fillText(text, w / 2, canvas.height / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 999;
    const aspect = canvas.width / canvas.height;
    sprite.position.copy(pos);
    this.group.add(sprite);
    let done = false;
    const s = { k: 0 };
    const apply = () => sprite.scale.set(size * aspect * s.k, size * s.k, 1);
    apply();
    gsap
      .timeline({ onComplete: () => void (done = true) })
      .to(s, { k: 1, duration: 0.45, ease: 'back.out(3)', onUpdate: apply })
      .to(sprite.position, { y: pos.y + 0.22, duration: 0.6, ease: 'power1.in' }, `+=${hold}`)
      .to(mat, { opacity: 0, duration: 0.6 }, '<');
    this.effects.push({
      update: () => !done,
      dispose: () => {
        this.group.remove(sprite);
        tex.dispose();
        mat.dispose();
      },
    });
  }

  /** Yukarıdan yağan renkli konfeti */
  confetti(center: THREE.Vector3, count = 220) {
    const geo = new THREE.PlaneGeometry(0.018, 0.011);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const palette = ['#e5322d', '#f5c400', '#2fa84f', '#1e6fd9', '#ffffff'].map(c => new THREE.Color(c));
    const parts = Array.from({ length: count }, (_, i) => {
      mesh.setColorAt(i, palette[i % palette.length]);
      return {
        p: new THREE.Vector3(center.x + (Math.random() - 0.5) * 1.6, center.y + 0.6 + Math.random() * 0.9, center.z + (Math.random() - 0.5) * 1.6),
        v: new THREE.Vector3((Math.random() - 0.5) * 0.4, -0.25 - Math.random() * 0.35, (Math.random() - 0.5) * 0.4),
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        w: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
      };
    });
    this.group.add(mesh);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    let life = 0;
    this.effects.push({
      update: dt => {
        life += dt;
        parts.forEach((pt, i) => {
          pt.p.addScaledVector(pt.v, dt);
          pt.p.x += Math.sin(life * 3 + i) * 0.002;
          pt.r.x += pt.w.x * dt;
          pt.r.y += pt.w.y * dt;
          q.setFromEuler(pt.r);
          m.compose(pt.p, q, one);
          mesh.setMatrixAt(i, m);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mat.opacity = Math.min(1, Math.max(0, (4.5 - life) / 1));
        return life < 4.5;
      },
      dispose: () => {
        this.group.remove(mesh);
        geo.dispose();
        mat.dispose();
        mesh.dispose();
      },
    });
  }
}
