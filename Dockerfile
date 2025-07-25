# 1. Temiz bir Node.js imajı kullan
FROM node:20

# 2. Çalışma dizinini ayarla
WORKDIR /app

# 3. Gerekli dosyaları kopyala
COPY dist/ ./dist
COPY server.cjs .
COPY package.json .
COPY package-lock.json .
COPY db.json .
COPY appointments.json .
COPY patients.json .
COPY gallery.json .
COPY google_reviews.json .
COPY smtp.json .
COPY after_before.json .
COPY metadata.json .
COPY new_setup.json .
COPY public/ ./public
COPY src/locales/ ./src/locales

# 4. Sadece production bağımlılıklarını yükle
RUN npm install --omit=dev

# 5. Sunucu portunu aç
EXPOSE 3001

# 6. Sunucuyu başlat
CMD ["node", "server.cjs"]
