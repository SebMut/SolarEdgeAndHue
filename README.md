# Pool Energy Control – SolarEdge + Wetter + Philips Hue

Web-Anwendung zur intelligenten Steuerung einer Pool-Wärmepumpe über einen Philips-Hue-Smart-Plug anhand von SolarEdge-PV-Daten und Wetter-/Solarprognosen.

**Architektur:** Browser → Cloudflare Worker → D1 → SolarEdge / Open-Meteo / Philips Hue Remote API.

Es wird **kein Raspberry Pi, kein dauerhaft laufender PC und keine Desktop-App** benötigt. Die Bedienung erfolgt ausschließlich über die Webseite. Die Automatik läuft serverseitig über Cloudflare Cron Triggers und funktioniert auch, wenn kein Browser geöffnet ist.

## Funktionsumfang

- modernes, responsives deutsches Smart-Home-Dashboard
- SolarEdge: aktuelle PV-Leistung, Tagesenergie, Verbrauch, Netzbezug, Einspeisung, Batterie (wenn vom System geliefert)
- Wetter: Temperatur, Bewölkung, Sonnenstunden, Sonnenauf-/untergang, Globalstrahlung
- PV-Prognose aus Global Tilted Irradiance, Anlagen-kWp und Performance Ratio
- konfigurierbare Regeln mit `AND` / `OR`
- Messwerte: PV aktuell, Tagesenergie, Verbrauch, Netzbezug, Einspeisung, Batterie, PV-Überschuss, Sonnenstunden, Bewölkung, Strahlung, PV-Prognose
- Vergleichsoperatoren `>`, `>=`, `<`, `<=`
- Automatik / Manuell EIN / Manuell AUS
- optionale zeitlich begrenzte manuelle Modi über die API vorbereitet
- Mindestlaufzeit und Mindestauszeit
- späteste Abschaltzeit
- maximale Tageslaufzeit
- verzögerte Abschaltung bei zu wenig PV-Überschuss oder zu hohem Netzbezug
- Fail-Safe bei fehlenden erforderlichen Messwerten
- Simulation ohne echten Hue-Schaltvorgang
- „JETZT PRÜFEN“
- Verlauf und 1-/7-/30-Tage-Diagramm
- Health-Status für D1, Scheduler, SolarEdge, Wetter und Hue
- erster Einrichtungsassistent mit Fortschrittsanzeige
- verschlüsselte Secrets in D1, Schlüssel ausschließlich als Cloudflare Secret
- Passwort-Hashing via PBKDF2, sichere Session-Cookies, CSRF-Schutz, Login-Rate-Limit und CSP
- GitHub Actions für Typen, TypeScript, ESLint, Tests, Secret-Scan und Dry-Run-Build

## Warum Cloudflare statt GitHub Pages allein?

GitHub bleibt Quellcode- und CI-Zentrale. Das Dashboard benötigt jedoch einen sicheren Serverteil für Zugangsdaten, OAuth, Scheduler und Hue-Schaltbefehle. Cloudflare Workers können statische Assets und Worker-API gemeinsam ausliefern. D1 speichert Konfiguration und Verlauf. Cron Triggers rufen den Worker alle 15 Minuten auf.

Cloudflare Cron arbeitet in UTC. Die Anwendung wertet die Uhrzeit selbst mit `Europe/Berlin` aus. Dadurch bleibt die konfigurierte Prüfzeit – standardmäßig `06:00` – über Sommer- und Winterzeit korrekt.

## Verwendete Schnittstellen

### Open-Meteo

- Forecast API: `https://api.open-meteo.com/v1/forecast`
- verwendet u. a. `sunshine_duration`, `shortwave_radiation_sum`, `global_tilted_irradiance`, `cloud_cover`, `sunrise`, `sunset`
- für die Standardnutzung ist kein API-Key erforderlich

### SolarEdge Monitoring API

- Basis: `https://monitoringapi.solaredge.com`
- Site Overview: `/site/{siteId}/overview`
- Current Power Flow: `/site/{siteId}/currentPowerFlow`
- Authentifizierung über Site-ID + API-Key

Die Anwendung zeigt nur Messwerte an, die in der Antwort tatsächlich vorhanden sind. Fehlende Batterie- oder Power-Flow-Daten werden nicht erfunden.

### Philips Hue

Für die reine Cloud-Lösung wird die **Hue Remote API** verwendet. Dafür ist ein Philips-Hue-Developer-Konto mit freigeschalteter Remote-API-Anwendung erforderlich.

- OAuth2 Authorization: `https://api.meethue.com/v2/oauth2/authorize`
- OAuth2 Token: `https://api.meethue.com/v2/oauth2/token`
- Remote Route: `https://api.meethue.com/route`

Die Hue-Developer-Dokumentation für Remote-Zugriff ist teilweise nur nach Login sichtbar. Ohne eigene Client-ID/Client-Secret kann die reale Hue-Schaltung nicht vollständig getestet werden; der Simulationsmodus funktioniert unabhängig davon.

## Voraussetzungen

- GitHub-Repository (dieses Repository)
- kostenloses oder passendes Cloudflare-Konto
- SolarEdge Monitoring API-Zugang
- Philips Hue Bridge + Hue Smart Plug
- Philips Hue Developer Account mit Remote-API-App

## 1. Cloudflare vorbereiten

Node.js 22+ installieren und im Repository ausführen:

```bash
npm install
npx wrangler login
```

D1-Datenbank erstellen:

```bash
npx wrangler d1 create solar-edge-hue
```

Wrangler gibt eine `database_id` zurück. Diese UUID in `wrangler.jsonc` bei `d1_databases[0].database_id` statt

```text
00000000-0000-0000-0000-000000000000
```

eintragen.

Migrationen anwenden:

```bash
npm run db:migrate:remote
```

## 2. Cloudflare Secrets anlegen

Drei technische Secrets werden benötigt. Sie dürfen niemals committed werden.

Geeignete Zufallswerte lassen sich z. B. lokal erzeugen:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Anschließend:

```bash
npx wrangler secret put APP_ENCRYPTION_KEY
npx wrangler secret put SESSION_SECRET
npx wrangler secret put SETUP_TOKEN
```

Bedeutung:

- `APP_ENCRYPTION_KEY`: verschlüsselt SolarEdge-Key, Hue-Client-Secret und OAuth-Tokens in D1
- `SESSION_SECRET`: wird für sicherheitsrelevante Session-/Rate-Limit-Ableitungen verwendet
- `SETUP_TOKEN`: einmaliger Schutz der Ersteinrichtung

Für lokale Entwicklung `.dev.vars.example` nach `.dev.vars` kopieren und nur lokale Werte eintragen. `.dev.vars` ist per `.gitignore` ausgeschlossen.

## 3. Lokal testen

Migration:

```bash
npm run db:migrate:local
```

Entwicklungsserver:

```bash
npm run dev
```

Dann die angezeigte lokale URL öffnen.

Der geplante Cron kann mit Wranglers Scheduled-Testfunktion getestet werden.

## 4. Deployment

Vorher alle Prüfungen ausführen:

```bash
npm run check
npm run security:scan
```

Danach:

```bash
npm run deploy
```

Cloudflare veröffentlicht Worker und statische Weboberfläche in einem Deployment.

## 5. Erste Anmeldung

Beim ersten Öffnen erscheint die Ersteinrichtung.

1. `SETUP_TOKEN` eingeben.
2. Admin-Passwort mit mindestens 10 Zeichen festlegen.
3. Danach startet der Einrichtungsassistent.

Der Setup-Token selbst wird nicht in D1 gespeichert und nicht an den Browser zurückgegeben.

## 6. SolarEdge einrichten

Benötigt werden:

- **Site-ID**
- **Monitoring API-Key**

Im SolarEdge-Monitoring-Portal muss API-Zugriff für die betreffende Anlage verfügbar bzw. freigeschaltet sein. Je nach Kontotyp und Portalansicht befindet sich diese Funktion im Administrations-/Zugriffsbereich der Anlage. Wenn die API-Option im eigenen Konto nicht sichtbar ist, muss der Installateur bzw. Anlagenadministrator den Zugriff freigeben.

Im Dashboard:

1. **Einstellungen → SolarEdge** öffnen.
2. Site-ID eingeben.
3. API-Key eingeben.
4. Anlagenleistung in kWp prüfen.
5. Dachneigung und Ausrichtung setzen.
6. **SolarEdge testen** drücken.

Der API-Key wird verschlüsselt serverseitig gespeichert und später im Frontend nicht wieder angezeigt.

### Erkannte SolarEdge-Messwerte

Je nach Anlage:

- `pvCurrentKw`
- `dailyEnergyKwh`
- `consumptionKw`
- `gridImportKw`
- `feedInKw`
- `batterySoc`
- `pvSurplusKw`

Fehlt z. B. ein SolarEdge-Meter oder Speicher, können entsprechende Messwerte fehlen. Eine Regel, die einen fehlenden Wert benötigt, schlägt Fail-Safe-mäßig fehl.

## 7. PV-Prognose konfigurieren

Unter **Einstellungen → SolarEdge**:

- Anlagenleistung `kWp`
- Dachneigung `0–90°`
- Ausrichtung nach Open-Meteo-Konvention:
  - `0°` = Süd
  - `-90°` = Ost
  - `90°` = West
  - `±180°` = Nord
- Performance Ratio standardmäßig `0,82`

Die Schätzung lautet vereinfacht:

```text
PV-Prognose kWh ≈ kWp × Global Tilted Irradiance (kWh/m²) × Performance Ratio
```

Sie wird im Dashboard ausdrücklich als Prognose behandelt.

## 8. Philips Hue Remote API einrichten

1. Auf `https://developers.meethue.com/` registrieren/anmelden.
2. Eine Anwendung für die **Remote Hue API** anlegen bzw. Remote-Zugriff beantragen.
3. Die von Hue vorgegebene Callback-URL der Cloudflare-App hinterlegen:

```text
https://DEINE-WORKER-DOMAIN/oauth/hue/callback
```

4. Client-ID und Client-Secret im Dashboard unter **Einstellungen → Philips Hue Remote API** eintragen.
5. Einstellungen speichern.
6. **Hue verbinden** drücken.
7. Bei Philips Hue autorisieren.
8. Nach Rückkehr **Geräte laden** drücken.
9. den Hue Smart Plug der Pool-Wärmepumpe auswählen.
10. Einstellungen speichern.

Hue OAuth-Tokens und Client-Secret werden verschlüsselt in D1 gespeichert.

## 9. Automatikregeln

Standard:

```text
Sonnenstunden >= 5
AND
PV-Prognose >= 10 kWh
```

Unter **Regeln** können Regeln hinzugefügt, entfernt und verändert werden.

Beispiele:

```text
batterySoc >= 60
pvForecastKwh >= 12
sunshineHours >= 5
cloudCoverPct <= 60
gridImportKw <= 0.2
pvSurplusKw >= 1.5
```

Verknüpfung:

- `AND`: alle Regeln müssen erfüllt sein
- `OR`: mindestens eine Regel muss erfüllt sein

## 10. Einschalt- und Abschaltlogik

Der Worker wird alle 15 Minuten geweckt.

Vor der konfigurierten Start-/Prüfzeit wird im AUTO-Modus nicht neu eingeschaltet. Ab der Prüfzeit werden Regeln ausgewertet. So kann eine Regel mit aktuellem PV-Überschuss später am Morgen ebenfalls einschalten.

Abschaltung kann erfolgen bei:

- Regeln nicht mehr erfüllt
- spätester Abschaltzeit
- maximaler Tageslaufzeit
- zu hohem Netzbezug über konfigurierbare Verzögerung
- zu niedrigem PV-Überschuss über konfigurierbare Verzögerung
- Manuell AUS

Dabei werden Mindestlaufzeit und Mindestauszeit berücksichtigt.

## 11. Betriebsmodi

### AUTO

Regel-Engine entscheidet.

### MANUAL_ON

Wärmepumpe wird eingeschaltet und der AUTO-Modus überschreibt dies nicht.

### MANUAL_OFF

Wärmepumpe wird ausgeschaltet und der AUTO-Modus überschreibt dies nicht.

## 12. Fail-Safe

Bei fehlenden Daten gilt:

- niemals aufgrund eines fehlenden notwendigen Messwertes neu einschalten
- Fehler protokollieren
- keine Secrets loggen
- Schaltfehler als Fehler im Verlauf ablegen
- kein schnelles Ein/Aus-Flattern durch Mindestzeiten und Verzögerung

## 13. Simulation

Unter **Test** können u. a. simuliert werden:

- PV-Prognose
- Sonnenstunden
- aktuelle PV-Leistung
- Batteriestand
- Netzbezug
- PV-Überschuss

`AUTOMATIK JETZT TESTEN` führt nur die Regel-Engine aus. **Es wird kein echter Hue-Befehl gesendet.**

## 14. Verlauf und Diagramme

D1 speichert:

- Solar-Snapshots
- Wetter-Snapshots
- Automatikentscheidungen
- Hue-Schaltungen
- manuelle Eingriffe
- Fehler

Verfügbare Diagrammzeiträume:

- Heute
- 7 Tage
- 30 Tage

Die Datenbasis wächst erst ab Inbetriebnahme der Anwendung.

## 15. Sicherheit

Umgesetzt:

- keine Secrets in `wrangler.jsonc`
- `.env` / `.dev.vars` ignoriert
- verschlüsselte Integrations-Secrets in D1 (AES-GCM)
- Verschlüsselungsschlüssel nur als Cloudflare Secret
- Passwort-Hashing PBKDF2-SHA256 mit zufälligem Salt und 210.000 Iterationen
- zufällige Session-Token
- Session-Token nur gehasht in D1
- `Secure`, `HttpOnly`, `SameSite=Lax` Session-Cookie
- CSRF-Token auf schreibenden API-Endpunkten
- Login-Rate-Limit
- Input-Validierung
- CSP, `X-Frame-Options`, `nosniff`, Referrer-/Permissions-Policy
- kein CORS für fremde Origins
- Secret-Scan in CI
- kein lokaler Netzwerk-Port / keine Router-Portfreigabe nötig

Siehe auch [SECURITY.md](SECURITY.md).

## 16. GitHub Actions

`.github/workflows/ci.yml` führt aus:

1. `npm install`
2. `wrangler types`
3. TypeScript Check
4. ESLint
5. Vitest
6. Secret-Scan
7. Wrangler Dry-Run Build

Damit schlagen fehlerhafte Commits in CI fehl.

## 17. Projektstruktur

```text
SolarEdgeAndHue/
├── .github/workflows/ci.yml
├── migrations/
│   └── 0001_init.sql
├── public/
│   ├── index.html
│   ├── app.css
│   ├── app-core.js
│   ├── app-dashboard.js
│   └── app-settings.js
├── scripts/
│   └── check-no-secrets.mjs
├── src/
│   ├── api.ts
│   ├── automation.ts
│   ├── db.ts
│   ├── defaults.ts
│   ├── hue.ts
│   ├── index.ts
│   ├── security.ts
│   ├── solaredge.ts
│   ├── time.ts
│   ├── types.ts
│   └── weather.ts
├── tests/
├── .dev.vars.example
├── .env.example
├── eslint.config.js
├── package.json
├── tsconfig.json
└── wrangler.jsonc
```

## 18. Bekannte Grenzen vor der realen Inbetriebnahme

Ohne deine persönlichen Zugangsdaten können folgende Punkte nicht gegen echte Geräte geprüft werden:

- SolarEdge Site-ID + API-Key
- Hue Remote API Client-ID + Client-Secret
- Hue OAuth-Freigabe
- Auswahl und echtes Schalten deines Hue Smart Plug

Diese Daten **nicht in GitHub posten**. Sie werden später über die Weboberfläche bzw. Cloudflare Secrets eingerichtet.

## 19. Entwicklung

```bash
npm install
npm run cf:types
npm run typecheck
npm run lint
npm test
npm run security:scan
npm run build
```

## 20. Produktions-Checkliste

- [ ] D1-Datenbank erzeugt und UUID eingetragen
- [ ] Migrationen remote angewendet
- [ ] `APP_ENCRYPTION_KEY` als Cloudflare Secret gesetzt
- [ ] `SESSION_SECRET` als Cloudflare Secret gesetzt
- [ ] `SETUP_TOKEN` als Cloudflare Secret gesetzt
- [ ] Worker deployed
- [ ] Admin-Passwort gesetzt
- [ ] SolarEdge verbunden und Test erfolgreich
- [ ] Wettertest erfolgreich
- [ ] Hue Remote App freigegeben
- [ ] korrekte Callback-URL bei Hue eingetragen
- [ ] Hue OAuth erfolgreich
- [ ] Pool-Smart-Plug ausgewählt
- [ ] Simulationsfälle geprüft
- [ ] Mindestlauf-/Mindestauszeit passend zur Wärmepumpe eingestellt
- [ ] echte Automatik erst danach aktiviert
