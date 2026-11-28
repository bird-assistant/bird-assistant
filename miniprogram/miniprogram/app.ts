import {readJournals} from './services/journal-model';
import {readSavedPlaces} from './services/saved-places';
import {faultSummary} from './services/diagnostics';
App({
  onLaunch() {
    // Registration and service configuration are explicit. No location, login or cloud initialization here.
    for(const read of [readJournals,readSavedPlaces])try{read();}catch(error){faultSummary('local-data-protection',error);}
    console.info('[Bird Assistant] native local checkpoint 0.4.20 · review');
  },
  onError(message){faultSummary('app-error',message);console.error('[Bird Assistant] uncaught',message);},
  onUnhandledRejection(event){faultSummary('unhandled-promise',event.reason);console.error('[Bird Assistant] unhandled rejection',event.reason);}
});
