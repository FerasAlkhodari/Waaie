# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# CRA bakes REACT_APP_* vars into the static bundle at build time.
# Same-origin relative path: the browser calls /api/* on the public domain,
# and this container's nginx reverse-proxies /api -> backend over the internal
# Docker network. No second public subdomain, no CORS, no external DNS dependency.
ENV REACT_APP_BACKEND_URL=/api

COPY . .
RUN npm run build

# ---- Serve stage ----
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
