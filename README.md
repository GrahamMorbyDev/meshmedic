# MeshMedic

**See what’s broken. Repair it with confidence.**

MeshMedic is a free, open-source STL diagnostics and repair tool for 3D
printing. It highlights common mesh faults, explains what they mean, lets the
user choose which repairs to apply, and provides an original/repaired
comparison before export.

Live site: [mesh-medic.com](https://mesh-medic.com)

## Why MeshMedic?

Many online STL repair services send models to a remote server and return an
unexplained result. MeshMedic is designed around transparent, local processing:

- STL files are parsed, analysed, displayed and repaired in the browser.
- Model geometry is not uploaded to a MeshMedic server.
- Open and non-manifold edges can be highlighted on the model.
- Repair operations are selected explicitly by the user.
- The original and repaired meshes can be compared before download.
- The repaired model is exported as a standard binary STL.

## Current capabilities

- Binary and ASCII STL import
- Open-edge detection
- Non-manifold-edge detection
- Degenerate- and duplicate-face detection
- Disconnected-shell counting
- Coincident-vertex welding
- Unsafe-face removal
- Surface-normal recalculation
- Conservative planar-hole filling
- Original/repaired comparison
- Binary STL export

MeshMedic deliberately avoids aggressive geometry changes. Complex curved
holes, self-intersections, overlapping shells and severely corrupted meshes may
still require a full mesh editor such as Blender or MeshLab. Always inspect the
final slice preview before printing.

## Self-hosting

### Requirements

- Node.js 22.13 or newer
- npm
- A modern browser with WebGL

### Install and run

```bash
git clone https://github.com/GrahamMorbyDev/meshmedic.git
cd meshmedic
npm install
npm run dev
```

Open the local address shown in the terminal.

### Production build

```bash
npm run build
npm start
```

The application is built with React, TypeScript, Three.js and
[Vinext](https://github.com/cloudflare/vinext).

## Optional Google Analytics

Analytics is disabled when no measurement ID is configured. To enable the
consent-aware GA4 integration for your own deployment:

```bash
cp .env.example .env.local
```

Then set:

```dotenv
GA_MEASUREMENT_ID=G-YOUR-ID
```

Visitors must choose **Allow analytics** before the Google tag loads. Advertising
storage, advertising user data and advertising personalisation remain denied.
Never reuse the production MeshMedic measurement ID for a separate deployment.

## Privacy model

STL file contents and mesh geometry remain in the visitor’s browser. MeshMedic
does not provide an STL upload API or server-side model store.

If optional analytics is enabled, it records ordinary website usage only after
consent. The application does not send STL contents, filenames, triangle data
or repaired geometry to Google Analytics.

Because the source is public, operators and users can inspect this behaviour or
run their own copy.

## Useful commands

```bash
npm run dev       # Start local development
npm run build     # Create a production build
npm start         # Run the production build
npm test          # Build and run project checks
npm run lint      # Run ESLint
```

## Contributing

Issues, difficult test meshes and focused pull requests are welcome. When
reporting a repair problem, describe:

- What the original mesh problem was
- What MeshMedic detected
- Which repair operations were selected
- Whether the repaired file sliced correctly

Only share an STL publicly when you own it or have permission to redistribute
it. A minimal reproducible mesh is preferable for bug reports.

## Security and privacy reports

Please avoid attaching confidential or commercially sensitive models to public
GitHub issues. Report security or privacy concerns privately through the
repository owner’s GitHub profile.

## Licence

MeshMedic is available under the [MIT Licence](LICENSE).

Copyright © 2026 [Grey Patrick](https://greypatrick.com).
