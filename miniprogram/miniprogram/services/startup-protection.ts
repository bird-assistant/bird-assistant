import {validJournalCollection} from './journal-model';
import {validSavedPlaces} from './saved-places';
import {migrateProtectedCollections} from './protected-local-data';
/** Loaded after App.onLaunch returns; no login/network and no repeated parsing of both complete snapshots. */
export function protectLocalCollections(){migrateProtectedCollections({journals:validJournalCollection,places:validSavedPlaces});}
