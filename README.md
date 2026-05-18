# IKIMINA

Application privee de gestion de tontine basee sur le cycle Excel 2025-2026.

Le classeur Excel source est traite comme archive en lecture seule. Le script d'import ne supprime aucune feuille et ne modifie jamais le fichier original.

## Stack

- React + TypeScript + Vite
- Supabase Postgres/Auth avec magic links
- Cloudflare Pages
- Vitest + Playwright
- Import Excel via `exceljs`
- Exports PDF/Excel via `jspdf` et `exceljs`

## Commandes

```powershell
npm install
npm run import:excel
npm run dev
npm run test
npm run build
```

Le chemin Excel par defaut est:

```text
..\2025\IKIMINA 2025_2026REV1.xlsx
```

Pour importer une autre copie sans toucher a l'original:

```powershell
$env:IKIMINA_EXCEL_PATH="C:\chemin\vers\copie.xlsx"
npm run import:excel
```

## Supabase

1. Creer un projet Supabase gratuit.
2. Executer `supabase/migrations/0001_initial_schema.sql`.
3. Copier `.env.example` vers `.env.local`.
4. Renseigner:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

5. Activer les magic links dans Supabase Auth.
6. Creer le premier profil admin dans la table `profiles`.

Tant que Supabase n'est pas configure, l'application fonctionne en mode demo local avec `src/data/ikimina-import.json`.

## Cloudflare Pages

Configuration recommandee:

- Build command: `npm run build`
- Output directory: `dist`
- Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

Le fichier `public/_redirects` active le routage SPA.

## Donnees importees

Le rapport d'import est genere ici:

```text
docs/import-report.md
```

L'import reconstruit les donnees depuis les valeurs visibles de l'Excel:

- membres
- soldes de depart
- mois de juin 2025 a aout 2026
- cotisation, epargne, assurance mutuelle, pret, remboursement, voyage

Les formules `#REF!` sont journalisees mais non recopiees.

## Regles metier

- Tous les montants sont stockes en centimes.
- Encours credit = solde initial + prets - remboursements.
- Epargne voyage = solde initial + mouvements voyage.
- Un mois cloture est verrouille.
- Les corrections futures doivent passer par un ajustement audite.

## GitHub

```powershell
git init
git add .
git commit -m "Initial IKIMINA MVP"
git branch -M main
git remote add origin git@github.com:antoineibambasi/ikimina.git
git push -u origin main
```
