"use client";

/**
 * Glowing WebGL orb (ogl) that swirls and ripples with a sound level.
 *
 * Level source, in order:
 *  - `getLevel()` (0–1), e.g. the music playing on the page — no permission needed;
 *  - the microphone, only when `enableVoiceControl` is true (asks the visitor's
 *    permission, so never on by default).
 */
import { useEffect, useRef, type FC } from "react";
import { Mesh, Program, Renderer, Triangle, Vec3 } from "ogl";
import { cn } from "@/lib/utils";

interface VoicePoweredOrbProps {
  className?: string;
  hue?: number;
  /** External sound level 0–1 read every frame (e.g. from an AnalyserNode on the page's audio). */
  getLevel?: () => number;
  enableVoiceControl?: boolean;
  voiceSensitivity?: number;
  maxRotationSpeed?: number;
  maxHoverIntensity?: number;
  onVoiceDetected?: (detected: boolean) => void;
  children?: React.ReactNode;
}

const VERT = /* glsl */ `
  precision highp float;
  attribute vec2 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform float iTime;
  uniform vec3 iResolution;
  uniform float hue;
  uniform float hover;
  uniform float rot;
  uniform float hoverIntensity;
  varying vec2 vUv;

  vec3 rgb2yiq(vec3 c) {
    float y = dot(c, vec3(0.299, 0.587, 0.114));
    float i = dot(c, vec3(0.596, -0.274, -0.322));
    float q = dot(c, vec3(0.211, -0.523, 0.312));
    return vec3(y, i, q);
  }

  vec3 yiq2rgb(vec3 c) {
    float r = c.x + 0.956 * c.y + 0.621 * c.z;
    float g = c.x - 0.272 * c.y - 0.647 * c.z;
    float b = c.x - 1.106 * c.y + 1.703 * c.z;
    return vec3(r, g, b);
  }

  vec3 adjustHue(vec3 color, float hueDeg) {
    float hueRad = hueDeg * 3.14159265 / 180.0;
    vec3 yiq = rgb2yiq(color);
    float cosA = cos(hueRad);
    float sinA = sin(hueRad);
    float i = yiq.y * cosA - yiq.z * sinA;
    float q = yiq.y * sinA + yiq.z * cosA;
    yiq.y = i;
    yiq.z = q;
    return yiq2rgb(yiq);
  }

  vec3 hash33(vec3 p3) {
    p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
    p3 += dot(p3, p3.yxz + 19.19);
    return -1.0 + 2.0 * fract(vec3(p3.x + p3.y, p3.x + p3.z, p3.y + p3.z) * p3.zyx);
  }

  float snoise3(vec3 p) {
    const float K1 = 0.333333333;
    const float K2 = 0.166666667;
    vec3 i = floor(p + (p.x + p.y + p.z) * K1);
    vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
    vec3 e = step(vec3(0.0), d0 - d0.yzx);
    vec3 i1 = e * (1.0 - e.zxy);
    vec3 i2 = 1.0 - e.zxy * (1.0 - e);
    vec3 d1 = d0 - (i1 - K2);
    vec3 d2 = d0 - (i2 - K1);
    vec3 d3 = d0 - 0.5;
    vec4 h = max(0.6 - vec4(dot(d0, d0), dot(d1, d1), dot(d2, d2), dot(d3, d3)), 0.0);
    vec4 n = h * h * h * h * vec4(
      dot(d0, hash33(i)),
      dot(d1, hash33(i + i1)),
      dot(d2, hash33(i + i2)),
      dot(d3, hash33(i + 1.0))
    );
    return dot(vec4(31.316), n);
  }

  vec4 extractAlpha(vec3 colorIn) {
    float a = max(max(colorIn.r, colorIn.g), colorIn.b);
    return vec4(colorIn.rgb / (a + 1e-5), a);
  }

  const vec3 baseColor1 = vec3(0.611765, 0.262745, 0.996078);
  const vec3 baseColor2 = vec3(0.298039, 0.760784, 0.913725);
  const vec3 baseColor3 = vec3(0.062745, 0.078431, 0.600000);
  const float innerRadius = 0.6;
  const float noiseScale = 0.65;

  float light1(float intensity, float attenuation, float dist) {
    return intensity / (1.0 + dist * attenuation);
  }

  float light2(float intensity, float attenuation, float dist) {
    return intensity / (1.0 + dist * dist * attenuation);
  }

  vec4 draw(vec2 uv) {
    vec3 color1 = adjustHue(baseColor1, hue);
    vec3 color2 = adjustHue(baseColor2, hue);
    vec3 color3 = adjustHue(baseColor3, hue);

    float ang = atan(uv.y, uv.x);
    float len = length(uv);
    float invLen = len > 0.0 ? 1.0 / len : 0.0;

    float n0 = snoise3(vec3(uv * noiseScale, iTime * 0.5)) * 0.5 + 0.5;
    float r0 = mix(mix(innerRadius, 1.0, 0.4), mix(innerRadius, 1.0, 0.6), n0);
    float d0 = distance(uv, (r0 * invLen) * uv);
    float v0 = light1(1.0, 10.0, d0);
    v0 *= smoothstep(r0 * 1.05, r0, len);
    float cl = cos(ang + iTime * 2.0) * 0.5 + 0.5;

    float a = iTime * -1.0;
    vec2 pos = vec2(cos(a), sin(a)) * r0;
    float d = distance(uv, pos);
    float v1 = light2(1.5, 5.0, d);
    v1 *= light1(1.0, 50.0, d0);

    float v2 = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
    float v3 = smoothstep(innerRadius, mix(innerRadius, 1.0, 0.5), len);

    vec3 col = mix(color1, color2, cl);
    col = mix(color3, col, v0);
    col = (col + v1) * v2 * v3;
    col = clamp(col, 0.0, 1.0);

    return extractAlpha(col);
  }

  vec4 mainImage(vec2 fragCoord) {
    vec2 center = iResolution.xy * 0.5;
    float size = min(iResolution.x, iResolution.y);
    vec2 uv = (fragCoord - center) / size * 2.0;

    float angle = rot;
    float s = sin(angle);
    float c = cos(angle);
    uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);

    uv.x += hover * hoverIntensity * 0.1 * sin(uv.y * 10.0 + iTime);
    uv.y += hover * hoverIntensity * 0.1 * sin(uv.x * 10.0 + iTime);

    return draw(uv);
  }

  void main() {
    vec2 fragCoord = vUv * iResolution.xy;
    vec4 col = mainImage(fragCoord);
    gl_FragColor = vec4(col.rgb * col.a, col.a);
  }
`;

/** RMS level (0–1) of an analyser's frequency data, scaled by `sensitivity`. */
export function levelFromFrequencies(data: Uint8Array, sensitivity = 1.5): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] / 255;
    sum += v * v;
  }
  return Math.min(Math.sqrt(sum / (data.length || 1)) * sensitivity * 3.0, 1);
}

export const VoicePoweredOrb: FC<VoicePoweredOrbProps> = ({
  className,
  hue = 0,
  getLevel,
  enableVoiceControl = false,
  voiceSensitivity = 1.5,
  maxRotationSpeed = 1.2,
  maxHoverIntensity = 0.8,
  onVoiceDetected,
  children,
}) => {
  const ctnDom = useRef<HTMLDivElement>(null);
  // Latest props read by the render loop without restarting WebGL.
  const live = useRef({ hue, getLevel, voiceSensitivity, maxRotationSpeed, maxHoverIntensity, onVoiceDetected });
  useEffect(() => {
    live.current = { hue, getLevel, voiceSensitivity, maxRotationSpeed, maxHoverIntensity, onVoiceDetected };
  });

  useEffect(() => {
    const container = ctnDom.current;
    if (!container) return;

    let renderer: Renderer;
    try {
      renderer = new Renderer({
        alpha: true,
        premultipliedAlpha: false,
        antialias: true,
        dpr: window.devicePixelRatio || 1,
      });
    } catch (e) {
      console.warn("Orb: WebGL unavailable", e);
      return;
    }
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    container.prepend(canvas);

    const program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new Vec3(canvas.width, canvas.height, canvas.width / canvas.height) },
        hue: { value: live.current.hue },
        hover: { value: 0 },
        rot: { value: 0 },
        hoverIntensity: { value: 0 },
      },
    });
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w * dpr, h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      program.uniforms.iResolution.value.set(canvas.width, canvas.height, canvas.width / canvas.height);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    // Optional microphone (opt-in only).
    let micCtx: AudioContext | null = null;
    let micStream: MediaStream | null = null;
    let micAnalyser: AnalyserNode | null = null;
    let micData: Uint8Array<ArrayBuffer> | null = null;
    let cancelled = false;
    if (enableVoiceControl) {
      navigator.mediaDevices
        ?.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
        .then((stream) => {
          if (cancelled) return stream.getTracks().forEach((t) => t.stop());
          micStream = stream;
          micCtx = new AudioContext();
          micAnalyser = micCtx.createAnalyser();
          micAnalyser.fftSize = 512;
          micAnalyser.smoothingTimeConstant = 0.3;
          micAnalyser.minDecibels = -90;
          micAnalyser.maxDecibels = -10;
          micCtx.createMediaStreamSource(stream).connect(micAnalyser);
          micData = new Uint8Array(micAnalyser.frequencyBinCount);
        })
        .catch((e) => console.warn("Orb: microphone unavailable", e));
    }

    let raf = 0;
    let last = 0;
    let rot = 0;
    let level = 0;
    const baseRotationSpeed = 0.3;
    const update = (t: number) => {
      raf = requestAnimationFrame(update);
      const dt = last ? (t - last) * 0.001 : 0;
      last = t;
      const p = live.current;

      let target = 0;
      if (p.getLevel) target = Math.max(0, Math.min(1, p.getLevel()));
      else if (micAnalyser && micData) {
        micAnalyser.getByteFrequencyData(micData);
        target = levelFromFrequencies(micData, p.voiceSensitivity);
      }
      // Smooth attack / release so the orb breathes instead of flickering.
      level += (target - level) * (target > level ? 0.35 : 0.08);
      p.onVoiceDetected?.(level > 0.1);

      if (level > 0.05) rot += dt * (baseRotationSpeed + level * p.maxRotationSpeed * 2.0);
      program.uniforms.iTime.value = t * 0.001;
      program.uniforms.hue.value = p.hue;
      program.uniforms.rot.value = rot;
      program.uniforms.hover.value = Math.min(level * 2.0, 1.0);
      program.uniforms.hoverIntensity.value = Math.min(level * p.maxHoverIntensity * 0.8, p.maxHoverIntensity);

      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      renderer.render({ scene: mesh });
    };
    raf = requestAnimationFrame(update);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      micStream?.getTracks().forEach((t) => t.stop());
      micCtx?.close().catch(() => {});
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [enableVoiceControl]);

  return (
    <div ref={ctnDom} className={cn("relative h-full w-full", className)}>
      {children}
    </div>
  );
};

export default VoicePoweredOrb;
