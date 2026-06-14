type LogoMarkProps = {
  size?: number;
  className?: string;
};

/** Grimoire d20 logo (transparent PNG). */
export function LogoMark({ size = 28, className }: LogoMarkProps) {
  return (
    <img
      src="/logo.png"
      alt=""
      width={size}
      height={size}
      className={className}
      aria-hidden
      draggable={false}
    />
  );
}
