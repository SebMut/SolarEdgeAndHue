# Security

## Secrets

Echte Zugangsdaten gehören niemals in GitHub, Issues, Logs oder Screenshots.

Cloudflare-Secrets:

- `APP_ENCRYPTION_KEY`
- `SESSION_SECRET`
- `SETUP_TOKEN`

SolarEdge- und Hue-Zugangsdaten werden über die Weboberfläche an den Worker übertragen und mit AES-GCM verschlüsselt in D1 gespeichert. Der AES-Schlüssel selbst liegt ausschließlich als Cloudflare Secret vor.

## Web-Schutz

- PBKDF2-Passwort-Hash
- gehashte Session-Tokens
- HttpOnly/Secure/SameSite-Cookie
- CSRF-Prüfung auf schreibenden Requests
- Rate-Limit auf Loginversuche
- CSP und weitere Security Header
- keine Cross-Origin-API-Freigabe
- serverseitige Eingabevalidierung

## Gerätesicherheit

Die Automatik verwendet Fail-Safe: Fehlt ein Messwert, den eine aktive Regel benötigt, erfolgt kein neues Einschalten. Mindestlauf- und Mindestauszeiten sowie Abschaltverzögerungen verhindern hektisches Schalten.

Die Anwendung ersetzt keine elektrischen oder thermischen Schutzfunktionen der Wärmepumpe. Der verwendete Smart Plug muss für die reale elektrische Last der Wärmepumpe geeignet und entsprechend Herstellerangaben zugelassen sein.

## Meldung eines Problems

Keine Secrets in öffentliche GitHub-Issues schreiben. Bei einem vermuteten Leak betroffene Schlüssel sofort bei SolarEdge, Philips Hue bzw. Cloudflare widerrufen/rotieren.
