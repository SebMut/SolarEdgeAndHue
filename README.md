# Pool Energy Control – SolarEdge ONE + Wetter + Philips Hue

Web-Anwendung zur intelligenten Steuerung einer Pool-Wärmepumpe über einen Philips-Hue-Smart-Plug anhand von SolarEdge-PV-Daten und Wetter-/Solarprognosen.

**Architektur:** Browser → Cloudflare Worker → D1 → SolarEdge ONE API V2 / Open-Meteo / Philips Hue Remote API.

Es wird **kein Raspberry Pi, kein dauerhaft laufender PC und keine Desktop-App** benötigt. Die Bedienung erfolgt ausschließlich über die Webseite. Die Automatik läuft serverseitig über Cloudflare Cron Triggers und funktioniert auch, wenn kein Browser geöffnet ist.

Aktuelle Produktions-URL:

`https://pool-energy-control.purple-surf-95d8.workers.dev`

## Funktionsumfang

- responsives deutsches Smart-Home-Dashboard
- SolarEdge ONE API V2 mit OAuth 2.0
- automatische Liste der für die Anwendung freigegebenen SolarEdge-Anlagen
- Live-PV-Leistung, Verbrauch, Netzbezug, Einspeisung, Batterie und Tagesenergie – soweit von der Anlage/API geliefert
- Open-Meteo für Temperatur, Bewölkung, Sonnenstunden, Sonnenauf-/untergang und Strahlung
- PV-Prognose aus Global Tilted Irradiance, Anlagen-kWp und Performance Ratio
- konfigurierbare Regeln mit `AND` / `OR` und `>`, `>=`, `<`, `<=`
- Automatik / Manuell EIN / Manuell AUS
- Mindestlaufzeit, Mindestauszeit, späteste Abschaltzeit und maximale Tageslaufzeit
- verzögerte Abschaltung bei zu wenig PV-Überschuss oder zu hohem Netzbezug
- Fail-Safe bei fehlenden erforderlichen Messwerten
- Simulation ohne echten Hue-Schaltvorgang
- „JETZT PRÜFEN“
- Verlauf und 1-/7-/30-Tage-Diagramme
- Health-Status für D1, Scheduler, SolarEdge, Wetter und Hue
- verschlüsselte Integrations-Secrets in D1; Schlüssel ausschließlich als Cloudflare Secret
- PBKDF2-Passwort-Hash, sichere Session-Cookies, CSRF-Schutz, Login-Rate-Limit und CSP
- GitHub Actions für TypeScript, ESLint, Tests, Secret-Scan und Wrangler-Dry-Run-Build

## Verwendete Schnittstellen

### SolarEdge ONE API V2

Die Anwendung verwendet die aktuelle SolarEdge-Entwicklerplattform mit **OAuth 2.0**, nicht mehr den alten Monitoring-API-Key. Benötigt werden die **Client ID** und das **Client Secret** einer Anwendung aus SolarEdge ONE for Developers.

Offizielle Einstiege:

- `https://developer.solaredge.com/`
- `https://api-docs.solaredge.com/`

Verwendete V2-Ressourcen:

- `GET /v2/sites` – freigegebene Anlagen laden
- `GET /v2/sites/{siteId}/power/live` – aktuelle Leistungsdaten
- `GET /v2/sites/{siteId}/energy` – Tagesenergie, sofern für Konto/Anlage verfügbar

OAuth-Endpunkte werden nach Möglichkeit über die standardisierten Discovery-Dokumente des SolarEdge-Gateways erkannt. Zusätzlich besitzt der Client sichere Fallbacks und unterstützt sowohl Client-Credentials als auch einen interaktiven Authorization-Code-Flow. Access-/Refresh-Tokens werden serverseitig verschlüsselt gespeichert und bei Bedarf erneuert.

Die Anwendung zeigt nur Messwerte an, die SolarEdge tatsächlich liefert. Fehlende Meter-, Batterie- oder Verbrauchsdaten werden nicht erfunden.

### Open-Meteo

Forecast API: `https://api.open-meteo.com/v1/forecast`

Verwendet werden unter anderem:

- `sunshine_duration`
- `shortwave_radiation_sum`
- `global_tilted_irradiance`
- `cloud_cover`
- `sunrise`
- `sunset`

Für die Standardnutzung wird kein eigener API-Key benötigt.

### Philips Hue

Für die reine Cloud-Lösung wird die Hue Remote API verwendet.

- OAuth2 Authorization: `https://api.meethue.com/v2/oauth2/authorize`
- OAuth2 Token: `https://api.meethue.com/v2/oauth2/token`
- Remote Route: `https://api.meethue.com/route`

Hue-Client-Secret und OAuth-Tokens werden ebenfalls verschlüsselt serverseitig gespeichert.

## Ersteinrichtung der laufenden Web-App

Beim ersten Aufruf:

1. `SETUP_TOKEN` eingeben.
2. Admin-Passwort mit mindestens 10 Zeichen festlegen.
3. Anmelden.
4. Unter **Einstellungen** SolarEdge ONE, Wetter/PV-Anlage und Philips Hue konfigurieren.
5. Zuerst den Simulationsmodus verwenden.
6. Erst nach erfolgreichem SolarEdge-/Hue-Test die Automatik aktivieren.

## SolarEdge ONE einrichten

### 1. Anwendung bei SolarEdge anlegen

Auf `https://developer.solaredge.com/` eine Anwendung anlegen. SolarEdge zeigt anschließend:

- **Client ID**
- **Client Secret**

Das Client Secret nur in der Web-App eintragen, niemals in GitHub, Issues oder Logs.

### 2. Callback URL

Falls das SolarEdge-Developer-Portal für den Authorization-Code-Flow eine Redirect-/Callback-URL verlangt, für die aktuelle Produktion exakt diese URL verwenden:

`https://pool-energy-control.purple-surf-95d8.workers.dev/oauth/solaredge/callback`

Die Weboberfläche zeigt die aktuell gültige Callback-URL ebenfalls automatisch an.

### 3. In Pool Energy Control verbinden

Unter **Einstellungen → SolarEdge ONE API V2**:

1. Client ID eintragen.
2. Client Secret eintragen.
3. **SolarEdge verbinden / Anlagen laden** drücken.
4. Wenn die Zugangsdaten direkt für Client-Credentials freigeschaltet sind, werden die Anlagen sofort geladen.
5. Falls SolarEdge eine Benutzer-/Fleet-Freigabe verlangt, leitet die Web-App zum SolarEdge-OAuth-Dialog weiter.
6. Nach erfolgreicher Rückkehr werden die freigegebenen Anlagen geladen.
7. Bei mehreren Anlagen die richtige auswählen und **Einstellungen speichern**.
8. **SolarEdge testen** drücken.

Ist nur eine Anlage freigegeben, wird sie automatisch ausgewählt.

### Erkannte SolarEdge-Messwerte

Je nach vorhandener Messtechnik:

- `pvCurrentKw`
- `dailyEnergyKwh`
- `consumptionKw`
- `gridImportKw`
- `feedInKw`
- `batterySoc`
- `pvSurplusKw`

Eine aktive Regel mit einem nicht verfügbaren Messwert wird Fail-Safe-mäßig nicht als erfüllt behandelt.

## PV-Prognose

Unter **Einstellungen → SolarEdge ONE API V2** können zusätzlich hinterlegt werden:

- Anlagenleistung in kWp
- Dachneigung `0–90°`
- Ausrichtung: `0°` Süd, `-90°` Ost, `90°` West, `±180°` Nord
- Performance Ratio, Standard `0,82`

Die Wetterprognose ist eine Schätzung:

`PV-Prognose kWh ≈ kWp × Global Tilted Irradiance (kWh/m²) × Performance Ratio`

## Philips Hue Remote API einrichten

1. Auf `https://developers.meethue.com/` anmelden.
2. Remote-API-Anwendung anlegen/freischalten.
3. Callback URL hinterlegen: `https://pool-energy-control.purple-surf-95d8.workers.dev/oauth/hue/callback`
4. Client ID und Client Secret in **Einstellungen → Philips Hue Remote API** speichern.
5. **Hue verbinden** drücken und autorisieren.
6. **Geräte laden** drücken.
7. Den Smart Plug der Pool-Wärmepumpe auswählen und speichern.

## Automatikregeln

Standardregeln:

```text
Sonnenstunden >= 5
AND
PV-Prognose >= 10 kWh
```

Weitere mögliche Regeln:

```text
batterySoc >= 60
pvForecastKwh >= 12
cloudCoverPct <= 60
gridImportKw <= 0.2
pvSurplusKw >= 1.5
```

Der Worker wird alle 15 Minuten aufgerufen. Die Anwendung wertet die Zeit selbst in `Europe/Berlin` aus, sodass die konfigurierte Prüfzeit Sommer- und Winterzeit korrekt berücksichtigt.

## Abschalt- und Fail-Safe-Logik

Abschaltungen können erfolgen bei:

- nicht mehr erfüllten Regeln
- spätester Abschaltzeit
- maximaler Tageslaufzeit
- länger anhaltendem hohen Netzbezug
- länger anhaltendem zu niedrigen PV-Überschuss
- Manuell AUS

Mindestlaufzeit, Mindestauszeit und Verzögerungen verhindern unnötiges Schaltflattern. Bei fehlenden benötigten Daten wird nicht blind eingeschaltet.

## Simulation

Unter **Test** können PV-Prognose, Sonnenstunden, aktuelle PV-Leistung, Batteriestand, Netzbezug und PV-Überschuss simuliert werden.

`AUTOMATIK JETZT TESTEN` sendet **keinen echten Hue-Schaltbefehl**.

## Sicherheit

Umgesetzt sind unter anderem:

- SolarEdge Client Secret, Access-/Refresh-Token und Hue-Secrets AES-GCM-verschlüsselt in D1
- `APP_ENCRYPTION_KEY` ausschließlich als Cloudflare Secret
- Integrations-Secrets werden nie an das Frontend zurückgeliefert
- PBKDF2-SHA-256 mit 100.000 Iterationen und zufälligem Salt
- gehashte Session-Tokens
- `Secure`, `HttpOnly`, `SameSite=Lax` Cookies
- CSRF-Schutz
- Login-Rate-Limit
- serverseitige Eingabevalidierung
- CSP und weitere Security Header
- Secret-Scan in CI

Siehe [SECURITY.md](SECURITY.md).

## Cloudflare / GitHub Deployment

Der Produktionsdeploy ist über `.github/workflows/deploy-cloudflare.yml` automatisiert. Benötigte GitHub Actions Secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `APP_ENCRYPTION_KEY`
- `SESSION_SECRET`
- `SETUP_TOKEN`

Der Workflow:

1. installiert Abhängigkeiten
2. erzeugt Cloudflare-Typen
3. führt TypeScript, ESLint, Tests, Secret-Scan und Build aus
4. erstellt/bindet D1 bei Bedarf
5. führt D1-Migrationen aus
6. überträgt Worker-Secrets
7. deployt Worker und Weboberfläche

## Lokale Entwicklung (optional)

Nur für Entwickler; für den normalen Betrieb nicht erforderlich.

```bash
npm install
npm run db:migrate:local
npm run dev
```

Vor einem Release:

```bash
npm run check
npm run security:scan
npm run build
```

## Projektstruktur

```text
SolarEdgeAndHue/
├── .github/workflows/
├── migrations/
├── public/
├── scripts/
├── src/
│   ├── api.ts
│   ├── automation.ts
│   ├── db.ts
│   ├── hue.ts
│   ├── security.ts
│   ├── solaredge.ts
│   ├── time.ts
│   └── weather.ts
├── tests/
├── SECURITY.md
├── package.json
├── tsconfig.json
└── wrangler.jsonc
```

## Reale Tests

Der Simulationsmodus, Regel-Engine, Zeitlogik, Secret-Schutz, Build und API-Normalisierung werden automatisiert getestet. Ein realer SolarEdge- oder Hue-Aufruf kann erst nach Hinterlegung der jeweiligen persönlichen OAuth-Zugangsdaten und Freigabe der Anlage/des Hue-Kontos vollständig verifiziert werden. Nicht getestete externe Verbindungen werden im Abschlussstatus ausdrücklich als solche benannt.
