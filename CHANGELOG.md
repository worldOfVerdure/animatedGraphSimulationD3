# Changelog

All notable changes to this project will be documented here.

## 12/10/2025

### Changed

- Updated `Node` type to extend **`SimulationNodeDatum`** for full compatibility with D3 force simulation.
- Removed redundant manual declarations of simulation fields (`x`, `y`, `vx`, `vy`, `fx`, `fy`, `index`).
- Ensured type safety by inheriting simulation‑managed properties directly from D3 typings.

### Added

- `id: number` — personal identifier distinct from D3’s `index`.
- `radius?: number` — optional visual property for circle rendering.
- `color?: string` — optional visual property for styling nodes.

### Benefits

- Cleaner type definition with reduced redundancy.
- Improved IntelliSense and type safety for simulation + rendering logic.
- Future‑proofed: automatically inherits updates to `SimulationNodeDatum`.

---

## 12/09/2025

### Added

- Initial project setup
