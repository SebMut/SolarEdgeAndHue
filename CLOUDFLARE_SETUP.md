# Cloudflare – einmalige Einrichtung

Nach diesem einmaligen Schritt erfolgt Betrieb und Bedienung vollständig über die Webseite. Es wird kein Raspberry Pi, kein dauerhaft laufender PC und keine Desktop-App benötigt.

## Was bereits automatisiert ist

Der Workflow `.github/workflows/deploy-cloudflare.yml` übernimmt selbstständig:

1. Qualitätsprüfung des Projekts
2. Suche nach der D1-Datenbank `solar-edge-hue`
3. automatische Erstellung der D1-Datenbank, falls sie noch nicht existiert
4. Erzeugung einer temporären Deployment-Konfiguration mit der echten D1-ID
5. Anwendung aller D1-Migrationen
6. sichere Übergabe der Worker-Secrets
7. Deployment von Worker und Web-Dashboard
8. Aktivierung des konfigurierten Cloudflare-Cron-Triggers
9. Löschen der temporären Secret-Dateien auf dem GitHub-Runner

Die echte D1-ID und Secret-Werte werden nicht in das Repository geschrieben.

## Einmalig benötigte GitHub Actions Secrets

Öffne im Repository:

**Settings → Secrets and variables → Actions → New repository secret**

Lege exakt diese fünf Secrets an:

### `CLOUDFLARE_ACCOUNT_ID`

Deine Cloudflare Account-ID.

Sie ist im Cloudflare-Dashboard in der Kontoübersicht bzw. auf vielen Ressourcen-Seiten im Bereich Account-ID zu finden.

### `CLOUDFLARE_API_TOKEN`

Ein möglichst eng eingeschränkter Cloudflare API-Token für genau dieses Konto.

Benötigte Rechte:

- **Workers Scripts: Edit**
- **D1: Edit / Write**

Wenn später eine eigene Domain/Route automatisch verwaltet werden soll, kann zusätzlich **Workers Routes: Edit** nötig werden. Für die normale `workers.dev`-Adresse ist das nicht erforderlich.

Den Token niemals in eine Repository-Datei, Issue, Commit-Nachricht oder einen Screenshot schreiben.

### `APP_ENCRYPTION_KEY`

Ein langer zufälliger geheimer Wert, empfohlen mindestens 32 zufällige Bytes bzw. eine entsprechend lange zufällige Zeichenfolge.

Dieser Schlüssel verschlüsselt später SolarEdge- und Hue-Zugangsdaten in D1. Nach der Inbetriebnahme nicht einfach ändern, da bereits gespeicherte Werte sonst nicht mehr entschlüsselt werden können.

### `SESSION_SECRET`

Ein zweiter, unabhängiger langer Zufallswert. Nicht identisch mit `APP_ENCRYPTION_KEY` verwenden.

### `SETUP_TOKEN`

Ein einmaliger, langer Zufallswert für die erste Einrichtung der Web-App.

**Diesen Wert merken bzw. im Passwortmanager speichern.** Beim ersten Öffnen der deployed Webseite wird genau dieser Setup-Token benötigt, um das Admin-Passwort anzulegen.

## Danach

Sobald alle fünf GitHub Actions Secrets vorhanden sind, reicht ein Push auf `main` oder ein manueller Start des Workflows **Deploy Cloudflare**.

Wenn die Secrets noch fehlen, beendet sich der Deployment-Workflow absichtlich erfolgreich mit einem Hinweis und verändert nichts bei Cloudflare.

## Nach erfolgreichem Deployment

1. die in GitHub Actions ausgegebene `workers.dev`-Adresse öffnen
2. `SETUP_TOKEN` eingeben
3. Admin-Passwort festlegen
4. SolarEdge Site-ID und API-Key über **Einstellungen** hinterlegen
5. Wetter testen
6. Philips Hue Remote API verbinden
7. Hue Smart Plug der Pool-Wärmepumpe auswählen
8. Simulation durchführen
9. Mindestlaufzeit und Mindestauszeit prüfen
10. erst danach die echte Automatik aktivieren

## Sicherheit

- Cloudflare-Token und App-Secrets liegen ausschließlich als GitHub Actions Secrets bzw. Cloudflare Worker Secrets vor.
- Temporäre Secret-Dateien sind per `.gitignore` ausgeschlossen und werden am Ende des Deploy-Jobs gelöscht.
- SolarEdge-Key, Hue-Client-Secret und OAuth-Tokens werden serverseitig AES-GCM-verschlüsselt in D1 gespeichert.
- Die Web-App gibt gespeicherte Secrets nicht wieder an den Browser zurück.
