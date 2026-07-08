# Backend image for Zeabur (presence of this file overrides the default zbpack
# Node pipeline). Exists for one reason: bake Playwright Chromium + its system
# libs into the container so the browser tool / Threads browser source work in
# prod (ALLOW_BROWSER=true). Trade-off: ~1.2GB image, longer builds.
FROM node:22-bookworm-slim
WORKDIR /app

COPY package*.json ./
RUN npm ci
# Chromium + system deps, version-matched to the installed playwright package.
RUN npx playwright install --with-deps chromium

# roles/, skills/, knowledge/, plugins/ are runtime data (files-as-truth, read
# relative to CWD) — they ship in the image. See .dockerignore for exclusions.
COPY . .
RUN npm run build

ENV NODE_ENV=production
# PORT is injected by Zeabur; config.ts binds it (webPort). --web comes from npm start.
CMD ["npm", "start"]
