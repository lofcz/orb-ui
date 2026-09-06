import { useEffect, useLayoutEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import type {
  OrbHtmlAttributes,
  OrbPalette,
  OrbScheme,
  OrbState,
} from '../../components/Orb/Orb.types'

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

interface OceanThemeProps extends OrbHtmlAttributes {
  state: OrbState
  volume: number
  size: number
  scheme?: OrbScheme
  palette?: OrbPalette
  className?: string
  style?: CSSProperties
  disabled?: boolean
  interactive?: boolean
  onClick?: () => void
}

interface OceanMotion {
  time: number
  level: number
  swell: number
  ripple: number
  glow: number
  tilt: number
  listen: number
  speak: number
  /** The voice's slow envelope, 0–1: the tide the sea follows while she speaks. */
  surge: number
  /** How hard the water works while she thinks, 0–1: brighter caustics and a light that wanders through the depth. */
  churn: number
}

interface OceanRenderer {
  draw(motion: OceanMotion): void
  destroy(): void
}

type Rgb = [number, number, number]

interface ResolvedOceanPalette {
  deep: Rgb
  shallow: Rgb
  foam: Rgb
  glow: Rgb
  sky: Rgb
  horizon: Rgb
}

export const OCEAN_PALETTES: Record<OrbScheme, Required<OrbPalette>> = {
  light: {
    deep: '#0b4068',
    shallow: '#43adca',
    foam: '#f6fcfe',
    glow: '#ffe4b3',
    sky: '#d9ebf4',
    horizon: '#a6d6e5',
  },
  dark: {
    deep: '#05182b',
    shallow: '#1f7a9c',
    foam: '#d6f0f8',
    glow: '#b4dcff',
    sky: '#0b1a2b',
    horizon: '#1c4661',
  },
}

const VERTEX_SHADER = `
attribute vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_level;
uniform float u_swell;
uniform float u_ripple;
uniform float u_glow;
uniform float u_tilt;
uniform float u_listen;
uniform float u_speak;
uniform float u_surge;
uniform float u_churn;
uniform vec3 u_deep;
uniform vec3 u_shallow;
uniform vec3 u_foam;
uniform vec3 u_light;
uniform vec3 u_sky;
uniform vec3 u_horizon;

float swellHeight(float x, float t, float swell) {
  return swell * (
    sin(x * 2.1 + t * 0.9) +
    0.55 * sin(x * 3.7 - t * 0.63 + 1.3) +
    0.3 * sin(x * 6.3 + t * 1.21 + 2.1)
  );
}

float rippleHeight(float x, float t, float ripple) {
  return ripple * 0.04 * sin(x * 12.0 - t * 5.2) * sin(x * 7.5 + t * 3.7)
    + ripple * 0.012 * sin(x * 19.0 + t * 7.9);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = (uv - 0.5) * 2.0;
  float radius = length(p);
  float edge = 1.0 - smoothstep(0.985, 1.0, radius);

  if (edge <= 0.0) discard;

  float z = sqrt(max(0.0, 1.0 - radius * radius));
  vec3 normal = vec3(p, z);

  // The water sits behind a curved glass front: coordinates bend toward the
  // centre near the rim, so the sea reads as inside a sphere, not painted on.
  vec2 q = p * (1.0 - 0.22 * (1.0 - z));
  float c = cos(u_tilt);
  float s = sin(u_tilt);
  q = vec2(q.x * c - q.y * s, q.x * s + q.y * c);

  float t = u_time;
  float front = swellHeight(q.x, t, u_swell) + rippleHeight(q.x, t, u_ripple);
  // The voice is a tide, not a tremor: while she speaks the water rises a little
  // in the middle of the orb and rolls in slow, rounder swells.
  float column = exp(-q.x * q.x * 2.4);
  float voice = u_surge * 0.05 * column + u_surge * 0.015 * sin(q.x * 2.6 - t * 0.9 + 0.4);
  front += voice;
  float waterline = u_level + front;
  float d = q.y - waterline;
  float depth = max(0.0, -d);

  // A second, slower swell further back gives the water a body to look into.
  float back = swellHeight(q.x * 0.8 + 1.7, t * 0.72, u_swell * 0.8);
  float backline = u_level - 0.16 + back;
  float backBand = 1.0 - smoothstep(0.0, 0.06, abs(q.y - backline));

  vec3 water = mix(u_shallow, u_deep, smoothstep(0.0, 1.05 + u_speak * 0.6, depth));
  water = mix(water, u_shallow * 1.3, u_surge * 0.18 * exp(-depth * 1.8));
  float caustic = sin(q.x * 6.0 + front * 4.0 + t * 0.8) * sin(q.y * 5.0 - t * 0.6 + q.x * 1.5);
  caustic = pow(max(caustic, 0.0), 3.0) * exp(-depth * 1.6) * (0.28 + u_glow * 0.45 + u_surge * 0.2 + u_churn * 0.4);
  water = mix(water, u_shallow * 1.25, caustic);
  float shaft = pow(max(sin(q.x * 3.0 + t * 0.27), 0.0), 5.0) * exp(-depth * 2.2);
  water = mix(water, u_light, shaft * 0.08 * (0.4 + u_glow));
  // Thought: a slow light wanders through the depth, crossing the water on a
  // diagonal and turning as it goes, as if something below were being turned over.
  float wander = sin(q.x * 2.2 + q.y * 1.6 + t * 1.9) * sin(q.x * 1.3 - q.y * 2.4 - t * 1.1 + 0.8);
  float thought = pow(max(wander, 0.0), 4.0) * exp(-depth * 1.2) * u_churn;
  water = mix(water, u_light, thought * 0.2);
  water = mix(water, u_shallow * 1.35, thought * 0.25);
  water = mix(water, mix(u_shallow, u_foam, 0.3), backBand * 0.14 * step(0.0, -d));
  water = mix(water, u_deep, exp(-depth * 24.0) * 0.18);

  vec3 air = mix(u_horizon, u_sky, smoothstep(0.0, 0.85, d));
  float sun = exp(-length(q - vec2(-0.36, 0.58)) * 3.1);
  air = mix(air, u_light, sun * (0.22 + u_glow * 0.36));
  air = mix(air, u_light, exp(-max(d, 0.0) * 6.0) * 0.1 * u_glow);

  vec3 color = d < 0.0 ? water : air;


  float foamWidth = 30.0 - u_surge * 8.0;
  float foam = exp(-abs(d) * foamWidth) * (0.6 + u_surge * 0.3 + u_listen * 0.35);
  float crest = smoothstep(0.35, 1.0, front / max(u_swell * 1.85, 0.001));
  foam += crest * exp(-abs(d) * 16.0) * (0.22 + u_speak * 0.3);
  color = mix(color, u_foam, clamp(foam, 0.0, 0.92));

  // Glass: a Fresnel rim, one soft specular, and a little weight at the bottom.
  float fresnel = pow(1.0 - z, 2.8);
  color = mix(color, mix(u_foam, u_light, 0.5), fresnel * 0.32);
  vec3 lightDir = normalize(vec3(-0.48, 0.7, 0.54));
  float spec = pow(max(dot(normal, lightDir), 0.0), 48.0);
  color = mix(color, vec3(1.0), spec * 0.4);
  color *= 1.0 - 0.18 * smoothstep(0.1, 1.0, -p.y) * (1.0 - z * 0.6);

  // The drawing buffer uses premultiplied alpha. Premultiply the antialiased
  // perimeter so translucent edge pixels cannot become a bright outline.
  gl_FragColor = vec4(color * edge, edge);
}
`

const ARTWORK_DIAMETER = 0.72

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function damp(current: number, target: number, rate: number, deltaSeconds: number) {
  return current + (target - current) * (1 - Math.exp(-rate * deltaSeconds))
}

function hexToRgb(hex: string, fallback: Rgb): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return fallback
  const value = parseInt(match[1], 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

function mixRgb(a: Rgb, b: Rgb, amount: number): Rgb {
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ]
}

function rgbToCss([r, g, b]: Rgb, alpha: number) {
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`
}

export function resolveOceanPalette(
  scheme: OrbScheme,
  palette: OrbPalette | undefined,
): ResolvedOceanPalette {
  const base = OCEAN_PALETTES[scheme]
  const pick = (key: keyof OrbPalette): Rgb => {
    const fallback = hexToRgb(base[key], [0, 0, 0])
    const override = palette?.[key]
    return override ? hexToRgb(override, fallback) : fallback
  }
  return {
    deep: pick('deep'),
    shallow: pick('shallow'),
    foam: pick('foam'),
    glow: pick('glow'),
    sky: pick('sky'),
    horizon: pick('horizon'),
  }
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | undefined {
  const shader = gl.createShader(type)
  if (!shader) return undefined

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return undefined
  }

  return shader
}

function createOceanRenderer(
  canvas: HTMLCanvasElement,
  diameter: number,
  palette: ResolvedOceanPalette,
): OceanRenderer | undefined {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
  })
  if (!gl) return undefined

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  if (!vertexShader || !fragmentShader) {
    if (vertexShader) gl.deleteShader(vertexShader)
    if (fragmentShader) gl.deleteShader(fragmentShader)
    return undefined
  }

  const program = gl.createProgram()
  const buffer = gl.createBuffer()
  if (!program || !buffer) {
    if (program) gl.deleteProgram(program)
    if (buffer) gl.deleteBuffer(buffer)
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    return undefined
  }

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    gl.deleteBuffer(buffer)
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    return undefined
  }

  const destroy = () => {
    gl.deleteProgram(program)
    gl.deleteBuffer(buffer)
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
  }

  const positionLocation = gl.getAttribLocation(program, 'a_position')
  const uniform = (name: string) => gl.getUniformLocation(program, name)
  const locations = {
    resolution: uniform('u_resolution'),
    time: uniform('u_time'),
    level: uniform('u_level'),
    swell: uniform('u_swell'),
    ripple: uniform('u_ripple'),
    glow: uniform('u_glow'),
    tilt: uniform('u_tilt'),
    listen: uniform('u_listen'),
    speak: uniform('u_speak'),
    surge: uniform('u_surge'),
    churn: uniform('u_churn'),
    deep: uniform('u_deep'),
    shallow: uniform('u_shallow'),
    foam: uniform('u_foam'),
    light: uniform('u_light'),
    sky: uniform('u_sky'),
    horizon: uniform('u_horizon'),
  }

  if (positionLocation < 0 || Object.values(locations).some((location) => !location)) {
    destroy()
    return undefined
  }

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  const pixelSize = Math.max(1, Math.round(diameter * pixelRatio))
  canvas.width = pixelSize
  canvas.height = pixelSize

  gl.viewport(0, 0, pixelSize, pixelSize)
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  )
  gl.enableVertexAttribArray(positionLocation)
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)
  gl.uniform2f(locations.resolution, pixelSize, pixelSize)
  gl.uniform3fv(locations.deep, palette.deep)
  gl.uniform3fv(locations.shallow, palette.shallow)
  gl.uniform3fv(locations.foam, palette.foam)
  gl.uniform3fv(locations.light, palette.glow)
  gl.uniform3fv(locations.sky, palette.sky)
  gl.uniform3fv(locations.horizon, palette.horizon)

  return {
    draw(motion) {
      gl.uniform1f(locations.time, motion.time)
      gl.uniform1f(locations.level, motion.level)
      gl.uniform1f(locations.swell, motion.swell)
      gl.uniform1f(locations.ripple, motion.ripple)
      gl.uniform1f(locations.glow, motion.glow)
      gl.uniform1f(locations.tilt, motion.tilt)
      gl.uniform1f(locations.listen, motion.listen)
      gl.uniform1f(locations.speak, motion.speak)
      gl.uniform1f(locations.surge, motion.surge)
      gl.uniform1f(locations.churn, motion.churn)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    },
    destroy,
  }
}

interface StateTargets {
  swell: number
  speed: number
  glow: number
  tiltAmplitude: number
  levelOffset: number
  /** Brightness of the corona that surrounds the orb, 0–1. */
  corona: number
  /** How far the corona reaches past the rim, in radii. */
  reach: number
  /** Seconds between emitted rings; 0 emits none. */
  ringEvery: number
  /** Strength of an emitted ring, 0–1. */
  ringStrength: number
  /** Rings roll out from the rim while talking and gather in while listening. */
  ringInward: boolean
  /** Visibility of the orbiting sparks, 0–1. */
  orbit: number
  /** Visibility of the sweeping arc, 0–1. */
  sweep: number
  /** Slow whole-body pulse that says "alive" when the water alone is too quiet. */
  pulse: number
  /** How fast the pulse beats, as a multiple of the resting rate. */
  pulseRate: number
  /** How hard the water works, 0–1: only thought stirs it. */
  churn: number
}

/**
 * Each state sets where the sea wants to be; the frame loop eases toward it,
 * so a change of state alters the weather without cutting to a new scene.
 * Breathing (the slow rise and fall of the waterline) never stops, because it
 * is the thing that makes the orb feel alive while nobody is talking.
 */
function resolveTargets(
  state: OrbState,
  listen: number,
  speak: number,
  clock: number,
): StateTargets {
  switch (state) {
    case 'connecting':
      return {
        swell: 0.03,
        speed: 0.32,
        glow: 0.3 + 0.2 * Math.sin(clock * 2.6),
        tiltAmplitude: 0.02,
        levelOffset: 0,
        corona: 0.3 + 0.1 * Math.sin(clock * 2.6),
        reach: 0.24,
        ringEvery: 0,
        ringStrength: 0,
        ringInward: false,
        orbit: 0,
        sweep: 1,
        pulse: 0.5,
        pulseRate: 1,
        churn: 0,
      }
    case 'listening':
      // Attention is the room's: the water quickens, rises and brightens with
      // the voice it hears, and the rings gather in faster the more is said.
      return {
        swell: 0.045 + listen * 0.055,
        speed: 0.45 + listen * 0.55,
        glow: 0.44 + listen * 0.55,
        tiltAmplitude: 0.03 + listen * 0.02,
        levelOffset: listen * 0.09,
        corona: 0.38 + listen * 0.45,
        reach: 0.24 + listen * 0.16,
        ringEvery: Math.max(0.45, 1.4 - listen * 1.0),
        ringStrength: 0.3 + listen * 0.5,
        ringInward: true,
        orbit: 0,
        sweep: 0,
        pulse: 0.3,
        pulseRate: 1,
        churn: 0,
      }
    case 'thinking':
      // Thought is visibly work: the sea runs quicker and tips further as it
      // weighs things, a light wanders through the depth, sparks circle faster
      // and the whole body beats quicker and deeper.
      return {
        swell: 0.06,
        speed: 1.0,
        glow: 0.52 + 0.16 * Math.sin(clock * 2.2),
        tiltAmplitude: 0.075,
        levelOffset: 0.015,
        corona: 0.42 + 0.14 * Math.sin(clock * 2.2),
        reach: 0.32,
        ringEvery: 0,
        ringStrength: 0,
        ringInward: true,
        orbit: 1,
        sweep: 0.4,
        pulse: 1,
        pulseRate: 1.8,
        churn: 1,
      }
    case 'speaking':
      return {
        swell: 0.055 + speak * 0.045,
        speed: 0.5 + speak * 0.25,
        glow: 0.55 + speak * 0.3,
        tiltAmplitude: 0.035,
        levelOffset: 0.02 + speak * 0.05,
        corona: 0.45 + speak * 0.3,
        reach: 0.24 + speak * 0.1,
        ringEvery: 0,
        ringStrength: 0.3,
        ringInward: false,
        orbit: 0,
        sweep: 0,
        pulse: 0.2,
        pulseRate: 1,
        churn: 0,
      }
    case 'error':
      return {
        swell: 0.02,
        speed: 0.2,
        glow: 0.06,
        tiltAmplitude: 0.01,
        levelOffset: -0.04,
        corona: 0.08,
        reach: 0.15,
        ringEvery: 0,
        ringStrength: 0,
        ringInward: false,
        orbit: 0,
        sweep: 0,
        pulse: 0,
        pulseRate: 1,
        churn: 0,
      }
    case 'idle':
    default:
      return {
        swell: 0.036,
        speed: 0.36,
        glow: 0.28,
        tiltAmplitude: 0.028,
        levelOffset: 0,
        corona: 0.3,
        reach: 0.22,
        ringEvery: 6,
        ringStrength: 0.25,
        ringInward: false,
        orbit: 0,
        sweep: 0,
        pulse: 0.35,
        pulseRate: 1,
        churn: 0,
      }
  }
}

const BASE_LEVEL = 0.1
const BREATH_PERIOD_SECONDS = 7.5
const PULSE_PERIOD_SECONDS = 3.2
/** The listening level at which a voice counts as having started. */
const LISTEN_ONSET = 0.14
/**
 * Overdamped spring with a time constant near half a second: the water inside
 * follows the mouth over whole phrases, never over single words.
 */
const SURGE_STIFFNESS = 14
const SURGE_DAMPING = 8
/**
 * The aura canvas is this many artwork diameters wide. Everything drawn on it
 * stays within about a third of a radius of the rim, so nothing reaches the
 * text that sits under the orb.
 */
const AURA_SCALE = 1.7
const RING_TRAVEL_RADII = 0.3
const RING_LIFE_SECONDS = 2.2
const ORBITER_COUNT = 3
/**
 * The mouth is prosody, not a meter. A voice's loudness barely changes across
 * a sentence, and a mouth that flicks open and shut on every syllable reads
 * as a tremor from across the room; what a listener sees in a speaker is the
 * slow swell of phrases and the odd stressed word. So while the state is
 * `speaking` the orb breathes on a band-limited modulation: two octaves of
 * smooth noise, none of it faster than about a hertz, under a phrase-long
 * envelope, with a stressed word lifting it every few seconds. Nothing in it
 * has a corner, so nothing ever snaps.
 */
const PROSODY_BASE_HZ = 0.5
const PROSODY_DETAIL_HZ = 1.1
const PROSODY_DETAIL_WEIGHT = 0.4
const PHRASE_HZ = 0.16
const STRESS_MIN_SECONDS = 2.4
const STRESS_SPAN_SECONDS = 3.6
const STRESS_SECONDS = 1.1
const STRESS_LIFT = 0.4
const MOUTH_FOLLOW = 6
const MOUTH_FOLLOW_REST = 3.5
/** The orb grows this much of its diameter when fully open. */
const MOUTH_OPEN_SCALE = 0.09

interface Articulation {
  open: number
  clock: number
  seed: number
  phrasePhase: number
  untilStress: number
  stressAt: number
  stressBegan: boolean
}

function createArticulation(): Articulation {
  return {
    open: 0,
    clock: 0,
    seed: Math.random() * 1000,
    phrasePhase: Math.random() * Math.PI * 2,
    untilStress: STRESS_MIN_SECONDS + Math.random() * STRESS_SPAN_SECONDS,
    stressAt: -Infinity,
    stressBegan: false,
  }
}

/** A repeatable 0–1 for every integer, so the noise below is a curve and not a coin toss per frame. */
function lattice(index: number, seed: number): number {
  const x = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** Smooth value noise in 0–1: random points a period apart, joined without a kink. */
function smoothNoise(time: number, hz: number, seed: number): number {
  const position = time * hz
  const index = Math.floor(position)
  const fraction = position - index
  const eased = fraction * fraction * fraction * (fraction * (fraction * 6 - 15) + 10)
  return lattice(index, seed) * (1 - eased) + lattice(index + 1, seed) * eased
}

/**
 * Advances the mouth by one frame. Returns true on the frame a stressed word
 * begins, which is what the speaking rings are timed to.
 */
function articulate(mouth: Articulation, speaking: boolean, deltaSeconds: number): boolean {
  mouth.stressBegan = false
  if (!speaking) {
    mouth.open = damp(mouth.open, 0, MOUTH_FOLLOW_REST, deltaSeconds)
    return false
  }
  mouth.clock += deltaSeconds
  mouth.untilStress -= deltaSeconds
  if (mouth.untilStress <= 0) {
    mouth.stressAt = mouth.clock
    mouth.stressBegan = true
    mouth.untilStress = STRESS_MIN_SECONDS + Math.random() * STRESS_SPAN_SECONDS
  }

  const base = smoothNoise(mouth.clock, PROSODY_BASE_HZ, mouth.seed)
  const detail = smoothNoise(mouth.clock, PROSODY_DETAIL_HZ, mouth.seed + 1)
  const texture = (base + detail * PROSODY_DETAIL_WEIGHT) / (1 + PROSODY_DETAIL_WEIGHT)
  const phrase =
    0.55 + 0.45 * (0.5 + 0.5 * Math.sin(mouth.clock * Math.PI * 2 * PHRASE_HZ + mouth.phrasePhase))
  const sinceStress = (mouth.clock - mouth.stressAt) / STRESS_SECONDS
  const stress = sinceStress < 1 ? 0.5 - 0.5 * Math.cos(sinceStress * Math.PI * 2) : 0
  const target = clamp(phrase * (0.15 + 0.85 * texture) + stress * STRESS_LIFT)

  mouth.open = damp(mouth.open, target, MOUTH_FOLLOW, deltaSeconds)
  return mouth.stressBegan
}

interface AuraRing {
  born: number
  strength: number
  inward: boolean
}

interface Orbiter {
  angle: number
  speed: number
  radius: number
  size: number
  wobble: number
}

interface AuraMotion {
  time: number
  corona: number
  reach: number
  glow: number
  speak: number
  listen: number
  orbit: number
  sweep: number
  pulse: number
  breath: number
  rings: AuraRing[]
  orbiters: Orbiter[]
}

interface AuraRenderer {
  draw(motion: AuraMotion): void
}

function createOrbiters(): Orbiter[] {
  return Array.from({ length: ORBITER_COUNT }, (_, index) => ({
    angle: (index / ORBITER_COUNT) * Math.PI * 2,
    speed: (0.55 + (index % 3) * 0.2) * (index % 2 === 0 ? 1 : -1),
    radius: 1.12 + (index % 2) * 0.08,
    size: 0.016 + (index % 2) * 0.006,
    wobble: 0.7 + index * 0.37,
  }))
}

/**
 * Everything that happens outside the glass: the corona, the rings the voice
 * sends out or the ear draws in, the sparks that circle while the interviewer
 * thinks, and the arc that sweeps while it connects. Drawn on a plain 2D
 * canvas larger than the orb, so none of it is clipped at the rim.
 */
function createAuraRenderer(
  canvas: HTMLCanvasElement,
  diameter: number,
  palette: ResolvedOceanPalette,
  scheme: OrbScheme,
): AuraRenderer | undefined {
  const context = canvas.getContext('2d')
  if (!context) return undefined

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  const side = diameter * AURA_SCALE
  canvas.width = Math.max(1, Math.round(side * pixelRatio))
  canvas.height = canvas.width
  context.scale(pixelRatio, pixelRatio)

  const centre = side / 2
  const radius = diameter / 2
  // In the dark the glow colour alone burns white under additive blending, so
  // the corona leans on the water's own blue and keeps the pale glow for edges.
  const accent: Rgb =
    scheme === 'dark' ? mixRgb(palette.shallow, palette.glow, 0.35) : palette.shallow
  const light: Rgb = scheme === 'dark' ? mixRgb(palette.glow, palette.foam, 0.4) : palette.deep
  const deep: Rgb = scheme === 'dark' ? palette.shallow : palette.deep
  const lineAlpha = scheme === 'dark' ? 1 : 0.75

  const circle = (x: number, y: number, r: number) => {
    context.beginPath()
    context.arc(x, y, r, 0, Math.PI * 2)
  }

  return {
    draw(motion) {
      context.clearRect(0, 0, side, side)
      context.globalCompositeOperation = scheme === 'dark' ? 'lighter' : 'source-over'

      // Corona: the light the orb throws on the room. It reaches further and
      // burns brighter with the voice, and breathes even when nothing else moves.
      const reach =
        radius * (1 + motion.reach + motion.pulse * 0.03 + Math.sin(motion.breath) * 0.015)
      const coronaAlpha = clamp(motion.corona * (scheme === 'dark' ? 0.55 : 0.5))
      const corona = context.createRadialGradient(
        centre,
        centre,
        radius * 0.9,
        centre,
        centre,
        reach,
      )
      corona.addColorStop(0, rgbToCss(accent, coronaAlpha))
      corona.addColorStop(0.3, rgbToCss(accent, coronaAlpha * 0.5))
      corona.addColorStop(0.65, rgbToCss(accent, coronaAlpha * 0.15))
      corona.addColorStop(1, rgbToCss(accent, 0))
      context.fillStyle = corona
      circle(centre, centre, reach)
      context.fill()

      // A hotter core to the corona that only the voice brings out.
      const voice = clamp(motion.speak + motion.listen * 0.6)
      if (voice > 0.01) {
        const coreReach = radius * (1.02 + voice * 0.5)
        const core = context.createRadialGradient(
          centre,
          centre,
          radius * 0.95,
          centre,
          centre,
          coreReach,
        )
        core.addColorStop(0, rgbToCss(accent, 0.35 * voice * lineAlpha))
        core.addColorStop(0.4, rgbToCss(light, 0.1 * voice * lineAlpha))
        core.addColorStop(1, rgbToCss(light, 0))
        context.fillStyle = core
        circle(centre, centre, coreReach)
        context.fill()
      }

      // Rim light: a bright band hugging the glass that flares with the voice.
      const rimAlpha = clamp(
        (0.3 + motion.glow * 0.35 + motion.speak * 0.2 + motion.listen * 0.25) * lineAlpha,
      )
      const rimReach = radius * (1.06 + motion.speak * 0.04)
      const rim = context.createRadialGradient(
        centre,
        centre,
        radius * 0.97,
        centre,
        centre,
        rimReach,
      )
      rim.addColorStop(0, rgbToCss(light, rimAlpha))
      rim.addColorStop(1, rgbToCss(light, 0))
      context.fillStyle = rim
      circle(centre, centre, radius * 1.15)
      context.fill()

      // Rings: born at the rim and travelling out (speaking), or born far out
      // and travelling in (listening), fading as they go.
      for (const ring of motion.rings) {
        const age = clamp((motion.time - ring.born) / RING_LIFE_SECONDS)
        const eased = 1 - Math.pow(1 - age, 2.2)
        const path = ring.inward ? 1 - eased : eased
        const ringRadius = radius * (1 + RING_TRAVEL_RADII * path)
        const fade = ring.inward
          ? Math.pow(1 - path, 0.6) * (1 - Math.pow(age, 4))
          : Math.pow(1 - age, 1.3)
        const alpha = clamp(fade * ring.strength)
        if (alpha < 0.005) continue
        const width = radius * (0.01 + ring.strength * 0.014) * (1 - path * 0.3)
        context.lineWidth = width * 4
        context.strokeStyle = rgbToCss(accent, alpha * 0.16)
        circle(centre, centre, ringRadius)
        context.stroke()
        context.lineWidth = width
        context.strokeStyle = rgbToCss(light, alpha * 0.4 * lineAlpha)
        circle(centre, centre, ringRadius)
        context.stroke()
      }

      // Orbiters: sparks that circle the orb while it thinks, each with a tail.
      if (motion.orbit > 0.01) {
        for (const orbiter of motion.orbiters) {
          const wobble = Math.sin(motion.time * orbiter.wobble) * 0.05
          const orbitRadius = radius * (orbiter.radius + wobble)
          const tail = 0.8 + motion.orbit * 0.7
          const direction = orbiter.speed > 0 ? 1 : -1
          const steps = 14
          for (let step = 0; step < steps; step += 1) {
            const back = (step / steps) * tail
            const angle = orbiter.angle - direction * back
            const x = centre + Math.cos(angle) * orbitRadius
            const y = centre + Math.sin(angle) * orbitRadius
            const strength = Math.pow(1 - step / steps, 2) * motion.orbit
            context.fillStyle = rgbToCss(
              step === 0 ? light : accent,
              clamp(strength * (step === 0 ? 1 : 0.7) * lineAlpha),
            )
            circle(x, y, radius * orbiter.size * (1 - (step / steps) * 0.7))
            context.fill()
          }
          const haloRadius = radius * orbiter.size * 5
          const x = centre + Math.cos(orbiter.angle) * orbitRadius
          const y = centre + Math.sin(orbiter.angle) * orbitRadius
          const sparkHalo = context.createRadialGradient(x, y, 0, x, y, haloRadius)
          sparkHalo.addColorStop(0, rgbToCss(accent, 0.35 * motion.orbit))
          sparkHalo.addColorStop(1, rgbToCss(accent, 0))
          context.fillStyle = sparkHalo
          circle(x, y, haloRadius)
          context.fill()
        }
      }

      // Sweep: the arc that circles while a connection is being made.
      if (motion.sweep > 0.01) {
        const arcs = [
          {
            orbitRadius: radius * 1.12,
            start: motion.time * 2.0,
            span: Math.PI * 0.55,
            width: 0.025,
          },
        ]
        for (const { orbitRadius, start, span, width } of arcs) {
          const arc = context.createConicGradient(start, centre, centre)
          arc.addColorStop(0, rgbToCss(light, 0))
          arc.addColorStop(span / (Math.PI * 2), rgbToCss(light, 0.7 * motion.sweep * lineAlpha))
          arc.addColorStop(span / (Math.PI * 2) + 0.001, rgbToCss(light, 0))
          arc.addColorStop(1, rgbToCss(light, 0))
          context.lineWidth = radius * width
          context.strokeStyle = arc
          context.beginPath()
          context.arc(centre, centre, orbitRadius, start, start + span)
          context.stroke()
          context.lineWidth = radius * 0.01
          context.strokeStyle = rgbToCss(deep, 0.2 * motion.sweep * lineAlpha)
          circle(centre, centre, orbitRadius)
          context.stroke()
        }
      }
    },
  }
}

export function OceanTheme({
  state,
  volume,
  size,
  scheme = 'light',
  palette,
  className,
  style,
  disabled = false,
  interactive = false,
  onClick,
  ...controlProps
}: OceanThemeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const auraRef = useRef<HTMLCanvasElement>(null)
  const bodyRef = useRef<HTMLSpanElement>(null)
  const stateRef = useRef(state)
  const volumeRef = useRef(volume)
  const reducedMotionRef = useRef(false)

  useIsomorphicLayoutEffect(() => {
    stateRef.current = state
    volumeRef.current = volume
  }, [state, volume])

  const diameter = size * ARTWORK_DIAMETER
  const resolved = resolveOceanPalette(scheme, palette)
  // Compared by value so a re-created palette object does not rebuild the
  // WebGL program on every render.
  const paletteKey = JSON.stringify(resolved)

  useEffect(() => {
    const canvas = canvasRef.current
    const auraCanvas = auraRef.current
    const body = bodyRef.current
    if (!canvas || !auraCanvas || !body) return

    const colors = JSON.parse(paletteKey) as ResolvedOceanPalette
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updateReducedMotion = () => {
      reducedMotionRef.current = motionQuery.matches
    }
    updateReducedMotion()
    motionQuery.addEventListener('change', updateReducedMotion)

    const renderer = createOceanRenderer(canvas, diameter, colors)
    if (!renderer) {
      canvas.style.background = `linear-gradient(180deg, ${rgbToCss(colors.sky, 1)} 0%, ${rgbToCss(colors.horizon, 1)} 44%, ${rgbToCss(colors.shallow, 1)} 48%, ${rgbToCss(colors.deep, 1)} 100%)`
    }
    const aura = createAuraRenderer(auraCanvas, diameter, colors, scheme)

    let frame = 0
    let previousTime = performance.now()
    let time = 0
    let clock = 0
    let breath = 0
    let tiltClock = 0
    let listen = 0
    let speak = 0
    let swell = 0.036
    let speed = 0.36
    let glow = 0.26
    let tiltAmplitude = 0.028
    let levelOffset = 0
    let corona = 0.3
    let reach = 0.24
    let orbit = 0
    let sweep = 0
    let pulseDepth = 0.3
    let pulseRate = 1
    let pulseClock = 0
    let churn = 0
    let heard = false
    let surge = 0
    let surgeVelocity = 0
    const articulation = createArticulation()
    let sinceRing = 0
    const rings: AuraRing[] = []
    const orbiters = createOrbiters()

    const render = (now: number) => {
      const deltaSeconds = Math.min((now - previousTime) / 1000, 0.05)
      previousTime = now

      const nextState = stateRef.current
      const reducedMotion = reducedMotionRef.current
      const rawVolume = clamp(volumeRef.current)

      const speaking = nextState === 'speaking' && !reducedMotion
      const stressBegan = articulate(articulation, speaking, deltaSeconds)
      const mouth = articulation.open
      // Listening follows the room's voice closely: the answer to being heard
      // has to come inside the word, not a second after it, so it takes the raw
      // level with a quick rise and a fall that lasts about as long as a breath.
      const listenTarget = nextState === 'listening' && !reducedMotion ? rawVolume : 0
      // How much the sea answers the voice is the state's, not the meter's:
      // it settles at a steady murmur while she talks and the mouth on top of
      // it carries the words.
      const speakTarget = speaking ? 0.45 + mouth * 0.35 : 0
      listen = damp(listen, listenTarget, listenTarget > listen ? 10 : 2.2, deltaSeconds)
      speak = damp(speak, speakTarget, speakTarget > speak ? 3 : 1.5, deltaSeconds)

      clock += deltaSeconds
      const targets = resolveTargets(nextState, listen, speak, clock)
      swell = damp(swell, targets.swell, 2.4, deltaSeconds)
      speed = damp(speed, targets.speed, 2.4, deltaSeconds)
      glow = damp(glow, targets.glow, 3.2, deltaSeconds)
      tiltAmplitude = damp(tiltAmplitude, targets.tiltAmplitude, 1.8, deltaSeconds)
      levelOffset = damp(levelOffset, targets.levelOffset, 3, deltaSeconds)
      corona = damp(corona, targets.corona, targets.corona > corona ? 6 : 2.5, deltaSeconds)
      reach = damp(reach, targets.reach, targets.reach > reach ? 7 : 2.5, deltaSeconds)
      orbit = damp(orbit, targets.orbit, 3, deltaSeconds)
      sweep = damp(sweep, targets.sweep, 3, deltaSeconds)
      pulseDepth = damp(pulseDepth, targets.pulse, 2.5, deltaSeconds)
      pulseRate = damp(pulseRate, targets.pulseRate, 2, deltaSeconds)
      churn = damp(churn, targets.churn, targets.churn > churn ? 1.6 : 2.5, deltaSeconds)

      // The water inside lifts with the mouth through a soft spring, so the
      // sea swells a beat behind each word rather than jumping with it.
      const surgeTarget = speaking ? 0.25 + mouth * 0.5 : 0
      surgeVelocity += (surgeTarget - surge) * SURGE_STIFFNESS * deltaSeconds
      surgeVelocity *= Math.exp(-SURGE_DAMPING * deltaSeconds)
      surge += surgeVelocity * deltaSeconds

      if (!reducedMotion) {
        time += deltaSeconds * speed
        breath += (deltaSeconds * Math.PI * 2) / BREATH_PERIOD_SECONDS
        tiltClock += deltaSeconds * 0.31
        pulseClock += (deltaSeconds * Math.PI * 2 * pulseRate) / PULSE_PERIOD_SECONDS
        for (const orbiter of orbiters) {
          orbiter.angle += deltaSeconds * orbiter.speed * (0.6 + orbit * 1.5)
        }
        // Rings: while speaking, one soft breath from the rim as a stressed
        // word begins, at most one a second; otherwise on the cadence the state sets.
        sinceRing += deltaSeconds
        if (speaking) {
          if (stressBegan && sinceRing >= 1) {
            sinceRing = 0
            rings.push({ born: clock, strength: targets.ringStrength, inward: false })
          }
        } else {
          // The moment a voice starts, a ring gathers in at once: being heard
          // is answered before the cadence has had time to.
          const hearing = nextState === 'listening' && listen > LISTEN_ONSET
          if (hearing && !heard && sinceRing >= 0.25) {
            sinceRing = 0
            rings.push({ born: clock, strength: 0.7, inward: true })
          }
          heard = hearing
          const emitting = targets.ringEvery > 0 && (nextState !== 'listening' || listen > 0.03)
          if (emitting && sinceRing >= targets.ringEvery) {
            sinceRing = 0
            rings.push({ born: clock, strength: targets.ringStrength, inward: targets.ringInward })
          }
        }
        while (rings.length > 0 && clock - rings[0].born > RING_LIFE_SECONDS) rings.shift()
      }

      const level = BASE_LEVEL + levelOffset + Math.sin(breath) * 0.022
      const tilt = Math.sin(tiltClock) * tiltAmplitude + Math.sin(tiltClock * 2.3 + 0.7) * 0.006

      const elastic = reducedMotion ? 0 : clamp(surge)

      renderer?.draw({
        time,
        level,
        swell: reducedMotion ? 0.012 : swell,
        ripple: reducedMotion ? 0 : listen,
        glow,
        tilt: reducedMotion ? 0 : tilt,
        listen,
        speak,
        surge: elastic,
        churn: reducedMotion ? 0 : churn,
      })

      // The body stays a circle. It swells and settles like a chest on the
      // prosody's own rhythm and otherwise beats slowly: a long rest and a
      // soft rise rather than a sine, the way a pulse is felt.
      const pulse = Math.pow(0.5 + 0.5 * Math.sin(pulseClock), 1.7) * pulseDepth
      const open = mouth * MOUTH_OPEN_SCALE
      // Listening leans in: the body swells and lifts a little toward the voice.
      const bodyScale =
        1 + pulse * (0.02 + churn * 0.01) + Math.sin(breath) * 0.005 + open + listen * 0.04
      const lift = listen * diameter * 0.012
      body.style.transform = reducedMotion ? 'none' : `translateY(${-lift}px) scale(${bodyScale})`

      aura?.draw({
        time: clock,
        corona: reducedMotion ? corona * 0.6 : corona + mouth * 0.2,
        reach,
        glow,
        speak: Math.max(speak, mouth * 0.8),
        listen,
        orbit: reducedMotion ? 0 : orbit,
        sweep: reducedMotion ? 0 : sweep,
        pulse,
        breath,
        rings: reducedMotion ? [] : rings,
        orbiters,
      })

      frame = requestAnimationFrame(render)
    }

    frame = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(frame)
      motionQuery.removeEventListener('change', updateReducedMotion)
      renderer?.destroy()
    }
  }, [diameter, paletteKey, scheme])

  const rootStyle: CSSProperties = {
    width: size,
    height: size,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    ...style,
  }

  const auraSide = diameter * AURA_SCALE

  const content = (
    <span
      ref={bodyRef}
      style={{
        position: 'relative',
        display: 'block',
        width: diameter,
        height: diameter,
        borderRadius: '50%',
        lineHeight: 0,
        cursor: interactive ? (disabled ? 'not-allowed' : 'pointer') : 'default',
        transformOrigin: 'center',
        willChange: 'transform',
      }}
    >
      <canvas
        ref={auraRef}
        aria-hidden="true"
        data-ocean-aura=""
        style={{
          position: 'absolute',
          left: (diameter - auraSide) / 2,
          top: (diameter - auraSide) / 2,
          display: 'block',
          width: auraSide,
          height: auraSide,
          pointerEvents: 'none',
        }}
      />
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-ocean-surface=""
        style={{
          position: 'absolute',
          inset: 0,
          display: 'block',
          width: diameter,
          height: diameter,
          borderRadius: '50%',
          boxShadow: `0 ${diameter * 0.06}px ${diameter * 0.22}px ${rgbToCss(resolved.deep, scheme === 'dark' ? 0.55 : 0.28)}`,
        }}
      />
    </span>
  )

  if (interactive) {
    return (
      <button
        {...controlProps}
        type="button"
        className={className}
        disabled={disabled}
        onClick={disabled ? undefined : onClick}
        style={{
          appearance: 'none',
          WebkitAppearance: 'none',
          border: 0,
          padding: 0,
          margin: 0,
          background: 'transparent',
          color: 'inherit',
          font: 'inherit',
          cursor: disabled ? 'not-allowed' : 'pointer',
          ...rootStyle,
        }}
      >
        {content}
      </button>
    )
  }

  return (
    <div {...controlProps} className={className} style={rootStyle}>
      {content}
    </div>
  )
}
