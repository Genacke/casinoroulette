# Dofus Royale Roulette

Site de roulette style casino pour serveur prive Dofus, avec monnaie virtuelle en kamas, backend Node.js + Express, base SQLite, interface joueur responsive et panel admin securise.

## Points clefs

- Roulette 0 a 36 avec couleurs rouge, noir et vert
- Onglet poker Texas Hold'em no limit avec cave fixe
- Resultat calcule uniquement cote serveur
- Manches globales synchronisees pour tous les joueurs
- Une manche ouvre toutes les 30 secondes par defaut
- Les mises se verrouillent quelques secondes avant le tirage
- Solde stocke en base et jamais modifiable par le joueur
- Connexion joueur + connexion admin
- Credit / retrait de kamas depuis le panel admin
- Historique des tickets, gains, manches, connexions et ajustements
- Mise mini configurable, ticket max configurable et plafond dedie sur le numero 0
- Commission de 2% sur les demandes de retrait validees
- Leaderboard, stats joueur, notifications, chat et auto spin
- Demandes de cash out joueur avec traitement admin
- Rate limiting, anti-spam, hash des mots de passe, cookie JWT HttpOnly

## Fonctionnement metier

1. Le joueur remet ses kamas IN GAME a un admin ou croupier.
2. L'admin credite ensuite manuellement son compte depuis le panel.
3. Le joueur prepare un ticket pour la manche en cours.
4. Au moment du tirage, tous les joueurs inscrits recoivent le meme resultat.
5. Toute action sensible est verifiee cote serveur.

## Stack

- Frontend: HTML, CSS, JavaScript vanilla
- Backend: Node.js, Express
- Base de donnees: SQLite
- Auth: JWT signe en cookie HttpOnly

## Arborescence

```text
.
|-- admin/
|   |-- app.js
|   `-- index.html
|-- client/
|   |-- app.js
|   `-- index.html
|-- database/
|   |-- seed.js
|   `-- casino.sqlite
|-- public/
|   |-- admin.css
|   |-- common.js
|   `-- styles.css
|-- routes/
|   |-- admin.routes.js
|   |-- auth.routes.js
|   |-- game.routes.js
|   `-- poker.routes.js
|-- server/
|   |-- app.js
|   |-- auth.js
|   |-- config.js
|   |-- db.js
|   |-- middleware.js
|   |-- poker.js
|   |-- roulette.js
|   |-- rounds.js
|   `-- utils.js
|-- .env.example
|-- .gitignore
|-- Dockerfile
|-- .dockerignore
|-- package.json
`-- README.md
```

## Installation

### 1. Installer les dependances

```bash
npm install
```

### 2. Configurer l'environnement

Copier `.env.example` vers `.env` puis ajuster si besoin.

Variables principales:

- `PORT=3000`
- `DB_PATH=` optionnel, sinon l'application utilise `RAILWAY_VOLUME_MOUNT_PATH` si present
- `JWT_SECRET=change-this-secret-in-production`
- `ADMIN_USERNAME=admin`
- `ADMIN_PASSWORD=ChangeMe123!`
- `HOUSE_EDGE_PERCENT=2`
- `CASHOUT_FEE_PERCENT=2`
- `MIN_BET=200000`
- `MAX_BET=2000000`
- `GREEN_MAX_BET=500000`
- `ROUND_INTERVAL_SECONDS=30`
- `ROUND_BET_LOCK_SECONDS=5`
- `AUTO_SPIN_MAX_ROUNDS=25`
- `POKER_TABLE_BUY_IN=10000000`
- `POKER_SMALL_BLIND=200000`
- `POKER_BIG_BLIND=400000`
- `POKER_MIN_PLAYERS=2`
- `POKER_MAX_PLAYERS=6`
- `POKER_TURN_SECONDS=25`
- `POKER_SHOWDOWN_SECONDS=10`

### 3. Creer des comptes de demo optionnels

```bash
npm run seed
```

Ce script ajoute:

- Admin: `admin` / `ChangeMe123!`
- Joueurs de demo:
  - `Roublard` / `DofusRoulette1!`
  - `Enutrof` / `DofusRoulette1!`
  - `Sacrieur` / `DofusRoulette1!`

### 4. Lancer le serveur

```bash
npm start
```

Mode dev avec watch:

```bash
npm run dev
```

## URLs locales

- Interface joueur: [http://localhost:3000](http://localhost:3000)
- Panel admin: [http://localhost:3000/admin](http://localhost:3000/admin)
- Sante API: [http://localhost:3000/api/health](http://localhost:3000/api/health)

## Systeme de manche

- Tous les joueurs jouent la meme manche en meme temps.
- La duree d'une manche est reglee par `ROUND_INTERVAL_SECONDS`, avec un plafond actuel a `30` secondes.
- La fermeture des mises avant tirage est reglee par `ROUND_BET_LOCK_SECONDS`.
- Le joueur envoie un ticket pour la manche en cours.
- Les kamas du ticket sont reserves immediatement.
- Le ticket peut etre annule tant que les mises sont encore ouvertes.
- Le resultat final est tire une seule fois cote serveur puis applique a tous les tickets actifs de la manche.

## Mises supportees

- Couleur: rouge / noir
- Numero exact: 0 a 36
- Pair / impair
- Manque / passe
- Douzaines

## Poker

- Format: Texas Hold'em no limit
- Une table globale 10 000 000 kamas de cave
- Petite blind 200 000, grosse blind 400 000 par defaut
- La main demarre des que 2 joueurs sont assis
- Les cartes, le board et les tours sont calcules cote serveur
- Les joueurs ont 25 secondes pour agir avant auto-check ou auto-fold
- Les sorties de table remettent la cave restante sur le solde du joueur

## Securite

- RNG via `crypto.randomInt`
- Validation stricte des mises cote serveur
- Validation stricte des actions poker cote serveur
- Verification du solde cote serveur
- Hash des mots de passe avec `bcryptjs`
- JWT signe en cookie HttpOnly
- Protection de routes par role
- Rate limiting sur login, chat, tickets et mutations admin
- Anti-spam sur tickets et chat
- Historique des connexions, tickets, gains et ajustements
- Aucune route ne permet au joueur de modifier son propre solde

## API principale

### Auth

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Joueur

- `GET /api/game/bootstrap`
- `GET /api/game/round-state`
- `POST /api/game/ticket`
- `DELETE /api/game/ticket`
- `GET /api/game/history`
- `GET /api/game/leaderboard`
- `POST /api/game/cashout-requests`
- `DELETE /api/game/cashout-requests/:requestId`
- `GET /api/game/chat`
- `POST /api/game/chat`
- `GET /api/game/notifications`
- `POST /api/game/notifications/read-all`

### Poker

- `GET /api/poker/state`
- `POST /api/poker/join`
- `POST /api/poker/leave`
- `POST /api/poker/action`

### Admin

- `GET /api/admin/dashboard`
- `GET /api/admin/users?search=...`
- `POST /api/admin/cashout-requests/:requestId`
- `POST /api/admin/users/:userId/balance`
- `GET /api/admin/logs?type=spins|bets|cashouts|balances|logins`

## Verification rapide

Le projet a ete verifie localement sur les points suivants:

- demarrage du serveur
- `GET /api/health`
- login joueur
- bootstrap joueur
- soumission de ticket cote serveur
- resolution automatique d'une manche
- verification de deux joueurs sur la meme manche avec le meme resultat
- login admin
- recherche joueur admin
- credit manuel du solde depuis l'API admin

## Docker

Build:

```bash
docker build -t dofus-roulette .
```

Run:

```bash
docker run --rm -p 3000:3000 --env-file .env dofus-roulette
```

## Deploiement Railway

Le chemin le plus simple pour cette app est Railway avec le `Dockerfile` du repo.

### Etapes

1. Push le repo sur GitHub.
2. Dans Railway, cree un nouveau projet puis connecte ce repo.
3. Railway detectera automatiquement le `Dockerfile` et le fichier `railway.json`.
4. Ajoute un volume persistant sur le service avec le point de montage `/data`.
5. Renseigne les variables d'environnement:
- `JWT_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `HOUSE_EDGE_PERCENT`
- `CASHOUT_FEE_PERCENT=2`
- `MIN_BET=200000`
- `MAX_BET=2000000`
- `GREEN_MAX_BET=500000`
- `ROUND_INTERVAL_SECONDS=30`
- `ROUND_BET_LOCK_SECONDS=5`
- `AUTO_SPIN_MAX_ROUNDS=25`
- `POKER_TABLE_BUY_IN=10000000`
- `POKER_SMALL_BLIND=200000`
- `POKER_BIG_BLIND=400000`
- `POKER_MIN_PLAYERS=2`
- `POKER_MAX_PLAYERS=6`
- `POKER_TURN_SECONDS=25`
- `POKER_SHOWDOWN_SECONDS=10`
6. Optionnel: fixe `DB_PATH=/data/casino.sqlite` si tu veux un chemin explicite.
   Sinon l'application utilisera automatiquement `RAILWAY_VOLUME_MOUNT_PATH` quand le volume est attache.
7. Deploy.

### Ce qui est deja pret

- `railway.json` configure le build Dockerfile et le healthcheck `/api/health`.
- Le serveur ecoute bien sur `PORT`.
- SQLite peut persister sur le volume Railway sans changer le code.
- Les manches globales toutes les 30 secondes continuent de tourner cote serveur.

## Production

Avant mise en ligne:

- changer `JWT_SECRET`
- changer le mot de passe admin par defaut
- activer HTTPS
- placer l'application derriere un reverse proxy
- mettre en place une sauvegarde de la base SQLite ou migrer vers une base distante

Note importante pour l'hebergement:

- Le mode SQLite local convient tres bien en local ou sur un petit serveur dedie.
- Pour une roulette synchronisee toutes les 30 secondes, les hebergeurs gratuits qui s'endorment ou suppriment le stockage local ne sont pas fiables.
- Si tu veux une vraie mise en ligne publique et stable, le plus propre est soit un petit hebergement always-on, soit une migration vers une base distante + une plateforme avec taches planifiees.
