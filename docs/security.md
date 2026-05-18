# Securite IKIMINA

## Principes

- Aucun acces anonyme en production.
- Authentification par lien email Supabase.
- Row Level Security activee sur toutes les tables metier.
- Les participants lisent les tableaux publies; seuls les admins ecrivent.
- Les mois clotures ne sont plus modifiables directement.
- Les exports doivent etre produits depuis des mois verifies.

## Roles

- `admin`: gere membres, periodes, encodage, cloture, exports.
- `participant`: lecture seule.

## Donnees sensibles

Les donnees contiennent des noms, soldes, prets et remboursements. Ne pas publier:

- `.env.local`
- exports non valides
- sauvegardes brutes
- clefs Supabase service role

## Sauvegarde

Avant chaque changement important:

1. Export JSON/CSV depuis Supabase.
2. Conserver le fichier Excel source original dans OneDrive.
3. Garder les rapports PDF/Excel mensuels clotures.

## Limites v1

- Pas encore de rapprochement bancaire automatique.
- Pas encore d'ajustements audites dans l'interface.
- Pas encore de workflow double validation.
