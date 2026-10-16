import * as THREE from 'three';

// Tyre smoke as a single Points draw call with per-particle size and alpha.
export class Particles {
  constructor(scene, max = 400) {
    this.max = max;
    this.next = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.geo = geo;

    this.material = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute float alpha;
        attribute float size;
        uniform float scale;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.1, d) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.88), a);
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

  spawn(p, intensity = 1) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = p.x + (Math.random() - 0.5) * 0.4;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.4;
    this.vel[i * 3] = (Math.random() - 0.5) * 1.5;
    this.vel[i * 3 + 1] = 0.8 + Math.random();
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
    this.life[i] = 1;
    this.size[i] = 0.8;
    this.alpha[i] = 0.45 * intensity;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt * 0.9;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += dt * 3.5;
      this.alpha[i] *= 1 - dt * 1.2;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}
