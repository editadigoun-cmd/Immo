# API des loyers (Cloudflare Worker + D1)

Ce dossier contient l'API qui connecte l'application (`../index.html`) à une
base de données Cloudflare D1 partagée entre tous les appareils.

Déployé et en service : Worker **immo**, base D1 **immo-loyers** (liée via
Settings → Bindings dans le dashboard), déploiement automatique à chaque
push sur `claude/audio-help-0xwadi` grâce à l'intégration Git de Cloudflare
Workers Builds. L'URL est préconfigurée par défaut dans l'application
(modifiable via **⚙ Paramètres** si besoin) :

```
https://immo.ccds22431.workers.dev
```

## Déployer manuellement (si besoin)

Depuis ce dossier (`worker/`) :

```bash
npx wrangler login       # ouvre le navigateur pour te connecter à ton compte Cloudflare
npx wrangler deploy
```

## (Optionnel) Protéger l'accès avec une clé

Par défaut l'API est ouverte à quiconque connaît son URL (comme la clé
publique d'un projet Supabase). Pour ajouter une protection légère :

```bash
npx wrangler secret put API_KEY
# entre une valeur secrète quand demandé
```

Puis dans l'application, renseigne la même valeur dans le champ « Clé API »
des Paramètres.

## Redéployer après une modification

```bash
npx wrangler deploy
```

## Structure de la base

- `tenants` : locataires (nom, bien, loyer mensuel, date d'entrée, note)
- `payments` : paiements reçus (locataire, date, montant, moyen, note)

Le schéma (`schema.sql`) a déjà été appliqué à la base distante. Pour le
reproduire en local (tests) :

```bash
npx wrangler d1 execute immo-loyers --local --file=schema.sql
npx wrangler dev --local
```
