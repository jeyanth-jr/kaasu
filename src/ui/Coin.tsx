import { animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useId, useRef } from "react";
import { cx } from "./components";

/**
 * The Kaasu coin: a minted gold rupee with a reeded edge, embossed ₹ and a soft specular sheen.
 * Drawn as paths (no font) so it renders identically everywhere, including the favicon.
 */
export function CoinMark({ size = 40, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" className={className} role="img" aria-label="Kaasu coin">
      <defs>
        <linearGradient id={`${id}rim`} x1="12" y1="8" x2="116" y2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff3c2" />
          <stop offset="0.28" stopColor="#e9c25a" />
          <stop offset="0.6" stopColor="#a9741b" />
          <stop offset="1" stopColor="#f3d27c" />
        </linearGradient>
        <radialGradient id={`${id}face`} cx="0.34" cy="0.26" r="0.95">
          <stop offset="0" stopColor="#fdeaa0" />
          <stop offset="0.45" stopColor="#e2b246" />
          <stop offset="1" stopColor="#b5832a" />
        </radialGradient>
        <linearGradient id={`${id}ink`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8a5f12" />
          <stop offset="1" stopColor="#5e3f08" />
        </linearGradient>
        <linearGradient id={`${id}gloss`} x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.75" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.08" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}clip`}>
          <circle cx="64" cy="64" r="50" />
        </clipPath>
      </defs>
      <circle cx="64" cy="64" r="61" fill={`url(#${id}rim)`} />
      <circle cx="64" cy="64" r="58.5" fill="none" stroke="#6b4608" strokeOpacity="0.55" strokeWidth="5" strokeDasharray="1.1 2.3" />
      <circle cx="64" cy="64" r="55" fill="none" stroke="#fff6cf" strokeOpacity="0.55" strokeWidth="1" />
      <circle cx="64" cy="64" r="51" fill={`url(#${id}face)`} />
      <circle cx="64" cy="64" r="45" fill="none" stroke="#7a5410" strokeOpacity="0.35" strokeWidth="1.4" />
      <circle cx="64" cy="64" r="43.6" fill="none" stroke="#fff3bd" strokeOpacity="0.5" strokeWidth="0.9" />
      {/* embossed rupee: light edge below-right, dark body */}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="7.2">
        <path d="M47 45 H81 M47 58 H81 M47 45 H62 C77 45 77 67 62 67 H47 M47 67 L74 95" stroke="#fff4c0" strokeOpacity="0.85" transform="translate(1 1.4)" />
        <path d="M47 45 H81 M47 58 H81 M47 45 H62 C77 45 77 67 62 67 H47 M47 67 L74 95" stroke={`url(#${id}ink)`} />
      </g>
      <g clipPath={`url(#${id}clip)`}>
        <ellipse cx="46" cy="34" rx="46" ry="26" fill={`url(#${id}gloss)`} transform="rotate(-24 46 34)" />
      </g>
    </svg>
  );
}

/** A coin that follows the pointer in 3D and spins when clicked. */
export function Coin3D({ size = 120, className }: { size?: number; className?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const spin = useMotionValue(0);
  const rx = useSpring(useMotionValue(0), { stiffness: 160, damping: 14 });
  const ry = useSpring(useMotionValue(0), { stiffness: 160, damping: 14 });
  const rotateY = useTransform([ry, spin], ([a, s]) => (a as number) + (s as number));

  const onMove = (e: React.PointerEvent) => {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    ry.set(x * 38);
    rx.set(-y * 38);
  };
  const reset = () => {
    ry.set(0);
    rx.set(0);
  };
  return (
    <div ref={ref} onPointerMove={onMove} onPointerLeave={reset} className={cx("inline-block [perspective:700px]", className)} style={{ width: size, height: size }}>
      <motion.button
        type="button"
        aria-label="Spin the coin"
        onClick={() => !reduce && animate(spin, spin.get() + 360, { duration: 0.9, ease: [0.16, 1, 0.3, 1] })}
        style={{ rotateX: rx, rotateY, transformStyle: "preserve-3d", width: size, height: size, transition: "none" }}
        whileTap={{ scale: 0.94 }}
        className="block drop-shadow-[0_18px_22px_rgba(120,80,10,0.35)]"
      >
        <CoinMark size={size} />
      </motion.button>
    </div>
  );
}
