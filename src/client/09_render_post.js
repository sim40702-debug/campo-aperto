// ============================================================
// RIFINITURA DELL'IMMAGINE (0.22) — come nelle partite in TV
// La scena si disegna in un'immagine fuori dallo schermo e poi passa da tre ritocchi:
// 1. bagliore (bloom): le cose più luminose (fari, lucine, stelle, fuochi d'artificio, neve al sole) si sfumano
//    attorno, come in una telecamera vera;
// 2. colore: un po' più di contrasto e di saturazione, neri più profondi, bianchi che non bruciano;
// 3. vignettatura leggera e una grana finissima che toglie le "scalette" nei colori scuri.
// Solo con la qualità Media, Alta e Ultra (in Bassa si disegna direttamente, come prima).
// Il bordo frastagliato si toglie lo stesso: l'immagine fuori dallo schermo ha l'antialiasing (WebGL2).
// ============================================================
const POST_VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// prende solo le parti più luminose (sopra la soglia), con un passaggio morbido
const POST_BRIGHT = `uniform sampler2D tex; uniform float threshold; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tex, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(threshold, threshold + 0.25, l);
  gl_FragColor = vec4(c * k, 1.0);
}`;

// sfocatura in una direzione (prima orizzontale, poi verticale): 9 campioni con i pesi di una gaussiana
const POST_BLUR = `uniform sampler2D tex; uniform vec2 dir; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tex, vUv).rgb * 0.2270270270;
  c += texture2D(tex, vUv + dir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tex, vUv - dir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tex, vUv + dir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(tex, vUv - dir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

// unione finale: scena + bagliore, colore, vignettatura, grana, e la conversione in sRGB per lo schermo
const POST_FINAL = `uniform sampler2D scene; uniform sampler2D bloomA; uniform sampler2D bloomB; uniform float strength;
uniform float contrast; uniform float saturation; uniform vec3 tint; uniform float vignette; uniform float time; varying vec2 vUv;
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec3 c = texture2D(scene, vUv).rgb;
  c += (texture2D(bloomA, vUv).rgb * 0.6 + texture2D(bloomB, vUv).rgb * 0.9) * strength;
  // colore: saturazione e contrasto attorno al grigio medio, poi la tinta della scena
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  c = toSRGB(clamp(c, 0.0, 1.0));
  c = (c - 0.5) * contrast + 0.5;
  c *= tint;
  // vignettatura: angoli appena più scuri
  vec2 d = vUv - 0.5;
  c *= 1.0 - dot(d, d) * vignette;
  // grana finissima (meno di un livello di colore): niente scalette nel cielo e nelle ombre
  float n = fract(sin(dot(vUv * 1000.0 + time, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// regolazioni per ora del giorno: di sera il bagliore dei fari è più forte, di giorno quasi niente
const POST_LOOK = {
  night: { threshold: 0.72, strength: 0.85, contrast: 1.08, saturation: 1.12, tint: [1.0, 1.0, 1.03] },
  sunset: { threshold: 0.78, strength: 0.6, contrast: 1.07, saturation: 1.1, tint: [1.04, 1.0, 0.96] },
  day: { threshold: 0.86, strength: 0.35, contrast: 1.06, saturation: 1.1, tint: [1.0, 1.0, 1.0] },
};

Renderer.prototype.postEnabled = function () {
  return !!this.Q.post && this.renderer.capabilities.isWebGL2;
};

Renderer.prototype.buildPost = function () {
  if (this.post) return this.post;
  const type = this.renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: type, depthBuffer: false };
  const main = new THREE.WebGLMultisampleRenderTarget(1, 1, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: type });
  main.samples = 4;
  const P = this.post = {
    main: main,
    // bagliore a metà e a un quarto della risoluzione: uno stretto e uno largo
    half: [new THREE.WebGLRenderTarget(1, 1, opts), new THREE.WebGLRenderTarget(1, 1, opts)],
    quarter: [new THREE.WebGLRenderTarget(1, 1, opts), new THREE.WebGLRenderTarget(1, 1, opts)],
    camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    scene: new THREE.Scene(),
    w: 0, h: 0, t: 0,
  };
  const mat = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: POST_VERTEX, fragmentShader: frag, uniforms: uniforms, depthTest: false, depthWrite: false, toneMapped: false });
  P.bright = mat(POST_BRIGHT, { tex: { value: null }, threshold: { value: 0.75 } });
  P.blur = mat(POST_BLUR, { tex: { value: null }, dir: { value: new THREE.Vector2() } });
  P.final = mat(POST_FINAL, { scene: { value: null }, bloomA: { value: null }, bloomB: { value: null }, strength: { value: 0.8 },
    contrast: { value: 1.08 }, saturation: { value: 1.1 }, tint: { value: new THREE.Vector3(1, 1, 1) }, vignette: { value: 0.3 }, time: { value: 0 } });
  P.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), P.final);
  P.quad.frustumCulled = false;
  P.scene.add(P.quad);
  return P;
};

Renderer.prototype.resizePost = function () {
  const P = this.post, size = this.renderer.getDrawingBufferSize(this._postSize || (this._postSize = new THREE.Vector2()));
  const w = Math.max(1, size.x | 0), h = Math.max(1, size.y | 0);
  if (P.w === w && P.h === h) return;
  P.w = w; P.h = h;
  P.main.setSize(w, h);
  for (const t of P.half) t.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
  for (const t of P.quarter) t.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
};

// un passaggio a schermo intero con il materiale m verso target (null = schermo)
Renderer.prototype.postPass = function (m, target) {
  const P = this.post, r = this.renderer;
  P.quad.material = m;
  r.setRenderTarget(target);
  r.render(P.scene, P.camera);
};

Renderer.prototype.renderPost = function () {
  const r = this.renderer, P = this.buildPost();
  this.resizePost();
  const look = POST_LOOK[this.timeOfDay] || POST_LOOK.night;
  // 1. la scena (con la mappatura dei toni di sempre) nell'immagine fuori dallo schermo
  r.setRenderTarget(P.main);
  r.render(this.scene, this.camera);
  // 2. parti luminose a metà risoluzione, poi sfocate; una seconda volta a un quarto (bagliore largo)
  P.bright.uniforms.tex.value = P.main.texture;
  P.bright.uniforms.threshold.value = look.threshold;
  this.postPass(P.bright, P.half[0]);
  const blur = (pair, w, h) => {
    P.blur.uniforms.tex.value = pair[0].texture; P.blur.uniforms.dir.value.set(1 / w, 0); this.postPass(P.blur, pair[1]);
    P.blur.uniforms.tex.value = pair[1].texture; P.blur.uniforms.dir.value.set(0, 1 / h); this.postPass(P.blur, pair[0]);
  };
  blur(P.half, P.half[0].width, P.half[0].height);
  P.blur.uniforms.tex.value = P.half[0].texture; P.blur.uniforms.dir.value.set(0.5 / P.half[0].width, 0.5 / P.half[0].height);
  this.postPass(P.blur, P.quarter[0]);
  blur(P.quarter, P.quarter[0].width, P.quarter[0].height);
  blur(P.quarter, P.quarter[0].width / 2, P.quarter[0].height / 2);   // ancora più largo
  // 3. unione sullo schermo
  const u = P.final.uniforms;
  u.scene.value = P.main.texture; u.bloomA.value = P.half[0].texture; u.bloomB.value = P.quarter[0].texture;
  u.strength.value = look.strength * (this.Q.post || 1);
  u.contrast.value = look.contrast; u.saturation.value = look.saturation; u.tint.value.set(look.tint[0], look.tint[1], look.tint[2]);
  P.t = (P.t + 0.37) % 100; u.time.value = P.t;
  this.postPass(P.final, null);
};

Renderer.prototype.disposePost = function () {
  const P = this.post;
  if (!P) return;
  P.main.dispose();
  for (const t of P.half.concat(P.quarter)) t.dispose();
  for (const m of [P.bright, P.blur, P.final]) m.dispose();
  P.quad.geometry.dispose();
  this.post = null;
};
