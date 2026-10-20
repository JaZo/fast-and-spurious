// A loaded track: the road (physics + visuals) plus its themed scenery. Built and torn down
// whenever the host picks a different track.

import * as THREE from 'three';
import { Track } from './track.js';
import { buildDowntown } from './scenery/downtown.js';
import { buildFreeway } from './scenery/freeway.js';
import { buildDocks } from './scenery/docks.js';
import { buildHills } from './scenery/hills.js';

const SCENERY = {
  downtown: buildDowntown,
  freeway: buildFreeway,
  docks: buildDocks,
  hills: buildHills,
};

export class World {
  constructor(scene, def) {
    this.def = def;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.track = new Track(def, this.group);
    SCENERY[def.scenery](this.group, this.track, def);
    if (def.ambient) {
      const { sky, ground, intensity } = def.ambient;
      this.group.add(new THREE.HemisphereLight(sky, ground, intensity));
    }
  }

  dispose() {
    this.group.removeFromParent();
    const textures = new Set();
    this.group.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material ?? [])) {
        for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
        m.dispose();
      }
    });
    for (const t of textures) t.dispose();
  }
}
