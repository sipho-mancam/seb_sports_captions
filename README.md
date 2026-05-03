# Sports Captions

Production build output is generated into `dist/`.

## Distribution

1. Copy `.env.example` to `.env.production` and set the production backend URLs.
2. Run `npm install`.
3. Run `npm run build`.
4. Distribute the contents of `dist/` or serve them from any static web server.

The Vite build is configured with relative asset paths, so the generated bundle can be deployed under a subpath or moved between hosts without rewriting asset URLs.

## Desktop App

This workspace packages the React frontend as an Electron desktop application.

The Spring Boot backend is not bundled from this repository. The packaged desktop app connects to the backend URL configured at build time through `VITE_API_BASE_URL`, so the backend must be available separately on the target machine or network.

1. Copy `.env.example` to `.env.production` and set the backend URLs for the environment you are packaging for.
2. Run `npm install`.
3. Run `npm run desktop:dist` to build the installer.
4. Find the generated Windows installer in `release/`.

For a non-installed packaged app directory, run `npm run desktop:pack`.

## Environment Variables

- `VITE_API_BASE_URL`: Base URL for the Sports Captions backend API.
- `VITE_MSE_SERVER_URL`: Optional override for the MSE graphics endpoint. Defaults to `${VITE_API_BASE_URL}/mse/graphics`.

## Local Validation

- `npm run build` builds the production bundle.
- `npm run preview:dist` serves the built app so you can verify the distributable output.
- `npm run desktop:start` builds the app and opens the Electron shell locally.
- `npm run desktop:dist` builds the Windows desktop installer into `release/`.