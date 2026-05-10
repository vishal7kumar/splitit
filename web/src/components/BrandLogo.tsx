type BrandLogoProps = {
  size?: "sm" | "lg";
  className?: string;
};

const sizeClasses = {
  sm: {
    icon: "h-7 w-7",
    text: "text-lg",
  },
  lg: {
    icon: "h-10 w-10",
    text: "text-3xl",
  },
};

export default function BrandLogo({ size = "sm", className = "" }: BrandLogoProps) {
  const classes = sizeClasses[size];

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className={classes.icon}
      >
        <g transform="rotate(-45 24 24)">
          <path
            d="M 6 24 A 18 18 0 0 1 42 24 Z"
            fill="#059669"
            transform="translate(0, -1.5)"
          />
          <path
            d="M 42 24 A 18 18 0 0 1 6 24 Z"
            fill="#34D399"
            transform="translate(0, 1.5)"
          />
        </g>
      </svg>
      <span className={`${classes.text} font-semibold tracking-normal text-gray-950`}>
        splitit
      </span>
    </span>
  );
}
