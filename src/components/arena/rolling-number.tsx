"use client";

import { motion, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";

/** Animates between numeric values with a spring, like a ticker rolling. */
export function RollingNumber({
  value,
  format,
  className,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
}) {
  const spring = useSpring(value, { stiffness: 90, damping: 18 });
  const text = useTransform(spring, format);

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  return <motion.span className={className}>{text}</motion.span>;
}
