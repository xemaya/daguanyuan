/** Shared art dimensions for geometry and collision; not historical ratios. */
export const WALL_STYLE = {
  bodyTop: 2.44, collisionTop: 2.63, footHalf: .23,
  gate: { radius: 1.1, clearRadius: 1.088, centerY: 1.15, sillY: .25, sillWidth: 1.74, sillDepth: .4 },
} as const;
