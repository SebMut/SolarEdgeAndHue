# Security

## Secrets

Echte Zugangsdaten gehören niemals in GitHub, Issues, Logs oder Screenshots.

Cloudflare-Secrets:

- `APP_ENCRYPTION_KEY`
- `SESSION_SECRET`
- `SETUP_TOKEN`

SolarEdge ONE und Philips Hue werden ausschließlich serverseitig angebunden. In D1 werden insbesondere folgende Werte nur AES-GCM-verschlüsselt gespeichert:

- SolarEdge Client Secret
- SolarEdge OAuth Access-/Refresh-Tokens
- Hue Client Secret
- Hue OAuth Access-/Refresh-Tokens

Der AES-Schlüssel selbst liegt ausschließlich als Cloudflare Worker Secret vor. Integrations-Secrets werden nach dem Speichern nicht wieder an das Frontend zurückgegeben. OAuth-/API-Fehler werden vor dem Logging gekürzt und bekannte Token-/Secret-Felder redigiert.

## SolarEdge ONE OAuth

- die Anwendung verwendet SolarEdge API V2 mit OAuth 2.0
- OAuth-State wird zufällig erzeugt, ist zeitlich begrenzt und an die angemeldete Session gebunden
- der Callback akzeptiert nur passenden, nicht abgelaufenen State
- Access-Tokens werden vor Ablauf erneuert, sofern ein Refresh-Token vorhanden ist
- eine Änderung von SolarEdge Client ID oder Client Secret verwirft vorhandene OAuth-Tokens
- der alte Monitoring-API-Key wird nicht mehr für neue Verbindungen verwendet

## Web-Schutz

- PBKDF2-SHA-256-Passwort-Hash mit 100.000 Iterationen (Cloudflare-Workers-Web-Crypto-Limit) und individuellem 128-Bit-Salt
- gehashte Session-Tokens
- `HttpOnly`, `Secure`, `SameSite=Lax` Session-Cookie
- CSRF-Prüfung auf schreibenden Requests
- Rate-Limit auf Loginversuche
- CSP und weitere Security Header
- keine Cross-Origin-API-Freigabe
- serverseitige Eingabevalidierung
- ungültige bzw. über dem Plattformlimit liegende PBKDF2-Work-Faktoren werden vor dem Web-Crypto-Aufruf abgewiesen

## Gerätesicherheit

Die Automatik verwendet Fail-Safe: Fehlt ein Messwert, den eine aktive Regel benötigt, erfolgt kein neues Einschalten. Mindestlauf- und Mindestauszeiten sowie Abschaltverzögerungen verhindern hektisches Schalten.

Die Anwendung ersetzt keine elektrischen oder thermischen Schutzfunktionen der Wärmepumpe. Der verwendete Smart Plug muss für die reale elektrische Last der Wärmepumpe geeignet und entsprechend Herstellerangaben zugelassen sein.

## Meldung eines Problems

Keine Secrets in öffentliche GitHub-Issues schreiben. Bei einem vermuteten Leak betroffene Schlüssel sofort bei SolarEdge, Philips Hue bzw. Cloudflare widerrufen/rotieren.
