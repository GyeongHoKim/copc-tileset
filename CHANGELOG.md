## [1.0.3](https://github.com/GyeongHoKim/copc-tileset/compare/v1.0.2...v1.0.3) (2026-07-14)


### Bug Fixes

* **license:** switch license from MIT to AGPL-3.0-or-later ([5ed3fdf](https://github.com/GyeongHoKim/copc-tileset/commit/5ed3fdfec0aeea360dfddf9e8fb02761d24e0c08))

## [1.0.2](https://github.com/GyeongHoKim/copc-tileset/compare/v1.0.1...v1.0.2) (2026-07-14)


### Bug Fixes

* guard sessionStorage access against SecurityError in SW registration ([3ac72ee](https://github.com/GyeongHoKim/copc-tileset/commit/3ac72ee8e69f0b77eedc5bd12293dad757088cad))
* load laz-perf WASM from a bundler URL so the worker can decode points ([30321cd](https://github.com/GyeongHoKim/copc-tileset/commit/30321cda0a512ccd65f566ec8377a31c2f7bc732))
* size the top-level tileset geometric error to the dataset extent ([90f4335](https://github.com/GyeongHoKim/copc-tileset/commit/90f4335655177a581c156afed73cf6ffb93baa49))
* wait for Service Worker control instead of proceeding uncontrolled ([a986011](https://github.com/GyeongHoKim/copc-tileset/commit/a98601177b802fce5170342dc8aafe467da6d384))

## [1.0.1](https://github.com/GyeongHoKim/copc-tileset/compare/v1.0.0...v1.0.1) (2026-07-13)


### Bug Fixes

* make geometry core Cesium-free so it runs in the service worker ([6989889](https://github.com/GyeongHoKim/copc-tileset/commit/6989889933e1ab79390c0798596755045b438b81))

# 1.0.0 (2026-07-13)


### Bug Fixes

* resolve virtual tile URLs relative to the app base ([111a041](https://github.com/GyeongHoKim/copc-tileset/commit/111a0411e920ae3e52ecb1b30886fced9ea8f316))


### Features

* add CopcPointCloudPrimitive facade over Cesium3DTileset ([2e4a477](https://github.com/GyeongHoKim/copc-tileset/commit/2e4a4775cd8b2c39758d1bca7dd15d4a764a8937))
* add octree geometry utilities ([58dd17b](https://github.com/GyeongHoKim/copc-tileset/commit/58dd17b5e121fa306ed97d20d981c8d7d6ffbc43))
* add per-point batch table for picking and attribute shaders ([67d486e](https://github.com/GyeongHoKim/copc-tileset/commit/67d486ec2fe77914d59a5a3b7cbf7505dead8c0b))
* bound the tile store with LRU page eviction ([3c54ef1](https://github.com/GyeongHoKim/copc-tileset/commit/3c54ef14658147d24e2ca22155327ff2f939e55b))
* encode COPC nodes as 3D Tiles pnts ([77f2492](https://github.com/GyeongHoKim/copc-tileset/commit/77f249273a4ce6c5d695115e7275715c74f394c0))
* expose LOD and point-cloud shading controls ([b5fc21b](https://github.com/GyeongHoKim/copc-tileset/commit/b5fc21b10b0f969f0411deb4bd0582555d467824))
* flesh out CopcProvider (hierarchy, points, bounding sphere) ([fce25ab](https://github.com/GyeongHoKim/copc-tileset/commit/fce25ab1e528aec5ee3e9fc8d7a99150a2203fbc))
* interactive demo and GitHub Pages deployment ([9a23bcc](https://github.com/GyeongHoKim/copc-tileset/commit/9a23bcc388505de88c7fcb3d82089b6b39ae7d87))
* reproject COPC coordinates to ECEF + verify real read path ([3b803a4](https://github.com/GyeongHoKim/copc-tileset/commit/3b803a47fe31805221b8800fecd5fbc93bedfa44))
* synthesise 3D Tiles from COPC via a service worker ([0d4735f](https://github.com/GyeongHoKim/copc-tileset/commit/0d4735f79a9a6f9b1e2f01a93712b6f84351a01c))
