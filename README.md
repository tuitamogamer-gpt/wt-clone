# WeTransfer clone

Samostalna aplikacija za dijeljenje datoteka s responzivnim sučeljem na hrvatskom. React 19, TypeScript i Vite na klijentu; Express, Multer i Archiver na poslužitelju.

## Pokretanje

```bash
npm install
npm run dev
```

Aplikacija: http://localhost:5173. API: http://localhost:3001. Vite prosljeđuje `/api` na API poslužitelj.

```bash
npm run build
npm start
```

Produkcijsko pokretanje poslužuje sučelje i API na portu 3001. Port se može promijeniti varijablom `PORT`.

## Mogućnosti

- Učitavanje povlačenjem ili odabirom datoteka i mapa; najviše 100 datoteka i ukupno 2 GiB po prijenosu.
- Stvarne, trajno pohranjene datoteke i poveznice `/t/:id`.
- Pojedinačno preuzimanje ili ZIP cijelog prijenosa.
- Rok valjanosti od 1, 3 ili 7 dana, provjeren pri svakom pristupu.
- Opcionalna lozinka sa scrypt hashiranjem, ograničenjem pokušaja i privremenim potpisanim tokenom za preuzimanje.
- Prikaz napretka i otkazivanje učitavanja.
- E-pošta preko `mailto:` poveznice: priprema poruke u korisnikovoj aplikaciji. Nema automatskog slanja e-pošte ni SMTP integracije.
- Povijest posljednjih 30 prijenosa u lokalnoj pohrani preglednika. Uklanjanje iz povijesti ne briše prijenos.
- Originalna SVG ilustracija, tri boje pozadine, pomoć, mobilno sučelje i podrška smanjenom kretanju.

## Provjera

```bash
npm test
npm run build
```

Integracijski testovi koriste privremenu mapu i pokrivaju stvarne sadržaje datoteka i ZIP-a, ponovno pokretanje, zaštitu lozinkom, istek, ograničenja veličine i broja datoteka, hrvatske nazive i čišćenje neuspjelih prijenosa.

Za pregledničke provjere pokreni aplikaciju, zatim `npm run test:e2e`. Testovi koriste Chromium na `/usr/bin/chromium`; drugu lokaciju možeš zadati varijablom `CHROMIUM_PATH`, a URL aplikacije varijablom `E2E_BASE_URL`.

## Pohrana i hosting

Datoteke i metapodaci pohranjuju se u `data/`, koja je isključena iz repozitorija. Potreban je Node poslužitelj s trajnim diskom. Poslužitelj pri prvom pokretanju stvara lokalnu tajnu za potpisivanje; može se zadati i kroz `TRANSFER_SECRET`.

Za dijeljenje između uređaja aplikacija mora biti dostupna primateljima na zajedničkom URL-u. U javnom okruženju koristi HTTPS. Nakon isteka pristup se blokira; fizičko čišćenje isteklih podataka trenutno treba organizirati zasebno. Mape se učitavaju kao skup datoteka, bez očuvanja izvorne strukture mapa u ZIP-u.

Projekt je inspiriran WeTransferom i nije povezan sa službenom uslugom.
