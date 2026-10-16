import * as THREE from 'three';

// Tyre smoke and NOS purge clouds as a single Points draw call with per-particle size and alpha.
export class Particles {
  constructor(scene, max = 700) {
    this.max = max;
    this.next = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.decay = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.tint = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('tint', new THREE.BufferAttribute(this.tint, 1));
    this.geo = geo;

    this.material = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute float alpha;
        attribute float size;
        attribute float tint;
        uniform float scale;
        varying float vAlpha;
        varying float vTint;
        void main() {
          vAlpha = alpha;
          vTint = tint;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying float vTint;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.1, d) * vAlpha;
          if (a < 0.01) discard;
          vec3 smoke = vec3(0.32, 0.31, 0.36);      // tyre smoke, lit by the night
          vec3 purge = vec3(0.75, 0.85, 1.0);       // NOS purge, cold and bright
          gl_FragColor = vec4(mix(smoke, purge, vTint), a);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setViewportHeight(h) {
    this.material.uniforms.scale.value = h / 2;
  }

  spawn(p, { size = 0.8, alpha = 0.45, life = 1.1, grow = 3.5, tint = 0, spread = 1.5, rise = 1, vx = 0, vz = 0 } = {}) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = p.x + (Math.random() - 0.5) * 0.4;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.4;
    this.vel[i * 3] = vx + (Math.random() - 0.5) * spread;
    this.vel[i * 3 + 1] = rise * (0.6 + Math.random());
    this.vel[i * 3 + 2] = vz + (Math.random() - 0.5) * spread;
    this.life[i] = 1;
    this.decay[i] = 1 / life;
    this.grow[i] = grow;
    this.size[i] = size;
    this.alpha[i] = alpha;
    this.tint[i] = tint;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt * this.decay[i];
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3] *= 1 - dt * 1.5;
      this.vel[i * 3 + 2] *= 1 - dt * 1.5;
      this.size[i] += dt * this.grow[i];
      this.alpha[i] *= 1 - dt * 1.1;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.tint.needsUpdate = true;
  }
}
