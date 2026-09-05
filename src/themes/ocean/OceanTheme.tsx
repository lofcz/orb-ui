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
  return ripple * 0.028 * sin(x * 12.0 - t * 5.2) * sin(x * 7.5 + t * 3.7);
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
  float waterline = u_level + front;
  float d = q.y - waterline;
  float depth = max(0.0, -d);

  // A second, slower swell further back gives the water a body to look into.
  float back = swellHeight(q.x * 0.8 + 1.7, t * 0.72, u_swell * 0.8);
  float backline = u_level - 0.16 + back;
  float backBand = 1.0 - smoothstep(0.0, 0.06, abs(q.y - backline));

  vec3 water = mix(u_shallow, u_deep, smoothstep(0.0, 1.05, depth));
  float caustic = sin(q.x * 6.0 + front * 4.0 + t * 0.8) * sin(q.y * 5.0 - t * 0.6 + q.x * 1.5);
  caustic = pow(max(caustic, 0.0), 3.0) * exp(-depth * 1.6) * (0.28 + u_glow * 0.45);
  water = mix(water, u_shallow * 1.25, caustic);
  float shaft = pow(max(sin(q.x * 3.0 + t * 0.27), 0.0), 5.0) * exp(-depth * 2.2);
  water = mix(water, u_light, shaft * 0.08 * (0.4 + u_glow));
  water = mix(water, mix(u_shallow, u_foam, 0.3), backBand * 0.14 * step(0.0, -d));
  water = mix(water, u_deep, exp(-depth * 24.0) * 0.18);

  vec3 air = mix(u_horizon, u_sky, smoothstep(0.0, 0.85, d));
  float sun = exp(-length(q - vec2(-0.36, 0.58)) * 3.1);
  air = mix(air, u_light, sun * (0.22 + u_glow * 0.36));
  air = mix(air, u_light, exp(-max(d, 0.0) * 6.0) * 0.1 * u_glow);

  vec3 color = d < 0.0 ? water : air;

  float foamWidth = 30.0 - u_speak * 10.0;
  float foam = exp(-abs(d) * foamWidth) * (0.6 + u_speak * 0.35 + u_listen * 0.2);
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
        glow: 0.28 + 0.16 * Math.sin(clock * 2.6),
        tiltAmplitude: 0.02,
        levelOffset: 0,
      }
    case 'listening':
      return {
        swell: 0.045 + listen * 0.02,
        speed: 0.5 + listen * 0.25,
        glow: 0.36 + listen * 0.3,
        tiltAmplitude: 0.03,
        levelOffset: listen * 0.03,
      }
    case 'thinking':
      return {
        swell: 0.05,
        speed: 0.58,
        glow: 0.5 + 0.2 * Math.sin(clock * 2.4),
        tiltAmplitude: 0.055,
        levelOffset: 0.01,
      }
    case 'speaking':
      return {
        swell: 0.06 + speak * 0.09,
        speed: 0.82 + speak * 0.7,
        glow: 0.52 + speak * 0.42,
        tiltAmplitude: 0.035,
        levelOffset: 0.02 + speak * 0.03,
      }
    case 'error':
      return { swell: 0.02, speed: 0.2, glow: 0.06, tiltAmplitude: 0.01, levelOffset: -0.04 }
    case 'idle':
    default:
      return { swell: 0.036, speed: 0.36, glow: 0.26, tiltAmplitude: 0.028, levelOffset: 0 }
  }
}

const BASE_LEVEL = 0.1
const BREATH_PERIOD_SECONDS = 7.5

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
  const haloRef = useRef<HTMLSpanElement>(null)
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
    const halo = haloRef.current
    if (!canvas || !halo) return

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

    let frame = 0
    let previousTime = performance.now()
    let time = 0
    let clock = 0
    let breath = 0
    let tiltClock = 0
    let currentVolume = clamp(volumeRef.current)
    let listen = 0
    let speak = 0
    let swell = 0.036
    let speed = 0.36
    let glow = 0.26
    let tiltAmplitude = 0.028
    let levelOffset = 0
    let haloOpacity = 0.3

    const render = (now: number) => {
      const deltaSeconds = Math.min((now - previousTime) / 1000, 0.05)
      previousTime = now

      const nextState = stateRef.current
      const reducedMotion = reducedMotionRef.current
      const rawVolume = clamp(volumeRef.current)
      currentVolume = reducedMotion
        ? 0
        : damp(currentVolume, rawVolume, rawVolume > currentVolume ? 14 : 6, deltaSeconds)

      const listenTarget = nextState === 'listening' ? currentVolume : 0
      const speakTarget = nextState === 'speaking' ? currentVolume : 0
      listen = damp(listen, listenTarget, listenTarget > listen ? 16 : 6, deltaSeconds)
      speak = damp(speak, speakTarget, speakTarget > speak ? 11 : 4.5, deltaSeconds)

      clock += deltaSeconds
      const targets = resolveTargets(nextState, listen, speak, clock)
      swell = damp(swell, targets.swell, 2.4, deltaSeconds)
      speed = damp(speed, targets.speed, 2.4, deltaSeconds)
      glow = damp(glow, targets.glow, 3.2, deltaSeconds)
      tiltAmplitude = damp(tiltAmplitude, targets.tiltAmplitude, 1.8, deltaSeconds)
      levelOffset = damp(levelOffset, targets.levelOffset, 3, deltaSeconds)

      if (!reducedMotion) {
        time += deltaSeconds * speed
        breath += (deltaSeconds * Math.PI * 2) / BREATH_PERIOD_SECONDS
        tiltClock += deltaSeconds * 0.31
      }

      const level = BASE_LEVEL + levelOffset + Math.sin(breath) * 0.022
      const tilt = Math.sin(tiltClock) * tiltAmplitude + Math.sin(tiltClock * 2.3 + 0.7) * 0.006

      renderer?.draw({
        time,
        level,
        swell: reducedMotion ? 0.012 : swell,
        ripple: reducedMotion ? 0 : listen,
        glow,
        tilt: reducedMotion ? 0 : tilt,
        listen,
        speak,
      })

      const haloTarget = nextState === 'error' ? 0.08 : 0.28 + glow * 0.3 + speak * 0.35
      haloOpacity = damp(haloOpacity, haloTarget, 4, deltaSeconds)
      halo.style.opacity = String(haloOpacity)
      halo.style.transform = `scale(${1 + speak * 0.08 + Math.sin(breath) * 0.015})`

      frame = requestAnimationFrame(render)
    }

    frame = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(frame)
      motionQuery.removeEventListener('change', updateReducedMotion)
      renderer?.destroy()
    }
  }, [diameter, paletteKey])

  const rootStyle: CSSProperties = {
    width: size,
    height: size,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    ...style,
  }

  const content = (
    <span
      style={{
        position: 'relative',
        display: 'block',
        width: diameter,
        height: diameter,
        borderRadius: '50%',
        lineHeight: 0,
        cursor: interactive ? (disabled ? 'not-allowed' : 'pointer') : 'default',
      }}
    >
      <span
        ref={haloRef}
        data-ocean-halo=""
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: `-${diameter * 0.28}px`,
          display: 'block',
          borderRadius: '50%',
          background: `radial-gradient(circle, ${rgbToCss(resolved.glow, 0.55)} 0%, ${rgbToCss(resolved.shallow, 0.22)} 42%, ${rgbToCss(resolved.shallow, 0)} 72%)`,
          opacity: 0.3,
          transformOrigin: 'center',
          willChange: 'opacity, transform',
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
